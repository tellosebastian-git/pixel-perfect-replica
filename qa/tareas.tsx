// QA local de Principal → Tareas con datos sintéticos. No es una ruta de producción ni una entrada del build.
// Servir con: npx vite --config qa/vite.tareas.config.ts — y abrir /qa/tareas.html?rol=owner|manager|barbero|cuenta&estado=normal|aldia|nuevo|error|lento
import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TareasPanel } from '@/components/TareasPanel';
import '@/index.css';

const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <div className="min-h-svh bg-background">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 md:px-8">
            <p className="mb-4 text-xs text-status-warning-foreground">QA local · Datos sintéticos · Sin conexión a APIs ni escrituras reales</p>
            <TareasPanel barbers={[]} />
          </div>
        </div>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
