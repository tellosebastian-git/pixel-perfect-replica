// GoTrue adminUserCreate applies app_metadata AFTER INSERT. Use a private one-use intent.
const fs=require('node:fs');
const incumbent=fs.readFileSync('supabase/migrations/20261014130100_partner_auth.sql','utf8');
const original=incumbent.match(/CREATE OR REPLACE FUNCTION public\.handle_new_user\([\s\S]*?\$function\$;/)[0];
const insertion=`  IF NEW.raw_user_meta_data ? 'partner_signup_nonce' THEN
    IF NOT public.partner_claim_identity(NEW.email,NEW.raw_user_meta_data->>'partner_signup_nonce') THEN
      RAISE EXCEPTION 'INVALID_PARTNER_IDENTITY_INTENT';
    END IF;
    INSERT INTO public.profiles(id,email,full_name)
      VALUES(NEW.id,NEW.email,COALESCE(NEW.raw_user_meta_data->>'full_name',''));
    RETURN NEW;
  END IF;

`;
const needle="  IF COALESCE(NEW.raw_app_meta_data->>'account_kind', '') = 'partner' THEN";
if(!original.includes(needle)) throw new Error('Auth source drift');
const fixed=original.replace(needle,insertion+needle);
const sql=`-- Explicitly reported correction to the existing Auth DEFINER, 2026-10-14.
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
${fixed}
`;
fs.writeFileSync('supabase/migrations/20261014130400_partner_identity_intent.sql',sql);
fs.writeFileSync('.impeccable/partner-identity.sql.local',`BEGIN; SET LOCAL lock_timeout='10s';\n${sql}\n
INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
  VALUES('20261014130400','partner_identity_intent',ARRAY[$identity_source$${sql}$identity_source$]);
COMMIT; SELECT version,name FROM supabase_migrations.schema_migrations WHERE version='20261014130400';`);
console.log('Prepared private one-use identity provisioning');
