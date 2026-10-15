-- Explicitly reported correction to the existing Auth DEFINER, 2026-10-14.
DO $guard$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='handle_new_user' AND p.pronargs=0 AND p.prosecdef
      AND md5(p.prosrc)='fa773c6d1c7cc67008719ac62b3fc476') THEN RAISE EXCEPTION 'PARTNER_AUTH_DRIFT'; END IF;
END $guard$;
CREATE TABLE public.partner_identity_intents(
  nonce uuid PRIMARY KEY DEFAULT gen_random_uuid(),email text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes'
);
CREATE INDEX partner_identity_expiry ON public.partner_identity_intents(expires_at);
ALTER TABLE public.partner_identity_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.partner_identity_intents FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.partner_identity_intents TO service_role;
CREATE FUNCTION public.partner_begin_identity(_email text) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $function$
DECLARE _nonce uuid;
BEGIN
  IF current_user<>'service_role' THEN RAISE EXCEPTION 'PARTNER_SERVICE_ROLE_REQUIRED' USING ERRCODE='42501'; END IF;
  IF length(_email)>254 OR _email IS NULL OR position('@' IN _email)<2 THEN RAISE EXCEPTION 'INVALID_EMAIL'; END IF;
  DELETE FROM partner_identity_intents WHERE expires_at<now();
  INSERT INTO partner_identity_intents(email) VALUES(lower(btrim(_email))) RETURNING nonce INTO _nonce;
  RETURN _nonce;
END $function$;
CREATE FUNCTION public.partner_cancel_identity(_nonce uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $function$
BEGIN
  IF current_user<>'service_role' THEN RAISE EXCEPTION 'PARTNER_SERVICE_ROLE_REQUIRED' USING ERRCODE='42501'; END IF;
  DELETE FROM partner_identity_intents WHERE nonce=_nonce;
END $function$;
CREATE FUNCTION public.partner_claim_identity(_email text,_nonce text) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $function$
DECLARE _claimed uuid;
BEGIN
  IF _nonce IS NULL OR _nonce !~ '^[0-9a-f-]{36}$' THEN RETURN false; END IF;
  DELETE FROM partner_identity_intents WHERE nonce=_nonce::uuid AND email=lower(btrim(_email)) AND expires_at>=now()
    RETURNING nonce INTO _claimed;
  RETURN _claimed IS NOT NULL;
END $function$;
REVOKE ALL ON FUNCTION public.partner_begin_identity(text),public.partner_cancel_identity(uuid),public.partner_claim_identity(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.partner_begin_identity(text),public.partner_cancel_identity(uuid),public.partner_claim_identity(text,text) TO service_role;
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

  IF NEW.raw_user_meta_data ? 'partner_signup_nonce' THEN
    IF NOT public.partner_claim_identity(NEW.email,NEW.raw_user_meta_data->>'partner_signup_nonce') THEN
      RAISE EXCEPTION 'INVALID_PARTNER_IDENTITY_INTENT';
    END IF;
    INSERT INTO public.profiles(id,email,full_name)
      VALUES(NEW.id,NEW.email,COALESCE(NEW.raw_user_meta_data->>'full_name',''));
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
