-- Only the two orphan tenants created by the failing disposable Auth probe.
-- Authoritative fixture identities were removed; these are not customer organizations.
BEGIN;
DO $cleanup$
DECLARE _id uuid; _table text; _count bigint; _actor uuid; _barber uuid;
BEGIN
  FOREACH _id IN ARRAY ARRAY['18139252-cb7d-45a9-8068-e0a791f6c34b'::uuid,'01d842c5-5f2d-4996-a4e4-8e50954100d0'::uuid] LOOP
    IF NOT EXISTS(SELECT 1 FROM organizations WHERE id=_id AND name='Mi Barberia'
      AND created_at BETWEEN '2026-10-14T13:55:00Z' AND '2026-10-14T13:57:00Z')
      OR (SELECT count(*) FROM barberos WHERE organization_id=_id AND nombre='QA' AND apellido='Ephemeral Partner')<>1
      OR EXISTS(SELECT 1 FROM profiles WHERE organization_id=_id)
      OR EXISTS(SELECT 1 FROM user_sucursales WHERE organization_id=_id)
      OR EXISTS(SELECT 1 FROM subscription_payments WHERE organization_id=_id)
      OR EXISTS(SELECT 1 FROM partner_referrals WHERE organization_id=_id) THEN RAISE EXCEPTION 'fixture_scope_changed'; END IF;
    FOR _table IN SELECT table_name FROM information_schema.columns WHERE table_schema='public'
      AND column_name='organization_id' AND table_name IN ('venta','ventas','ingresos','turnos','clientes','gastos','tareas','deudas') LOOP
      EXECUTE format('SELECT count(*) FROM public.%I WHERE organization_id=$1',_table) INTO _count USING _id;
      IF _count<>0 THEN RAISE EXCEPTION 'fixture_has_activity'; END IF;
    END LOOP;
    -- Use the existing owner guard with a transaction-only fixture identity;
    -- do not disable the guard or alter protections for any organization.
    _actor:=gen_random_uuid();
    SELECT id INTO _barber FROM barberos WHERE organization_id=_id AND nombre='QA' AND apellido='Ephemeral Partner';
    INSERT INTO auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      VALUES(_actor,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',_actor||'@synthetic.invalid',now(),
        '{"account_kind":"partner"}','{"full_name":"QA Cleanup Actor"}',now(),now());
    UPDATE profiles SET organization_id=_id,barbero_id=_barber WHERE id=_actor;
    INSERT INTO user_roles(user_id,role) VALUES(_actor,'owner');
    PERFORM set_config('request.jwt.claim.sub',_actor::text,true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_actor,'role','authenticated')::text,true);
    DELETE FROM barberos WHERE id=_barber AND organization_id=_id;
    DELETE FROM organizations WHERE id=_id;
    DELETE FROM auth.users WHERE id=_actor;
  END LOOP;
END $cleanup$;
COMMIT;
SELECT count(*) AS remaining_fixture_organizations FROM organizations
  WHERE id IN ('18139252-cb7d-45a9-8068-e0a791f6c34b','01d842c5-5f2d-4996-a4e4-8e50954100d0');
