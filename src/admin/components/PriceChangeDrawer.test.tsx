import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PriceChangeDrawer } from '@/admin/components/PriceChangeDrawer';
import type { PlatformAdminPlanDto } from '@/types/platformAdmin';

const plan: PlatformAdminPlanDto = {
  code: 'profesional',
  name: 'Profesional',
  description: 'Plan profesional',
  amountArs: 60_000,
  priceVersion: 3,
  billingPeriod: 'monthly',
  isActive: true,
  sortOrder: 2,
  updatedAt: '2026-09-04T10:00:00.000Z',
};

describe('PriceChangeDrawer', () => {
  it('exige impacto, motivo, reautenticación y confirmación antes de aplicar', async () => {
    const onPreview = vi.fn().mockResolvedValue({
      plan,
      impact: {
        eligibleActiveRenewals: 12,
        pendingCheckouts: 2,
        excluded: 1,
        totalAffected: 14,
      },
      exclusions: [{ reason: 'missing_preapproval', count: 1 }],
    });
    const onApply = vi.fn().mockResolvedValue({
      plan: { ...plan, amountArs: 70_000, priceVersion: 4 },
      batch: { id: 'batch-1' },
    });
    const onApplied = vi.fn();

    render(
      <PriceChangeDrawer
        open
        plan={plan}
        onOpenChange={vi.fn()}
        onPreview={onPreview}
        onApply={onApply}
        onApplied={onApplied}
      />,
    );

    await waitFor(() => expect(screen.getByText('Renovaciones activas')).toBeInTheDocument());
    expect(onPreview).toHaveBeenCalledWith('profesional');

    fireEvent.change(screen.getByLabelText('Importe en pesos argentinos'), { target: { value: '70.000' } });
    fireEvent.change(screen.getByLabelText('Motivo del cambio'), { target: { value: 'Actualización comercial anual' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'clave-de-prueba' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar precio' }));

    await waitFor(() => expect(onApply).toHaveBeenCalledWith({
      planCode: 'profesional',
      newAmountArs: 70_000,
      expectedAmountArs: 60_000,
      expectedPriceVersion: 3,
      expectedUpdatedAt: plan.updatedAt,
      reason: 'Actualización comercial anual',
      password: 'clave-de-prueba',
    }));
    await waitFor(() => expect(onApplied).toHaveBeenCalled());
  });

  it('explica cuando la edición de precios está deshabilitada en producción', async () => {
    const onPreview = vi.fn().mockResolvedValue({
      plan,
      impact: {
        eligibleActiveRenewals: 12,
        pendingCheckouts: 2,
        excluded: 1,
        totalAffected: 14,
      },
      exclusions: [{ reason: 'missing_preapproval', count: 1 }],
    });
    const onApply = vi.fn().mockRejectedValue({
      status: 503,
      code: 'MUTATIONS_DISABLED',
    });

    render(
      <PriceChangeDrawer
        open
        plan={plan}
        onOpenChange={vi.fn()}
        onPreview={onPreview}
        onApply={onApply}
        onApplied={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText('Renovaciones activas')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Importe en pesos argentinos'), { target: { value: '70.000' } });
    fireEvent.change(screen.getByLabelText('Motivo del cambio'), { target: { value: 'Actualización comercial anual' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'clave-de-prueba' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar precio' }));

    const disabledMessage = await screen.findByText(
      'La edición de precios está deshabilitada en producción. Habilitala desde la configuración del servidor y volvé a intentarlo.',
    );
    expect(disabledMessage).toHaveAttribute('role', 'alert');
    expect(screen.queryByText(/Verificá la contraseña/)).not.toBeInTheDocument();
  });
});
