import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationProvider, useOrganization } from './OrganizationContext';

const mock = vi.hoisted(() => ({
  auth: { user: { id: 'a' }, profile: { id: 'a', organization_id: 'org-a' }, isLoading: false, authError: null },
  read: vi.fn(),
}));

vi.mock('./AuthContext', () => ({ useAuth: () => mock.auth }));
vi.mock('@/lib/readRetry', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/readRetry')>();
  return {
    ...actual,
    runReadWithRetry: (attempt: Parameters<typeof actual.runReadWithRetry>[0], options: Parameters<typeof actual.runReadWithRetry>[1]) =>
      actual.runReadWithRetry(attempt, { ...options, delaysMs: [0, 0] }),
  };
});
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      let id = '';
      const query = {
        select: () => query,
        eq: (_column: string, value: string) => { id = value; return query; },
        maybeSingle: () => query,
        abortSignal: (signal: AbortSignal) => mock.read(table, id, signal),
        update: () => query,
      };
      return query;
    },
  },
}));

function Snapshot() {
  const org = useOrganization();
  return (
    <div>
      <span data-testid="org-state">{JSON.stringify({ id: org.organization?.id ?? null, loading: org.isLoading, error: org.error })}</span>
      <button onClick={() => void org.refreshOrganization()}>Reintentar organización</button>
    </div>
  );
}

function state() {
  return JSON.parse(screen.getByTestId('org-state').textContent ?? '{}');
}

describe('OrganizationProvider tenant', () => {
  beforeEach(() => {
    mock.auth.user = { id: 'a' };
    mock.auth.profile = { id: 'a', organization_id: 'org-a' };
    mock.read.mockReset().mockImplementation((table: string, id: string) => Promise.resolve(
      table === 'organizations'
        ? { data: { id, slug: id, plan: 'basico' }, error: null, status: 200 }
        : { data: null, error: null, status: 200 },
    ));
  });

  it('agota dos reintentos transitorios y permite reintentar sin login ni perfil duplicado', async () => {
    let reads = 0;
    mock.read.mockImplementation((table: string, id: string) => Promise.resolve(
      table === 'organizations'
        ? (++reads <= 3
          ? { data: null, error: { message: 'Failed to fetch' }, status: 0 }
          : { data: { id, slug: id, plan: 'basico' }, error: null, status: 200 })
        : { data: null, error: null, status: 200 },
    ));
    render(<OrganizationProvider><Snapshot /></OrganizationProvider>);
    await waitFor(() => expect(state().error).toBeTruthy());
    expect(reads).toBe(3);
    fireEvent.click(screen.getByText('Reintentar organización'));
    await waitFor(() => expect(state().id).toBe('org-a'));
    expect(reads).toBe(4);
    expect(mock.read.mock.calls.some(call => call[0] === 'profiles')).toBe(false);
  });

  it('no muestra datos de la organización anterior durante un cambio rápido', async () => {
    let finishA!: (value: unknown) => void;
    mock.read.mockImplementation((table: string, id: string) => {
      if (table === 'organizations' && id === 'org-a') return new Promise(resolve => { finishA = resolve; });
      return Promise.resolve(table === 'organizations'
        ? { data: { id, slug: id, plan: 'basico' }, error: null, status: 200 }
        : { data: null, error: null, status: 200 });
    });
    const view = render(<OrganizationProvider><Snapshot /></OrganizationProvider>);
    await waitFor(() => expect(finishA).toBeTypeOf('function'));
    mock.auth.user = { id: 'b' };
    mock.auth.profile = { id: 'b', organization_id: 'org-b' };
    view.rerender(<OrganizationProvider><Snapshot /></OrganizationProvider>);
    expect(state().id).toBe(null);
    await waitFor(() => expect(state().id).toBe('org-b'));
    await act(async () => finishA({ data: { id: 'org-a', slug: 'org-a', plan: 'basico' }, error: null, status: 200 }));
    expect(state().id).toBe('org-b');
  });
});
