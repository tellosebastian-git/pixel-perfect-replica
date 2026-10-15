-- Explicitly authorized production validation; fixtures and flags roll back.
-- No Auth email call, provider request, transfer or persistent financial record.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
UPDATE public.partner_program_config SET enrollment_enabled=true,billing_ready=true;
DO $test$
DECLARE _external uuid:=gen_random_uuid(); _other uuid:=gen_random_uuid(); _owner uuid:=gen_random_uuid();
  _tenant uuid; _branch uuid; _result jsonb; _plan subscription_plans%ROWTYPE; _nonce uuid;
  _code text:='QA'||upper(left(replace(_external::text,'-',''),16)); _before bigint;
BEGIN
  SELECT count(*) INTO _before FROM organizations;
  PERFORM set_config('role','service_role',true);
  _nonce:=partner_begin_identity(_external||'@synthetic.invalid');
  PERFORM set_config('role','postgres',true);
  INSERT INTO auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    VALUES(_external,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',_external||'@synthetic.invalid',now(),
      '{"provider":"email"}',jsonb_build_object('full_name','QA Rollback Partner','country','AR','partner_signup_nonce',_nonce),now(),now()),
      (_other,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',_other||'@synthetic.invalid',now(),
      '{"account_kind":"partner"}','{"full_name":"QA Rollback Other","country":"AR"}',now(),now());
  UPDATE auth.users SET raw_app_meta_data=raw_app_meta_data||'{"account_kind":"partner"}' WHERE id=_external;
  IF (SELECT count(*) FROM organizations)<>_before
    OR EXISTS(SELECT 1 FROM profiles WHERE id IN (_external,_other) AND (organization_id IS NOT NULL OR default_sucursal_id IS NOT NULL))
    OR EXISTS(SELECT 1 FROM user_roles WHERE user_id IN (_external,_other)) THEN RAISE EXCEPTION 'external_created_tenant'; END IF;
  PERFORM set_config('role','service_role',true);
  _result:=partner_program_command(1,'enroll',_external,jsonb_build_object('code',_code,'country','AR','termsVersion','2026-10-14-v2'));
  IF _result->>'code' IS DISTINCT FROM _code THEN RAISE EXCEPTION 'wrong_code'; END IF;
  _result:=partner_program_command(1,'validate_code',NULL,jsonb_build_object('code',lower(_code)));
  IF _result->>'valid' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'case_insensitive_code_failed'; END IF;
  PERFORM set_config('role','postgres',true);
  INSERT INTO auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    VALUES(_owner,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',_owner||'@synthetic.invalid',now(),'{}',
      jsonb_build_object('full_name','QA Rollback Owner','business_name','QA Rollback Barber','country','AR','referral_code',lower(_code)),now(),now());
  SELECT organization_id,default_sucursal_id INTO _tenant,_branch FROM profiles WHERE id=_owner;
  IF _tenant IS NULL OR _branch IS NULL OR NOT EXISTS(SELECT 1 FROM partner_referrals WHERE organization_id=_tenant AND sucursal_id=_branch)
    OR NOT EXISTS(SELECT 1 FROM organization_subscriptions WHERE organization_id=_tenant AND trial_ends_at IS NOT NULL)
    THEN RAISE EXCEPTION 'signup_scope_or_trial_failed'; END IF;
  PERFORM set_config('role','service_role',true);
  _result:=partner_program_command(1,'summary',_external,'{}');
  IF _result->'summary'->>'registrations' IS DISTINCT FROM '1' OR _result::text LIKE '%'||_tenant::text||'%'
    THEN RAISE EXCEPTION 'summary_scope_failed'; END IF;
  _result:=partner_program_command(1,'summary',_other,'{}');
  IF _result->'summary' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'other_identity_leak'; END IF;
  SELECT * INTO _plan FROM subscription_plans WHERE code='basico';
  _result:=partner_program_command(1,'prepare_checkout',_owner,jsonb_build_object('organizationId',_tenant,'planCode',_plan.code,
    'catalogAmountArs',_plan.amount_ars,'priceVersion',_plan.price_version,'planUpdatedAt',_plan.updated_at));
  IF round((_result->'quote'->>'amountArs')::numeric*100)::bigint<>round(_plan.amount_ars*100)::bigint-round(_plan.amount_ars*10)::bigint
    OR EXISTS(SELECT 1 FROM partner_commissions WHERE organization_id=_tenant) THEN RAISE EXCEPTION 'intro_quote_failed'; END IF;
  IF has_function_privilege('authenticated','public.partner_program_command(integer,text,uuid,jsonb)','EXECUTE')
    OR has_table_privilege('authenticated','public.partner_payout_accounts','SELECT')
    OR has_table_privilege('anon','public.partner_instagram_credentials','SELECT') THEN RAISE EXCEPTION 'client_privilege_leak'; END IF;
  PERFORM set_config('role','postgres',true);
END $test$;
ROLLBACK;
SELECT jsonb_build_object('rollback_complete',true,'fixture_users',(
  SELECT count(*) FROM auth.users WHERE raw_user_meta_data->>'full_name' IN ('QA Rollback Partner','QA Rollback Other','QA Rollback Owner')),
  'enrollment_enabled',(SELECT enrollment_enabled FROM partner_program_config),
  'billing_ready',(SELECT billing_ready FROM partner_program_config)) AS evidence;
