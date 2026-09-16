import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SucursalProvider, useSucursal } from './SucursalContext';
import { useSubscriptionAccess } from '@/hooks/useSubscriptionAccess';

const mock = vi.hoisted(() => ({
  auth: {
    user: { id: 'a' }, profile: { default_sucursal_id: 'branch-a' },
    isOwner: true, isGeneralManager: false, isSucursalAccount: false, isLoading: false,
  },
  org: { organization: { id: 'org-a' }, isLoading: false },
  readBranches: vi.fn(),
  readAccess: vi.fn(),
}));

vi.mock('./AuthContext', () => ({ useAuth: () => mock.auth }));
vi.mock('./OrganizationContext', () => ({ useOrganization: () => mock.org }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => {
      let orgId = '';
      const query = {
        select: () => query,
        eq: (column: string, value: string) => { if (column === 'organization_id') orgId = value; return query; },
        is: () => query,
        order: () => query,
        abortSignal: (signal: AbortSignal) => mock.readBranches(orgId, signal),
      };
      return query;
    },
  },
}));
vi.mock('@/lib/supabaseUntyped', () => ({
  supabaseUntyped: {
    rpc: (_name: string, args: { _org_id: string }) => ({
      abortSignal: (signal: AbortSignal) => mock.readAccess(args._org_id, signal),
    }),
  },
}));

function Snapshot() {
  const branches = useSucursal();
  const subscription = useSubscriptionAccess();
  return <span data-testid="tenant-data">{JSON.stringify({
    branch: branches.currentSucursal?.id ?? null,
    branches: branches.sucursales.map(s => s.id),
    access: subscription.access?.organization_id ?? null,
  })}</span>;
}

function state() {
  return JSON.parse(screen.getByTestId('tenant-data').textContent ?? '{}');
}

function branchResult(orgId: string) {
  return { data: [{ id: `branch-${orgId.slice(-1)}`, organization_id: orgId, nombre: orgId, direccion: null, telefono: null, timezone: null, activa: true }], error: null, status: 200 };
}

describe('datos derivados del tenant', () => {
  beforeEach(() => {
    mock.auth.user = { id: 'a' };
    mock.auth.profile = { default_sucursal_id: 'branch-a' };
    mock.org.organization = { id: 'org-a' };
    mock.readBranches.mockReset().mockImplementation((orgId: string) => Promise.resolve(branchResult(orgId)));
    mock.readAccess.mockReset().mockImplementation((orgId: string) => Promise.resolve({ data: { organization_id: orgId, has_access: true }, error: null }));
  });

  it('oculta sucursales y suscripción previas y descarta respuestas tardías', async () => {
    let finishBranchesA!: (value: unknown) => void;
    let finishAccessA!: (value: unknown) => void;
    mock.readBranches.mockImplementation((orgId: string) => orgId === 'org-a'
      ? new Promise(resolve => { finishBranchesA = resolve; })
      : Promise.resolve(branchResult(orgId)));
    mock.readAccess.mockImplementation((orgId: string) => orgId === 'org-a'
      ? new Promise(resolve => { finishAccessA = resolve; })
      : Promise.resolve({ data: { organization_id: orgId, has_access: true }, error: null }));
    const view = render(<SucursalProvider><Snapshot /></SucursalProvider>);
    await waitFor(() => expect(finishBranchesA).toBeTypeOf('function'));
    await waitFor(() => expect(finishAccessA).toBeTypeOf('function'));
    mock.auth.user = { id: 'b' };
    mock.auth.profile = { default_sucursal_id: 'branch-b' };
    mock.org.organization = { id: 'org-b' };
    view.rerender(<SucursalProvider><Snapshot /></SucursalProvider>);
    expect(state()).toEqual({ branch: null, branches: [], access: null });
    await waitFor(() => expect(state()).toEqual({ branch: 'branch-b', branches: ['branch-b'], access: 'org-b' }));
    await act(async () => {
      finishBranchesA(branchResult('org-a'));
      finishAccessA({ data: { organization_id: 'org-a', has_access: true }, error: null });
    });
    expect(state()).toEqual({ branch: 'branch-b', branches: ['branch-b'], access: 'org-b' });
  });
});
