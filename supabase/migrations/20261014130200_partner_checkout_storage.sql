CREATE FUNCTION public.partner_finalize_checkout(
  _organization_id uuid,_plan_code text,_expected_amount_ars numeric,_expected_price_version integer,
  _expected_plan_updated_at timestamptz,_existing_subscription_id uuid,_expected_subscription_updated_at timestamptz,
  _preapproval_id text,_external_reference text,_init_point text,_payer_email text,_provider_status text,
  _metadata jsonb,_preserve_current_provider boolean,_partner_quote_id uuid,_expected_catalog_amount_ars numeric
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $function$
DECLARE _q partner_checkout_quotes%ROWTYPE; _r partner_referrals%ROWTYPE; _saved jsonb; _percent integer; _new_id uuid;
BEGIN
  IF current_user<>'service_role' THEN RAISE EXCEPTION 'PARTNER_SERVICE_ROLE_REQUIRED' USING ERRCODE='42501'; END IF;
  SELECT * INTO _r FROM partner_referrals WHERE organization_id=_organization_id FOR UPDATE;
  IF NOT FOUND OR _r.intro_consumed THEN RAISE EXCEPTION 'SUBSCRIPTION_CONFLICT' USING ERRCODE='40001'; END IF;
  SELECT * INTO _q FROM partner_checkout_quotes WHERE id=_partner_quote_id AND referral_id=_r.id FOR UPDATE;
  IF NOT FOUND OR _q.status NOT IN ('quoted','bound') OR _q.organization_id<>_organization_id OR _q.plan_code<>_plan_code
    OR _q.catalog_amount_cents IS DISTINCT FROM round(_expected_catalog_amount_ars*100)::bigint
    OR _q.amount_cents IS DISTINCT FROM round(_expected_amount_ars*100)::bigint
    OR _q.amount_cents IS DISTINCT FROM _q.catalog_amount_cents-round(_q.catalog_amount_cents::numeric*10/100)::bigint
    OR _q.price_version IS DISTINCT FROM _expected_price_version OR _q.plan_updated_at IS DISTINCT FROM _expected_plan_updated_at
    OR _preserve_current_provider OR EXISTS(SELECT 1 FROM subscription_payments WHERE organization_id=_organization_id AND status='approved')
    OR left(_external_reference,length('sub_'||_organization_id||'_'||_plan_code||'_')) IS DISTINCT FROM 'sub_'||_organization_id||'_'||_plan_code||'_'
    OR _provider_status<>'pending' THEN RAISE EXCEPTION 'CATALOG_CONFLICT' USING ERRCODE='40001'; END IF;
  _percent:=coalesce(_r.percent_snapshot,_q.percent);
  IF _q.status='bound' AND _q.preapproval_id IS DISTINCT FROM _preapproval_id THEN
    -- Keep every provider binding immutable for stale-payment ownership checks.
    UPDATE partner_checkout_quotes SET status='invalidated' WHERE id=_q.id;
    INSERT INTO partner_checkout_quotes(referral_id,organization_id,sucursal_id,plan_code,catalog_amount_cents,amount_cents,
      price_version,plan_updated_at,percent,terms_version)
      VALUES(_q.referral_id,_q.organization_id,_q.sucursal_id,_q.plan_code,_q.catalog_amount_cents,_q.amount_cents,
        _q.price_version,_q.plan_updated_at,_percent,_q.terms_version) RETURNING * INTO _q;
  END IF;
  _saved:=subscription_finalize_checkout(_organization_id,_plan_code,_expected_catalog_amount_ars,_expected_price_version,
    _expected_plan_updated_at,_existing_subscription_id,_expected_subscription_updated_at,_preapproval_id,_external_reference,
    _init_point,_payer_email,_provider_status,_metadata||jsonb_build_object('pending_partner_quote_id',_q.id),false);
  UPDATE organization_subscriptions SET pending_checkout_amount_ars=_expected_amount_ars WHERE id=(_saved->>'id')::uuid RETURNING to_jsonb(organization_subscriptions.*) INTO _saved;
  UPDATE partner_checkout_quotes SET status='bound',preapproval_id=_preapproval_id,external_reference=_external_reference,percent=_percent WHERE id=_q.id;
  UPDATE partner_referrals SET percent_snapshot=_percent,snapshot_terms=_q.terms_version,revision=revision+1 WHERE id=_r.id;
  RETURN _saved;
END $function$;
REVOKE ALL ON FUNCTION public.partner_finalize_checkout(uuid,text,numeric,integer,timestamptz,uuid,timestamptz,text,text,text,text,text,jsonb,boolean,uuid,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.partner_finalize_checkout(uuid,text,numeric,integer,timestamptz,uuid,timestamptz,text,text,text,text,text,jsonb,boolean,uuid,numeric) TO service_role;
DO $acl$
DECLARE _r record;
BEGIN
  FOR _r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND left(p.proname,8)='partner_' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',_r.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',_r.signature);
  END LOOP;
END $acl$;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  VALUES('partner-payout-receipts','partner-payout-receipts',false,10485760,ARRAY['application/pdf','image/png','image/jpeg'])
  ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=10485760,allowed_mime_types=excluded.allowed_mime_types;
CREATE POLICY partner_receipts_admin_read ON storage.objects FOR SELECT TO authenticated
  USING(bucket_id='partner-payout-receipts' AND auth.jwt()->'app_metadata'->>'platform_role'='platform_admin');
CREATE POLICY partner_receipts_admin_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK(bucket_id='partner-payout-receipts' AND auth.jwt()->'app_metadata'->>'platform_role'='platform_admin'
    AND owner_id=auth.uid()::text AND name ~ '^partner-payouts/[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|jpg|png)$');
-- Restrictive guards neutralize pre-existing permissive policies on other buckets.
CREATE POLICY partner_receipts_scope_guard ON storage.objects AS RESTRICTIVE FOR ALL TO anon,authenticated
  USING(bucket_id<>'partner-payout-receipts' OR auth.jwt()->'app_metadata'->>'platform_role'='platform_admin')
  WITH CHECK(bucket_id<>'partner-payout-receipts' OR (auth.jwt()->'app_metadata'->>'platform_role'='platform_admin' AND owner_id=auth.uid()::text));
CREATE POLICY partner_receipts_immutable_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO anon,authenticated
  USING(bucket_id<>'partner-payout-receipts') WITH CHECK(bucket_id<>'partner-payout-receipts');
CREATE POLICY partner_receipts_immutable_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO anon,authenticated
  USING(bucket_id<>'partner-payout-receipts');
