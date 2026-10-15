import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PartnerAuthForm } from './PartnerAuthForm';
const mock = vi.hoisted(() => ({ call: vi.fn(), update: vi.fn(), login: vi.fn(), reset: vi.fn() }));
vi.mock('@/lib/partnerApi', () => ({
  callPartner: mock.call,
  PartnerApiError: class extends Error {},
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      updateUser: mock.update,
      signInWithPassword: mock.login,
      resetPasswordForEmail: mock.reset,
    },
  },
}));
describe('partner access', () => {
  beforeEach(() => {
    mock.call.mockReset();
    mock.update.mockReset();
    mock.login.mockReset();
    mock.reset.mockReset();
  });
  it('does not permit creator registration while the program is closed', () => {
    render(<PartnerAuthForm initialMode="register" enabled={false} />);
    expect(screen.getByRole('button', { name: 'Crear mi cuenta' })).toBeDisabled();
  });
  it('requires acceptance and a strong password before contacting registration', async () => {
    render(<PartnerAuthForm initialMode="register" enabled />);
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Test Creator' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'creator@example.com' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear mi cuenta' }));
    await screen.findByText('Aceptá las condiciones para registrarte.');
    expect(mock.call).not.toHaveBeenCalled();
  });
  it('recovers the authenticated identity without asking for a second email', async () => {
    mock.update.mockResolvedValue({ error: null });
    const onRecovered = vi.fn();
    render(<PartnerAuthForm enabled recovery onRecovered={onRecovered} />);
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Nueva contraseña'), {
      target: { value: 'new-password-12345' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }));
    await waitFor(() =>
      expect(mock.update).toHaveBeenCalledWith({ password: 'new-password-12345' }),
    );
    expect(onRecovered).toHaveBeenCalled();
  });
});
