-- Existing SECURITY DEFINER Auth trigger modification. Explicit production exception 2026-10-14.
-- All existing branches and tenant provisioning remain intact. No new DEFINER function.
DO $guard$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='handle_new_user' AND p.pronargs=0 AND p.prosecdef
      AND md5(p.prosrc)='db13ead169c47bb2052cda933af11fef') THEN
    RAISE EXCEPTION 'PARTNER_AUTH_DRIFT: inspect the incumbent trigger before applying';
  END IF;
END $guard$;
CREATE FUNCTION public.partner_register_referral(_user_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $function$
DECLARE _u auth.users%ROWTYPE; _p public.partners%ROWTYPE; _profile public.profiles%ROWTYPE; _code text;
BEGIN
  SELECT * INTO _u FROM auth.users WHERE id=_user_id;
  _code:=upper(btrim(coalesce(_u.raw_user_meta_data->>'referral_code','')));
  IF _code='' THEN RETURN; END IF;
  IF coalesce(_u.raw_user_meta_data->>'country','AR')<>'AR' OR _code !~ '^[A-Z0-9]{4,20}$'
    OR NOT EXISTS(SELECT 1 FROM partner_program_config WHERE enrollment_enabled AND billing_ready) THEN RAISE EXCEPTION 'INVALID_REFERRAL'; END IF;
  SELECT p.* INTO _p FROM partners p JOIN auth.users a ON a.id=p.user_id WHERE p.code=_code
    AND NOT p.suspended AND a.email_confirmed_at IS NOT NULL AND coalesce(a.banned_until<=now(),true) FOR SHARE OF p;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_REFERRAL'; END IF;
  IF _p.user_id=_u.id OR EXISTS(SELECT 1 FROM auth.users a WHERE a.id=_p.user_id AND lower(a.email)=lower(_u.email)) THEN RAISE EXCEPTION 'SELF_REFERRAL'; END IF;
  SELECT * INTO _profile FROM profiles WHERE id=_u.id;
  IF _profile.organization_id IS NULL OR _profile.default_sucursal_id IS NULL THEN RAISE EXCEPTION 'INVALID_REFERRAL'; END IF;
  INSERT INTO partner_referrals(partner_id,organization_id,sucursal_id,registered_by,code,terms_version)
    VALUES(_p.id,_profile.organization_id,_profile.default_sucursal_id,_u.id,_code,'2026-10-14-v1');
END $function$;
REVOKE ALL ON FUNCTION public.partner_register_referral(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.partner_register_referral(uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_org_id uuid;
  new_sucursal_id uuid;
  org_name text;
  org_slug text;
  user_country text;
  user_timezone text;
  invited_by_id uuid;
  is_sucursal_acc boolean;
  owner_full_name text;
  owner_nombre text;
  owner_apellido text;
  new_barbero_id uuid;
BEGIN
  IF COALESCE(NEW.raw_app_meta_data->>'platform_role', '') = 'platform_admin' THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.raw_app_meta_data->>'account_kind', '') = 'partner' THEN
    INSERT INTO public.profiles(id,email,full_name)
    VALUES(NEW.id,NEW.email,COALESCE(NEW.raw_user_meta_data->>'full_name',''));
    RETURN NEW;
  END IF;

  invited_by_id := (NEW.raw_user_meta_data->>'invited_by')::uuid;
  is_sucursal_acc := COALESCE((NEW.raw_user_meta_data->>'sucursal_account')::boolean, false);

  IF is_sucursal_acc THEN
    RETURN NEW;
  END IF;

  IF invited_by_id IS NOT NULL THEN
    INSERT INTO public.profiles (id, email, full_name)
    VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''));
    RETURN NEW;
  END IF;

  org_name := COALESCE(NEW.raw_user_meta_data->>'business_name', 'Mi Barberia');
  org_slug := LOWER(REPLACE(org_name, ' ', '-')) || '-' || SUBSTRING(gen_random_uuid()::text, 1, 8);
  user_country := COALESCE(NEW.raw_user_meta_data->>'country', 'AR');

  user_timezone := CASE user_country
    WHEN 'AR' THEN 'America/Argentina/Buenos_Aires'
    WHEN 'MX' THEN 'America/Mexico_City'
    WHEN 'CO' THEN 'America/Bogota'
    WHEN 'CL' THEN 'America/Santiago'
    WHEN 'PE' THEN 'America/Lima'
    WHEN 'EC' THEN 'America/Guayaquil'
    WHEN 'UY' THEN 'America/Montevideo'
    WHEN 'PY' THEN 'America/Asuncion'
    WHEN 'BO' THEN 'America/La_Paz'
    WHEN 'VE' THEN 'America/Caracas'
    WHEN 'ES' THEN 'Europe/Madrid'
    WHEN 'BR' THEN 'America/Sao_Paulo'
    WHEN 'CR' THEN 'America/Costa_Rica'
    WHEN 'PA' THEN 'America/Panama'
    WHEN 'DO' THEN 'America/Santo_Domingo'
    WHEN 'GT' THEN 'America/Guatemala'
    WHEN 'HN' THEN 'America/Tegucigalpa'
    WHEN 'SV' THEN 'America/El_Salvador'
    WHEN 'NI' THEN 'America/Managua'
    WHEN 'PR' THEN 'America/Puerto_Rico'
    WHEN 'CU' THEN 'America/Havana'
    ELSE 'America/Argentina/Buenos_Aires'
  END;

  INSERT INTO public.organizations (name, slug, plan, timezone, plan_expires_at, last_payment_at)
  VALUES (org_name, org_slug, 'premium', user_timezone, now() + interval '15 days', NULL)
  RETURNING id INTO new_org_id;

  INSERT INTO public.sucursales (organization_id, nombre, timezone)
  VALUES (new_org_id, 'Casa Central', user_timezone)
  RETURNING id INTO new_sucursal_id;

  owner_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');
  IF btrim(owner_full_name) = '' THEN
    owner_nombre := COALESCE(NEW.email, 'Dueno');
    owner_apellido := '';
  ELSIF position(' ' IN btrim(owner_full_name)) = 0 THEN
    owner_nombre := btrim(owner_full_name);
    owner_apellido := '';
  ELSE
    owner_nombre := split_part(btrim(owner_full_name), ' ', 1);
    owner_apellido := btrim(substring(btrim(owner_full_name) FROM position(' ' IN btrim(owner_full_name)) + 1));
  END IF;

  INSERT INTO public.barberos (
    organization_id, nombre, apellido, sucursal_id, comision,
    tipo_compensacion, rol_equipo, roles_equipo, fecha_cobro_dia, activo
  ) VALUES (
    new_org_id, owner_nombre, owner_apellido, NULL, 0,
    'comision', 'owner', ARRAY['owner']::text[], 1, true
  )
  RETURNING id INTO new_barbero_id;

  INSERT INTO public.profiles (id, email, full_name, organization_id, default_sucursal_id, barbero_id)
  VALUES (NEW.id, NEW.email, owner_full_name, new_org_id, new_sucursal_id, new_barbero_id);

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'owner');

  INSERT INTO public.user_sucursales (user_id, sucursal_id, organization_id)
  VALUES (NEW.id, new_sucursal_id, new_org_id);

  PERFORM public.partner_register_referral(NEW.id);
  RETURN NEW;
END;
$function$;
