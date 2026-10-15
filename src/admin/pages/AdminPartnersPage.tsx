import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Users, CreditCard } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/EmptyState';
import { AdminCollectionCard } from '@/admin/components/AdminCollectionCard';
import { AdminPagination } from '@/admin/components/AdminPagination';
import {
  PartnerAdminDrawer,
  type PartnerAdminOperation,
} from '@/admin/components/PartnerAdminDrawer';
import { callPartner, partnerMoney } from '@/lib/partnerApi';
import type { PartnerAdminSummary } from '@/types/partners';

export default function AdminPartnersPage() {
  const [page, setPage] = useState(1);
  const [operation, setOperation] = useState<PartnerAdminOperation | null>(null);
  const query = useQuery({
    queryKey: ['platform-admin', 'partners', page],
    queryFn: () => callPartner<PartnerAdminSummary>('admin_summary', { page, pageSize: 25 }, true),
    retry: 1,
  });
  const data = query.data;
  const refresh = () => void query.refetch();
  return (
    <div>
      <PageHeader
        title="Aliados"
        subtitle="Códigos, convenios y liquidaciones del programa de referidos."
        icon={Users}
      />
      <AdminCollectionCard
        toolbar={
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-lg font-medium">Directorio de aliados</h2>
            <Button
              disabled={!data}
              onClick={() => setOperation({ action: 'admin_prepare_payouts' })}
            >
              Preparar liquidación mensual
            </Button>
          </div>
        }
        isPending={query.isPending}
        isError={query.isError}
        hasData={Boolean(data)}
        isEmpty={Boolean(data && !data.partners.length)}
        isFetching={query.isFetching}
        errorMessage="No pudimos cargar el programa de aliados."
        emptyIcon={Users}
        emptyTitle="Todavía no hay aliados"
        emptyDescription="Las adhesiones aparecerán cuando el programa esté habilitado."
        onRetry={refresh}
        footer={
          data ? (
            <AdminPagination
              page={page}
              pageSize={25}
              total={data.totalPartners}
              onPageChange={setPage}
            />
          ) : undefined
        }
      >
        <ul className="divide-y">
          {data?.partners.map((partner) => (
            <li key={partner.id} className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div className="min-w-0">
                <p className="break-words text-base font-medium">{partner.name}</p>
                <p className="mt-1 break-all text-sm text-muted-foreground">
                  {partner.code} · {partner.percent}% · {partner.qualifiedOrganizations} calificadas
                  · {partner.suspended ? 'Suspendido' : 'Activo'}
                </p>
                <p className="mt-1 text-sm tabular-nums">
                  Disponible: {partnerMoney(partner.availableCents)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() =>
                    setOperation({
                      action: 'admin_agreement',
                      id: partner.id,
                      revision: partner.revision,
                      name: partner.name,
                    })
                  }
                >
                  Convenio
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    setOperation({
                      action: 'admin_verify_payout',
                      id: partner.id,
                      name: partner.name,
                    })
                  }
                >
                  {partner.payoutVerified ? 'Revisar cuenta' : 'Verificar cobro'}
                </Button>
                <Button
                  variant="ghost"
                  disabled={partner.suspended}
                  onClick={() =>
                    setOperation({
                      action: 'admin_suspend',
                      id: partner.id,
                      revision: partner.revision,
                      name: partner.name,
                    })
                  }
                >
                  Suspender
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </AdminCollectionCard>
      {data && (
        <>
          <section className="mt-8 rounded-container border bg-card">
            <div className="border-b p-5">
              <h2 className="text-lg font-medium">Liquidaciones por revisar</h2>
            </div>
            {!data.payouts.length ? (
              <EmptyState
                icon={CreditCard}
                title="Sin liquidaciones pendientes"
                description="Prepará un lote mensual cuando haya comisiones disponibles y cuentas verificadas."
                className="p-6"
              />
            ) : (
              <ul className="divide-y">
                {data.payouts.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-4 p-5"
                  >
                    <div>
                      <p className="font-medium">{item.name}</p>
                      <p className="mt-1 text-lg tabular-nums">{partnerMoney(item.amountCents)}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Cuenta terminada en {item.account.slice(-4)} ·{' '}
                        {item.status === 'paid'
                          ? 'Pagada'
                          : item.verified
                            ? 'Verificada'
                            : 'Sin verificar'}
                      </p>
                    </div>
                    <Button
                      disabled={!item.verified || item.status !== 'review'}
                      variant="outline"
                      onClick={() =>
                        setOperation({
                          action: 'admin_mark_paid',
                          payout: item,
                          revision: item.revision,
                          name: item.name,
                        })
                      }
                    >
                      Registrar transferencia
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {data.incidents.length > 0 && (
            <section className="mt-8 rounded-container border bg-card">
              <div className="border-b p-5">
                <h2 className="text-lg font-medium">Incidencias</h2>
              </div>
              <ul className="divide-y">
                {data.incidents.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-4 p-5"
                  >
                    <p className="max-w-xl text-sm">{item.message}</p>
                    <Button
                      variant="outline"
                      onClick={() =>
                        setOperation({
                          action: 'admin_resolve_incident',
                          id: item.id,
                          revision: item.revision,
                        })
                      }
                    >
                      Resolver
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      {operation && (
        <PartnerAdminDrawer
          operation={operation}
          onClose={() => setOperation(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
