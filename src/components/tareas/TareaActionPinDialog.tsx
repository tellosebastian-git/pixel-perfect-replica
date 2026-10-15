import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function TareaActionPinDialog({ onSubmit, onClose, pending }: {
  onSubmit: (pin: string) => Promise<void>; onClose: () => void; pending: boolean;
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  return <Dialog open onOpenChange={open => { if (!open && !pending) onClose(); }}>
    <DialogContent>
      <DialogHeader><DialogTitle>Confirmar acción con PIN</DialogTitle>
        <DialogDescription>Ingresá tu PIN. Se verificará tu identidad y permiso para esta tarea.</DialogDescription>
      </DialogHeader>
      <form className="space-y-4" onSubmit={async e => {
        e.preventDefault(); if (pending) return;
        setError('');
        try { await onSubmit(pin); } catch (e) { setPin(''); setError(e instanceof Error ? e.message : 'No pudimos realizar la acción.'); }
      }}>
        <Label htmlFor="tarea-action-pin">PIN</Label>
        <Input id="tarea-action-pin" type="password" inputMode="numeric" autoComplete="off" autoFocus
          maxLength={6} value={pin} disabled={pending} onChange={e => setPin(e.target.value.replace(/\D/g,''))} />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>Cancelar</Button>
          <Button disabled={pending || pin.length < 4}>{pending ? 'Confirmando…' : 'Confirmar acción'}</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
