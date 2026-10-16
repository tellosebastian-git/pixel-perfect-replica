import { useEffect } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AvisosGlobalesProvider, useAvisoGlobal } from './AvisosGlobales';
import { elegirAviso, reiniciarAvisosGlobales, superficieDisponible, type AvisoGlobal, type EstadoAviso } from '@/lib/avisosGlobales';

type Estados = Record<AvisoGlobal, EstadoAviso>;
const IDS: AvisoGlobal[] = ['onboarding', 'resumen', 'tareas'];

function Candidato({ id, estado }: { id: AvisoGlobal; estado: EstadoAviso }) {
  const { abierto, cerrar } = useAvisoGlobal(id, estado);
  // Como `OnboardingEnAvisos` (Index): el tour que termina libera su lugar.
  useEffect(() => { if (id === 'onboarding' && abierto && estado !== 'listo') cerrar(); }, [id, abierto, estado, cerrar]);
  return abierto ? <section aria-label={`aviso ${id}`}><button type="button" onClick={cerrar}>Cerrar {id}</button></section> : null;
}

function montar(estados: Estados, entrada: string | null = 'u1:o1') {
  const client = new QueryClient();
  const ui = (e: Estados, ent: string | null) => (
    <QueryClientProvider client={client}>
      <AvisosGlobalesProvider entrada={ent}>
        <main><button type="button">Cobrar</button><input aria-label="Monto" /></main>
        {IDS.map(id => <Candidato key={id} id={id} estado={e[id]} />)}
      </AvisosGlobalesProvider>
    </QueryClientProvider>
  );
  const r = render(ui(estados, entrada));
  return { ...r, cambiar: (e: Estados, ent: string | null = entrada) => r.rerender(ui(e, ent)) };
}
const esperar = (ms = 700) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const abiertos = () => IDS.filter(id => screen.queryByRole('region', { name: `aviso ${id}` }));

beforeEach(() => { vi.useFakeTimers(); reiniciarAvisosGlobales(); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

describe('prioridad de avisos globales', () => {
  it('onboarding > resumen mensual > Tareas; espera mientras uno de mayor prioridad no se resolvió', () => {
    expect(elegirAviso({ onboarding: 'listo', resumen: 'listo', tareas: 'listo' })).toBe('onboarding');
    expect(elegirAviso({ onboarding: 'no', resumen: 'listo', tareas: 'listo' })).toBe('resumen');
    expect(elegirAviso({ onboarding: 'no', resumen: 'no', tareas: 'listo' })).toBe('tareas');
    expect(elegirAviso({ onboarding: 'pendiente', resumen: 'no', tareas: 'listo' })).toBe('esperar');
    expect(elegirAviso({ onboarding: 'no', tareas: 'listo' })).toBe('esperar');
    expect(elegirAviso({ onboarding: 'no', resumen: 'no', tareas: 'no' })).toBe('ninguno');
  });

  it('con onboarding, Tareas no aparece en esa entrada (tampoco cuando el tour termina)', async () => {
    const v = montar({ onboarding: 'listo', resumen: 'no', tareas: 'listo' });
    await esperar();
    expect(abiertos()).toEqual(['onboarding']);
    v.cambiar({ onboarding: 'no', resumen: 'no', tareas: 'listo' });
    await esperar(2000);
    expect(abiertos()).toEqual([]);
  });

  it('el resumen mensual va antes que Tareas y al cerrarlo no se encadena el aviso de Tareas', async () => {
    montar({ onboarding: 'no', resumen: 'listo', tareas: 'listo' });
    await esperar();
    expect(abiertos()).toEqual(['resumen']);
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar resumen' }));
    await esperar(2000);
    expect(abiertos()).toEqual([]);
  });

  it('Tareas espera a que se resuelvan los de mayor prioridad y después aparece solo', async () => {
    const v = montar({ onboarding: 'pendiente', resumen: 'no', tareas: 'listo' });
    await esperar(2000);
    expect(abiertos()).toEqual([]);
    v.cambiar({ onboarding: 'no', resumen: 'no', tareas: 'listo' });
    await esperar();
    expect(abiertos()).toEqual(['tareas']);
  });

  it('nada que mostrar: la entrada queda resuelta y no aparece nada después', async () => {
    const v = montar({ onboarding: 'no', resumen: 'no', tareas: 'no' });
    await esperar();
    v.cambiar({ onboarding: 'no', resumen: 'no', tareas: 'listo' });
    await esperar(2000);
    expect(abiertos()).toEqual([]);
  });
});

describe('superficie disponible', () => {
  it('no se abre encima de una ventana abierta ni con un campo en edición; espera a que se libere', async () => {
    const ventana = document.createElement('div');
    ventana.setAttribute('role', 'dialog');
    document.body.appendChild(ventana);
    montar({ onboarding: 'no', resumen: 'no', tareas: 'listo' });
    await esperar(2000);
    expect(abiertos()).toEqual([]);
    ventana.remove();
    await esperar(1500);
    expect(abiertos()).toEqual(['tareas']);
  });

  it('detecta drawers, menús y campos con foco', () => {
    expect(superficieDisponible()).toBe(true);
    const menu = document.createElement('div');
    menu.setAttribute('data-radix-popper-content-wrapper', '');
    document.body.appendChild(menu);
    expect(superficieDisponible()).toBe(false);
    menu.remove();
    const campo = document.createElement('textarea');
    document.body.appendChild(campo);
    campo.focus();
    expect(superficieDisponible()).toBe(false);
  });

  it('si la persona ya empezó a trabajar en la pantalla, queda para la próxima entrada', async () => {
    const v = montar({ onboarding: 'no', resumen: 'pendiente', tareas: 'listo' });
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Cobrar' }));
    v.cambiar({ onboarding: 'no', resumen: 'no', tareas: 'listo' });
    await esperar(2000);
    expect(abiertos()).toEqual([]);
    // Próxima entrada (nueva carga de la app): vuelve a evaluarse.
    v.unmount();
    reiniciarAvisosGlobales();
    montar({ onboarding: 'no', resumen: 'no', tareas: 'listo' });
    await esperar();
    expect(abiertos()).toEqual(['tareas']);
  });

  it('otra organización es otra entrada: lo decidido en una no se reutiliza en la otra', async () => {
    const v = montar({ onboarding: 'no', resumen: 'no', tareas: 'listo' }, 'u1:o1');
    await esperar();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar tareas' }));
    expect(abiertos()).toEqual([]);
    v.cambiar({ onboarding: 'no', resumen: 'no', tareas: 'listo' }, 'u1:o2');
    await esperar();
    expect(abiertos()).toEqual(['tareas']);
  });

  it('sin usuario y organización cargados no decide nada', async () => {
    montar({ onboarding: 'no', resumen: 'no', tareas: 'listo' }, null);
    await esperar(2000);
    expect(abiertos()).toEqual([]);
  });
});
