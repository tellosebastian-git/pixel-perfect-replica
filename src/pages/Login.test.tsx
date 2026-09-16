import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Login from './Login';

const mock = vi.hoisted(() => ({
  auth: {
    user: null as null | { id: string },
    session: null as null | { user: { id: string } },
    isLoading: true,
    authError: null as string | null,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    retrySessionRestore: vi.fn(),
  },
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => mock.auth }));
vi.mock('@/hooks/useSubscriptionPlans', () => ({
  useSubscriptionPlans: () => ({ data: [], isLoading: false, isError: false }),
  formatSubscriptionPrice: () => '$0',
}));
vi.mock('@/hooks/useMetaPixel', () => ({ useMetaPixel: () => undefined }));
vi.mock('@/components/consent/CookieConsentBanner', () => ({ CookieConsentBanner: () => null }));
vi.mock('@/components/LoadingScreen', () => ({
  LoadingScreen: () => <p>Verificando sesión...</p>,
  RecoverableErrorScreen: () => <p>Error recuperable</p>,
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { signOut: vi.fn(), getSession: vi.fn(), resetPasswordForEmail: vi.fn() } },
}));

function renderLogin(path = '/login') {
  return render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/app/:orgSlug" element={<p>App tenant</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('/login tenant', () => {
  beforeEach(() => {
    mock.auth.user = null;
    mock.auth.session = null;
    mock.auth.isLoading = true;
    mock.auth.authError = null;
    mock.auth.signIn.mockReset();
    mock.auth.signUp.mockReset();
    mock.auth.signOut.mockReset();
    mock.auth.retrySessionRestore.mockReset();
  });

  it('espera INITIAL_SESSION sin mostrar fugazmente el formulario', () => {
    const view = renderLogin();
    expect(screen.getByText('Verificando sesión...')).toBeInTheDocument();
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    mock.auth.isLoading = false;
    view.rerender(
      <MemoryRouter initialEntries={['/login']}>
        <Routes><Route path="/login" element={<Login />} /></Routes>
      </MemoryRouter>,
    );
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('abre la app con una sesión restaurada sin pedir contraseña', async () => {
    mock.auth.isLoading = false;
    mock.auth.user = { id: 'a' };
    mock.auth.session = { user: { id: 'a' } };
    renderLogin();
    await waitFor(() => expect(screen.getByText('App tenant')).toBeInTheDocument());
    expect(mock.auth.signIn).not.toHaveBeenCalled();
  });

  it('no redirige el registro explícito aunque haya sesión tenant', () => {
    mock.auth.isLoading = false;
    mock.auth.user = { id: 'a' };
    mock.auth.session = { user: { id: 'a' } };
    renderLogin('/login?mode=signup');
    expect(screen.getByText('Creá tu barbería')).toBeInTheDocument();
    expect(screen.queryByText('App tenant')).not.toBeInTheDocument();
  });

  it('navega tras login nuevo solo cuando el contexto acepta al mismo usuario', async () => {
    mock.auth.isLoading = false;
    let resolveSignIn!: (value: { error: null; userId: string }) => void;
    mock.auth.signIn.mockReturnValue(new Promise(resolve => { resolveSignIn = resolve; }));
    const view = renderLogin();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@example.com' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'clave123' } });
    fireEvent.click(screen.getByRole('button', { name: /Ingresar/ }));
    mock.auth.user = { id: 'b' };
    mock.auth.session = { user: { id: 'b' } };
    view.rerender(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/app/:orgSlug" element={<p>App tenant</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.queryByText('App tenant')).not.toBeInTheDocument();
    resolveSignIn({ error: null, userId: 'a' });
    await waitFor(() => expect(mock.auth.signIn).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('App tenant')).not.toBeInTheDocument();
    mock.auth.user = { id: 'a' };
    mock.auth.session = { user: { id: 'a' } };
    view.rerender(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/app/:orgSlug" element={<p>App tenant</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('App tenant')).toBeInTheDocument());
  });
});
