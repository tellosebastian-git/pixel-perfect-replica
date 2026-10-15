// Existing client fields, explicitly excluding the server-only PIN digest. RLS still scopes rows.
export const BARBER_CLIENT_COLUMNS = 'id,organization_id,sucursal_id,nombre,apellido,activo,telefono,dni,comision,created_at,updated_at,access_email,fecha_baja,fecha_cobro_dia,motivo_baja,rol_equipo,roles_equipo,sueldo_fijo,tipo_compensacion' as const;
