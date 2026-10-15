import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { TareaActionPinDialog } from './TareaActionPinDialog';
it('conserva el diálogo, limpia el PIN y muestra el error si el servidor rechaza',async()=>{
  const close=vi.fn();const submit=vi.fn().mockRejectedValue(new Error('No tenés permiso para esta tarea.'));
  render(<TareaActionPinDialog onSubmit={submit} onClose={close} pending={false}/>);
  fireEvent.change(screen.getByLabelText('PIN'),{target:{value:'1234'}});
  fireEvent.click(screen.getByRole('button',{name:'Confirmar acción'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('No tenés permiso');
  expect(screen.getByLabelText('PIN')).toHaveValue('');expect(close).not.toHaveBeenCalled();
});
it('bloquea confirmación y cancelación mientras espera al servidor',()=>{
  render(<TareaActionPinDialog onSubmit={vi.fn()} onClose={vi.fn()} pending/>);
  expect(screen.getByRole('button',{name:'Confirmando…'})).toBeDisabled();
  expect(screen.getByRole('button',{name:'Cancelar'})).toBeDisabled();
});
