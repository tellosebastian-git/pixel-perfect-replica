import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useSucursal } from '@/contexts/SucursalContext';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { calcNextDate } from '@/lib/recurrence';

export interface GastoRecurrente {
  id: string;
  organization_id: string;
  sucursal_id: string | null;
  categoria: string;
  tipo_costo: string;
  monto: number;
  descripcion: string | null;
  repeat_preset: string;
  repeat_frequency: string | null;
  repeat_interval: number | null;
  repeat_byweekday: number[] | null;
  fecha_inicio: string;
  proxima_fecha: string;
  activo: boolean;
  created_at: string;
}

export interface GastoRecurrenteInsert {
  categoria: string;
  tipo_costo: string;
  monto: number;
  descripcion?: string;
  repeat_preset: string;
  repeat_frequency?: string;
  repeat_interval?: number;
  repeat_byweekday?: number[];
  fecha_inicio: string;
}


export function useGastosRecurrentes() {
  const { organization } = useOrganization();
  const { currentSucursal } = useSucursal();
  const [recurrentes, setRecurrentes] = useState<GastoRecurrente[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchRecurrentes = useCallback(async () => {
    if (!organization?.id) return;
    setIsLoading(true);
    try {
      let query = supabase
        .from('gastos_recurrentes')
        .select('*')
        .eq('organization_id', organization.id)
        .order('created_at', { ascending: false });

      if (currentSucursal) {
        query = query.eq('sucursal_id', currentSucursal.id);
      }

      const { data, error } = await query;
      if (error) throw error;
      setRecurrentes((data as GastoRecurrente[]) || []);
    } catch (error) {
      console.error('Error fetching gastos recurrentes:', error);
    } finally {
      setIsLoading(false);
    }
  }, [organization?.id, currentSucursal]);

  useEffect(() => {
    fetchRecurrentes();
  }, [fetchRecurrentes]);

  const syncGastosRecurrentes = useCallback(async () => {
    if (!organization?.id) return false;
    try {
      let query = supabase
        .from('gastos_recurrentes')
        .select('*')
        .eq('organization_id', organization.id)
        .eq('activo', true)
        .lte('proxima_fecha', format(new Date(), 'yyyy-MM-dd'));

      if (currentSucursal) {
        query = query.eq('sucursal_id', currentSucursal.id);
      }

      const { data: pendientes, error } = await query;
      if (error || !pendientes?.length) return false;

      const today = new Date();
      today.setHours(23, 59, 59, 999);
      let inserted = false;

      for (const rec of pendientes as GastoRecurrente[]) {
        let nextDate = new Date(rec.proxima_fecha + 'T12:00:00');

        while (nextDate <= today) {
          // Insert egreso
          await supabase.from('Egresos').insert({
            Categoria: rec.categoria,
            tipo_costo: rec.tipo_costo,
            Monto: rec.monto,
            Descripcion: rec.descripcion,
            Fecha: nextDate.toISOString(),
            organization_id: rec.organization_id,
            sucursal_id: rec.sucursal_id,
            gasto_recurrente_id: rec.id,
          });
          inserted = true;

          nextDate = calcNextDate(
            nextDate,
            rec.repeat_preset,
            rec.repeat_frequency,
            rec.repeat_interval,
            rec.repeat_byweekday,
          );
        }

        // Update proxima_fecha
        await supabase
          .from('gastos_recurrentes')
          .update({ proxima_fecha: format(nextDate, 'yyyy-MM-dd') })
          .eq('id', rec.id);
      }

      if (inserted) await fetchRecurrentes();
      return inserted;
    } catch (error) {
      console.error('Error syncing gastos recurrentes:', error);
      return false;
    }
  }, [organization?.id, currentSucursal, fetchRecurrentes]);

  const addRecurrente = async (data: GastoRecurrenteInsert) => {
    if (!organization?.id) {
      toast.error('No se encontró la organización');
      return false;
    }
    try {
      const { error } = await supabase.from('gastos_recurrentes').insert({
        organization_id: organization.id,
        sucursal_id: currentSucursal?.id || null,
        categoria: data.categoria,
        tipo_costo: data.tipo_costo,
        monto: data.monto,
        descripcion: data.descripcion || null,
        repeat_preset: data.repeat_preset,
        repeat_frequency: data.repeat_frequency || null,
        repeat_interval: data.repeat_interval || 1,
        repeat_byweekday: data.repeat_byweekday || null,
        fecha_inicio: data.fecha_inicio,
        proxima_fecha: data.fecha_inicio,
      });
      if (error) throw error;
      toast.success('Gasto recurrente creado');
      await fetchRecurrentes();
      return true;
    } catch (error: any) {
      console.error('Error adding gasto recurrente:', error);
      toast.error('Error al crear gasto recurrente');
      return false;
    }
  };

  const toggleRecurrente = async (id: string, activo: boolean) => {
    try {
      const { error } = await supabase
        .from('gastos_recurrentes')
        .update({ activo })
        .eq('id', id);
      if (error) throw error;
      toast.success(activo ? 'Gasto recurrente activado' : 'Gasto recurrente pausado');
      await fetchRecurrentes();
    } catch (error) {
      toast.error('Error al actualizar');
    }
  };

  const deleteRecurrente = async (id: string) => {
    try {
      const { error } = await supabase
        .from('gastos_recurrentes')
        .delete()
        .eq('id', id);
      if (error) throw error;
      toast.success('Gasto recurrente eliminado');
      await fetchRecurrentes();
    } catch (error) {
      toast.error('Error al eliminar');
    }
  };

  return {
    recurrentes,
    isLoading: isLoading,
    syncGastosRecurrentes,
    addRecurrente,
    toggleRecurrente,
    deleteRecurrente,
    refetch: fetchRecurrentes,
  };
}
