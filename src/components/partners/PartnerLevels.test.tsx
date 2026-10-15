import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PartnerLevelExplorer, PartnerLevelProgress } from './PartnerLevels';
import Partners from '@/pages/Partners';

afterEach(cleanup);
describe('referral levels and disclosure', () => {
  it('lets visitors explore the level without claiming that it is their earned level', () => {
    render(<PartnerLevelExplorer />);
    const button = screen.getByRole('button', { name: /Nivel 3/ });
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Elegí un nivel para conocerlo.')).toBeInTheDocument();
    expect(screen.getByText('20 barberías calificadas')).toBeInTheDocument();
  });
  it.each([[4, 1, 2], [19, 2, 3]])('shows the remaining qualified referral at %s, not all registrations', (qualified, level, next) => {
    render(<PartnerLevelProgress qualified={qualified} registrations={100} />);
    expect(screen.getByText(`Nivel ${level}`, { exact: false })).toBeInTheDocument();
    expect(screen.getByText(`Te falta 1 barbería calificada para el nivel ${next} y una comisión del ${next * 10}%.`)).toBeInTheDocument();
  });
  it('recognizes the maximum automatic level', () => {
    render(<PartnerLevelProgress qualified={20} registrations={25} />);
    expect(screen.getByText('Alcanzaste el nivel 3, el máximo del programa automático.')).toBeInTheDocument();
  });
  it('keeps a custom agreement distinct from the earned referral level', () => {
    render(<PartnerLevelProgress qualified={5} registrations={8} agreementPercent={100} />);
    expect(screen.getByText(/Tu convenio vigente establece una comisión del/)).toHaveTextContent('100%');
    expect(screen.getByText('Nivel 2', { exact: false })).toHaveTextContent('20%');
  });
  it('starts with conditions collapsed', () => {
    const { container }=render(<MemoryRouter><Partners /></MemoryRouter>);
    expect(container.querySelector('details')).not.toHaveAttribute('open');
    expect(screen.queryByText(/Instagram/)).not.toBeInTheDocument();
  });
  it('opens the conditions when following their direct link', () => {
    const { container }=render(<MemoryRouter initialEntries={['/aliados#condiciones']}><Partners /></MemoryRouter>);
    expect(container.querySelector('details')).toHaveAttribute('open');
  });
});
