import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';

const mock = vi.hoisted(() => ({
  listener: null as ((event: string, session: unknown) => void) | null,
  read: vi.fn(),
  getSession: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (listener: (event: string, session: unknown) => void) => {
        mock.listener = listener;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      getSession: mock.getSession,
      signInWithPassword: mock.signInWithPassword,
      signOut: mock.signOut,
    },
    from: (table: string) => {
      let id = '';
      const query = {
        select: () => query,
        eq: (_column: string, value: string) => { id = value; return query; },
        maybeSingle: () => query,
        abortSignal: (signal: AbortSignal) => mock.read(table, id, signal),
      };
      return query;
    },
  },
}));

function sessionFor(id: string): Session {
  return { user: { id, user_metadata: {}, email_confirmed_at: '2026-01-01' } } as unknown as Session;
}

function resultFor(table: string, id: string) {
  return table === 'profiles'
    ? { data: { id, email: `${id}@example.com`, full_name: id, barbero_id: null, organization_id: `org-${id}`, default_sucursal_id: null }, error: null, status: 200 }
    : { data: [{ role: 'owner' }], error: null, status: 200 };
}

function Snapshot() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="auth-state">{JSON.stringify({
        user: auth.user?.id ?? null,
        profile: auth.profile?.id ?? null,
        organization: auth.profile?.organization_id ?? null,
        roles: auth.roles,
        loading: auth.isLoading,
        error: auth.authError,
      })}</span>
      <button onClick={() => void auth.refreshProfile()}>Reintentar perfil</button>
      <button onClick={() => void auth.signOut()}>Cerrar sesión</button>
    </div>
  );
}

function state() {
  return JSON.parse(screen.getByTestId('auth-state').textContent ?? '{}');
}

function emit(event: string, session: Session | null) {
  act(() => mock.listener?.(event, session));
}

describe('AuthProvider tenant', () => {
  beforeEach(() => {
    mock.listener = null;
    mock.read.mockReset().mockImplementation((table: string, id: string) => Promise.resolve(resultFor(table, id)));
    mock.getSession.mockReset();
    mock.signInWithPassword.mockReset();
    mock.signOut.mockReset().mockResolvedValue({ error: null });
  });

  it('usa INITIAL_SESSION como único arranque y no consulta un perfil sin sesión', async () => {
    render(<AuthProvider><Snapshot /></AuthProvider>);
    expect(state().loading).toBe(true);
    emit('INITIAL_SESSION', null);
    await waitFor(() => expect(state().loading).toBe(false));
    expect(state().user).toBe(null);
    expect(mock.getSession).not.toHaveBeenCalled();
    expect(mock.read).not.toHaveBeenCalled();
  });

  it('restaura sesión, carga un solo perfil y no duplica lecturas al renovar el token', async () => {
    render(<AuthProvider><Snapshot /></AuthProvider>);
    emit('INITIAL_SESSION', sessionFor('a'));
    await waitFor(() => expect(state().organization).toBe('org-a'));
    expect(mock.read.mock.calls.filter(call => call[0] === 'profiles')).toHaveLength(1);
    emit('TOKEN_REFRESHED', sessionFor('a'));
    await waitFor(() => expect(state().loading).toBe(false));
    expect(mock.read.mock.calls.filter(call => call[0] === 'profiles')).toHaveLength(1);
  });

  it('procesa INITIAL_SESSION tras el replay de efectos de StrictMode', async () => {
    render(<StrictMode><AuthProvider><Snapshot /></AuthProvider></StrictMode>);
    emit('INITIAL_SESSION', sessionFor('a'));
    await waitFor(() => expect(state().organization).toBe('org-a'));
    expect(state().loading).toBe(false);
  });

  it('reintenta un fallo REST transitorio y conserva la sesión', async () => {
    let profileReads = 0;
    mock.read.mockImplementation((table: string, id: string) => {
      if (table === 'profiles' && ++profileReads === 1) {
        return Promise.resolve({ data: null, error: { message: 'Failed to fetch' }, status: 0 });
      }
      return Promise.resolve(resultFor(table, id));
    });
    render(<AuthProvider><Snapshot /></AuthProvider>);
    emit('INITIAL_SESSION', sessionFor('a'));
    await waitFor(() => expect(state().profile).toBe('a'), { timeout: 2500 });
    expect(profileReads).toBe(2);
    expect(state().user).toBe('a');
  });

  it('no reintenta 401 y permite una lectura nueva sin contraseña', async () => {
    let profileReads = 0;
    mock.read.mockImplementation((table: string, id: string) => {
      if (table === 'profiles' && ++profileReads === 1) {
        return Promise.resolve({ data: null, error: { message: 'Unauthorized' }, status: 401 });
      }
      return Promise.resolve(resultFor(table, id));
    });
    render(<AuthProvider><Snapshot /></AuthProvider>);
    emit('INITIAL_SESSION', sessionFor('a'));
    await waitFor(() => expect(state().error).toBeTruthy());
    expect(profileReads).toBe(1);
    expect(state().user).toBe('a');
    fireEvent.click(screen.getByText('Reintentar perfil'));
    await waitFor(() => expect(state().profile).toBe('a'));
    expect(profileReads).toBe(2);
    expect(mock.signInWithPassword).not.toHaveBeenCalled();
  });

  it('descarta una respuesta tardía al cambiar de usuario y al cerrar sesión', async () => {
    let finishA!: (value: unknown) => void;
    mock.read.mockImplementation((table: string, id: string) => {
      if (table === 'profiles' && id === 'a') return new Promise(resolve => { finishA = resolve; });
      return Promise.resolve(resultFor(table, id));
    });
    render(<AuthProvider><Snapshot /></AuthProvider>);
    emit('INITIAL_SESSION', sessionFor('a'));
    await waitFor(() => expect(finishA).toBeTypeOf('function'));
    emit('SIGNED_IN', sessionFor('b'));
    await waitFor(() => expect(state().profile).toBe('b'));
    await act(async () => finishA(resultFor('profiles', 'a')));
    expect(state().profile).toBe('b');
    fireEvent.click(screen.getByText('Cerrar sesión'));
    await waitFor(() => expect(state().user).toBe(null));
    expect(state().organization).toBe(null);
    expect(state().roles).toEqual([]);
  });
});
