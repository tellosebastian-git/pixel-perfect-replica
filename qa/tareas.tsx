/* eslint-disable react-refresh/only-export-components -- entrada del arnés local: monta la app de QA, no exporta componentes. */
// QA local de Principal → Tareas con datos sintéticos. No es una ruta de producción ni una entrada del build.
// Servir con: npx vite --config qa/vite.tareas.config.ts — y abrir /qa/tareas.html?rol=owner|manager|barbero|cuenta&estado=normal|aldia|nuevo|error|lento
// Aviso semanal: &hoy=AAAA-MM-DD (día de la organización), &aviso=listo|no, &pref=off. Se monta como en Index (coordinador + <main>).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TareasPanel } from '@/components/TareasPanel';
import { AvisosGlobalesProvider, useAvisoGlobal } from '@/components/avisos/AvisosGlobales';
import { AvisoSemanalTareas } from '@/components/tareas/AvisoSemanalTareas';
import '@/index.css';

const params = new URLSearchParams(location.search);
/** Sin onboarding ni resumen mensual en el arnés: el aviso de Tareas es el único candidato. */
function OtrosAvisos() {
  useAvisoGlobal('onboarding', 'no');
  useAvisoGlobal('resumen', 'no');
  return null;
}

const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <AvisosGlobalesProvider entrada="qa">
          <OtrosAvisos />
          <AvisoSemanalTareas disponible={params.get('aviso') !== 'no'} />
          <main className="min-h-svh bg-background">
            <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 md:px-8">
              <p className="mb-4 text-xs text-status-warning-foreground">QA local · Datos sintéticos · Sin conexión a APIs ni escrituras reales</p>
              <TareasPanel barbers={[]} />
            </div>
          </main>
        </AvisosGlobalesProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
