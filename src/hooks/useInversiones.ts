import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useSucursal } from '@/contexts/SucursalContext';
import { toast } from 'sonner';

export interface Inversion {
  id: string;
  organization_id: string;
  nombre: string;
  monto_total: number;
  fecha_compra: string;
  meses_amortizacion: number;
  categoria: string | null;
  descripcion: string | null;
  activa: boolean;
  created_at: string;
}

export function useInversiones() {
  const { organization } = useOrganization();
  const { currentSucursal } = useSucursal();
  const [inversiones, setInversiones] = useState<Inversion[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchInversiones = useCallback(async () => {
    if (!organization?.id) return;
    setIsLoading(true);
    try {
      let query = supabase
        .from('inversiones')
        .select('*')
        .eq('organization_id', organization.id)
        .order('fecha_compra', { ascending: false });

      if (currentSucursal) {
        query = query.eq('sucursal_id', currentSucursal.id);
      }

      const { data, error } = await query;

      if (error) throw error;
      setInversiones((data as Inversion[]) || []);
    } catch (error: any) {
      console.error('Error fetching inversiones:', error);
      toast.error('Error al cargar inversiones');
    } finally {
      setIsLoading(false);
    }
  }, [organization?.id, currentSucursal]);

  useEffect(() => {
    fetchInversiones();
  }, [fetchInversiones]);

  const addInversion = async (data: {
    nombre: string;
    monto_total: number;
    fecha_compra: Date;
    meses_amortizacion: number;
    categoria?: string;
    descripcion?: string;
  }) => {
    if (!organization?.id) {
      toast.error('No se encontró la organización');
      return null;
    }

    try {
      const { data: inserted, error } = await supabase
        .from('inversiones')
        .insert({
          organization_id: organization.id,
          sucursal_id: currentSucursal?.id || null,
          nombre: data.nombre,
          monto_total: data.monto_total,
          fecha_compra: data.fecha_compra.toISOString().split('T')[0],
          meses_amortizacion: data.meses_amortizacion,
          categoria: data.categoria || null,
          descripcion: data.descripcion || null,
        })
        .select()
        .single();

      if (error) throw error;
      toast.success('Inversión registrada');
      await fetchInversiones();
      return inserted as Inversion;
    } catch (error: any) {
      console.error('Error adding inversion:', error);
      toast.error('Error al registrar inversión');
      return null;
    }
  };

  const deleteInversion = async (id: string) => {
    try {
      const { error } = await supabase.from('inversiones').delete().eq('id', id);
      if (error) throw error;
      toast.success('Inversión eliminada');
      await fetchInversiones();
    } catch (error: any) {
      console.error('Error deleting inversion:', error);
      toast.error('Error al eliminar inversión');
    }
  };

  const getAmortizacionMensual = (inv: Inversion) => {
    if (inv.meses_amortizacion <= 0) return 0;
    return inv.monto_total / inv.meses_amortizacion;
  };

  const getMesesTranscurridos = (inv: Inversion) => {
    const compra = new Date(inv.fecha_compra);
    const ahora = new Date();
    const diff = (ahora.getFullYear() - compra.getFullYear()) * 12 + (ahora.getMonth() - compra.getMonth());
    return Math.max(0, Math.min(diff, inv.meses_amortizacion));
  };

  return {
    inversiones,
    isLoading,
    addInversion,
    deleteInversion,
    getAmortizacionMensual,
    getMesesTranscurridos,
    refetch: fetchInversiones,
  };
}
