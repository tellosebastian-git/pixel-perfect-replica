// Derives the two additions from the exact incumbent Auth function, with a drift guard.
const fs = require('node:fs');
const crypto = require('node:crypto');
const source = fs.readFileSync('supabase/migrations/20260904153000_platform_admin_center.sql', 'utf8').replace(/\r/g, '');
const fn = source.match(/CREATE OR REPLACE FUNCTION public\.handle_new_user\(\)[\s\S]*?\$function\$;/)[0];
const oldBody = fn.split('$function$')[1];
const hash = crypto.createHash('md5').update(oldBody).digest('hex');
const updated = fn.replace("  invited_by_id :=", `  IF COALESCE(NEW.raw_app_meta_data->>'account_kind', '') = 'partner' THEN
    INSERT INTO public.profiles(id,email,full_name)
    VALUES(NEW.id,NEW.email,COALESCE(NEW.raw_user_meta_data->>'full_name',''));
    RETURN NEW;
  END IF;

  invited_by_id :=`).replace('  RETURN NEW;\nEND;', '  PERFORM public.partner_register_referral(NEW.id);\n  RETURN NEW;\nEND;');
const sql = `-- Existing SECURITY DEFINER Auth trigger modification. Explicit production exception 2026-10-14.
-- All existing branches and tenant provisioning remain intact. No new DEFINER function.
DO $guard$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='handle_new_user' AND p.pronargs=0 AND p.prosecdef
      AND md5(p.prosrc)='${hash}') THEN
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
${updated}
`;
fs.writeFileSync('supabase/migrations/20261014130100_partner_auth.sql', sql);
console.log('Auth migration generated; incumbent body MD5 ' + hash);
