-- Authorized production exception, 2026-10-14: Programa de aliados.
-- Additive platform tables; operational attribution rows are tenant/branch scoped.
-- All new functions are SECURITY INVOKER, executable only by service_role.
CREATE TABLE public.partner_program_config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  contract_version integer NOT NULL DEFAULT 1 CHECK (contract_version=1),
  enrollment_enabled boolean NOT NULL DEFAULT false,
  billing_ready boolean NOT NULL DEFAULT false,
  terms_version text NOT NULL DEFAULT '2026-10-14-v1'
);
INSERT INTO public.partner_program_config(singleton) VALUES(true);
CREATE TABLE public.partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL CHECK(length(name) BETWEEN 2 AND 80),
  code text NOT NULL UNIQUE CHECK(code ~ '^[A-Z0-9]{4,20}$' AND code NOT IN ('VITTRO','ADMIN','SUPPORT','SOPORTE')),
  country text NOT NULL DEFAULT 'AR' CHECK(country='AR'),
  terms_version text NOT NULL, accepted_at timestamptz NOT NULL DEFAULT now(),
  suspended boolean NOT NULL DEFAULT false, revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.partner_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), partner_id uuid NOT NULL REFERENCES public.partners(id),
  percent integer NOT NULL CHECK(percent BETWEEN 1 AND 100), starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL, suspended boolean NOT NULL DEFAULT false,
  reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 500),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(ends_at>starts_at)
);
CREATE INDEX partner_agreements_active ON public.partner_agreements(partner_id, starts_at, ends_at);
CREATE TABLE public.partner_instagram_accounts (
  partner_id uuid PRIMARY KEY REFERENCES public.partners(id), account_id text UNIQUE NOT NULL,
  username text NOT NULL, followers bigint NOT NULL CHECK(followers>=0 AND followers<=9007199254740991),
  verified_at timestamptz NOT NULL, connected boolean NOT NULL DEFAULT true, revision bigint NOT NULL DEFAULT 1
);
CREATE TABLE public.partner_instagram_credentials (
  partner_id uuid PRIMARY KEY REFERENCES public.partner_instagram_accounts(partner_id),
  ciphertext text NOT NULL CHECK(ciphertext LIKE 'v1.%'), expires_at timestamptz NOT NULL
);
CREATE TABLE public.partner_oauth_states (
  hash text PRIMARY KEY, partner_id uuid NOT NULL REFERENCES public.partners(id),
  actor_id uuid NOT NULL REFERENCES auth.users(id), expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
  consumed_at timestamptz
);
CREATE TABLE public.partner_payout_accounts (
  partner_id uuid PRIMARY KEY REFERENCES public.partners(id), holder text NOT NULL CHECK(length(holder) BETWEEN 3 AND 80),
  tax_id text NOT NULL CHECK(tax_id ~ '^\d{11}$'), account text NOT NULL CHECK(account ~ '^\d{22}$'),
  verified boolean NOT NULL DEFAULT false, revision bigint NOT NULL DEFAULT 1,
  verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL, verified_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX partner_payout_account_lookup ON public.partner_payout_accounts(account);
CREATE INDEX partner_payout_tax_lookup ON public.partner_payout_accounts(tax_id);
CREATE UNIQUE INDEX IF NOT EXISTS sucursales_partner_scope_key ON public.sucursales(id,organization_id);
CREATE TABLE public.partner_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), partner_id uuid NOT NULL REFERENCES public.partners(id),
  organization_id uuid NOT NULL UNIQUE REFERENCES public.organizations(id), sucursal_id uuid NOT NULL,
  registered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL, code text NOT NULL, terms_version text NOT NULL,
  percent_snapshot integer CHECK(percent_snapshot BETWEEN 1 AND 100), snapshot_terms text,
  first_payment_id uuid UNIQUE REFERENCES public.subscription_payments(id),
  intro_consumed boolean NOT NULL DEFAULT false, renewal_pending boolean NOT NULL DEFAULT false,
  qualified boolean NOT NULL DEFAULT false, revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,organization_id,sucursal_id),
  FOREIGN KEY(sucursal_id,organization_id) REFERENCES public.sucursales(id,organization_id)
);
CREATE INDEX partner_referrals_partner ON public.partner_referrals(partner_id,qualified);
CREATE TABLE public.partner_checkout_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), referral_id uuid NOT NULL,
  organization_id uuid NOT NULL, sucursal_id uuid NOT NULL,
  plan_code text NOT NULL REFERENCES public.subscription_plans(code), catalog_amount_cents bigint NOT NULL CHECK(catalog_amount_cents>0),
  amount_cents bigint NOT NULL CHECK(amount_cents>0), price_version integer NOT NULL,
  plan_updated_at timestamptz NOT NULL, percent integer NOT NULL CHECK(percent BETWEEN 1 AND 100), terms_version text NOT NULL,
  status text NOT NULL DEFAULT 'quoted' CHECK(status IN ('quoted','bound','invalidated','consumed')),
  preapproval_id text UNIQUE, external_reference text UNIQUE, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(referral_id,organization_id,sucursal_id) REFERENCES public.partner_referrals(id,organization_id,sucursal_id)
);
CREATE INDEX partner_quote_referral ON public.partner_checkout_quotes(referral_id,created_at DESC);
CREATE TABLE public.partner_payment_receipts (
  payment_id uuid PRIMARY KEY REFERENCES public.subscription_payments(id), referral_id uuid NOT NULL,
  organization_id uuid NOT NULL, sucursal_id uuid NOT NULL,
  amount_cents bigint NOT NULL CHECK(amount_cents>0), refunded_cents bigint NOT NULL DEFAULT 0,
  status text NOT NULL, cycle_key text NOT NULL, paid_at timestamptz NOT NULL, external_reference text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(refunded_cents BETWEEN 0 AND amount_cents),
  FOREIGN KEY(referral_id,organization_id,sucursal_id) REFERENCES public.partner_referrals(id,organization_id,sucursal_id)
);
CREATE INDEX partner_receipts_referral ON public.partner_payment_receipts(referral_id,paid_at);
CREATE TABLE public.partner_commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), referral_id uuid NOT NULL UNIQUE,
  organization_id uuid NOT NULL, sucursal_id uuid NOT NULL, partner_id uuid NOT NULL REFERENCES public.partners(id),
  first_payment_id uuid NOT NULL UNIQUE REFERENCES public.subscription_payments(id),
  percent integer NOT NULL CHECK(percent BETWEEN 1 AND 100), amount_cents bigint NOT NULL CHECK(amount_cents>=0),
  paid_cents bigint NOT NULL DEFAULT 0 CHECK(paid_cents>=0), adjustments_cents bigint NOT NULL DEFAULT 0 CHECK(adjustments_cents<=0),
  status text NOT NULL CHECK(status IN ('pending','available','held','paid','reversed')),
  available_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), revision bigint NOT NULL DEFAULT 1,
  FOREIGN KEY(referral_id,organization_id,sucursal_id) REFERENCES public.partner_referrals(id,organization_id,sucursal_id)
);
CREATE INDEX partner_commission_balance ON public.partner_commissions(partner_id,status,available_at);
CREATE TABLE public.partner_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), commission_id uuid NOT NULL REFERENCES public.partner_commissions(id),
  organization_id uuid NOT NULL, sucursal_id uuid NOT NULL, referral_id uuid NOT NULL,
  delta_cents bigint NOT NULL CHECK(delta_cents<>0), source_revision text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(commission_id,source_revision),
  FOREIGN KEY(referral_id,organization_id,sucursal_id) REFERENCES public.partner_referrals(id,organization_id,sucursal_id)
);
CREATE TABLE public.partner_payout_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cutoff timestamptz NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.partner_payout_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), batch_id uuid NOT NULL REFERENCES public.partner_payout_batches(id),
  partner_id uuid NOT NULL REFERENCES public.partners(id), amount_cents bigint NOT NULL CHECK(amount_cents>0),
  holder text NOT NULL, tax_id text NOT NULL, account text NOT NULL, account_revision bigint NOT NULL,
  status text NOT NULL DEFAULT 'review' CHECK(status IN ('review','paid','held','cancelled')),
  reference text, receipt_path text, paid_by uuid REFERENCES auth.users(id) ON DELETE SET NULL, paid_at timestamptz,
  revision bigint NOT NULL DEFAULT 1, UNIQUE(batch_id,partner_id),
  CHECK(status<>'paid' OR (reference IS NOT NULL AND receipt_path IS NOT NULL AND paid_by IS NOT NULL AND paid_at IS NOT NULL))
);
CREATE UNIQUE INDEX partner_one_open_payout ON public.partner_payout_items(partner_id) WHERE status IN ('review','held');
CREATE TABLE public.partner_payout_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid NOT NULL REFERENCES public.partner_payout_items(id),
  commission_id uuid REFERENCES public.partner_commissions(id), adjustment_id uuid REFERENCES public.partner_adjustments(id),
  amount_cents bigint NOT NULL, CHECK((commission_id IS NULL)<>(adjustment_id IS NULL)),
  UNIQUE(commission_id), UNIQUE(adjustment_id)
);
CREATE TABLE public.partner_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), partner_id uuid NOT NULL REFERENCES public.partners(id),
  kind text NOT NULL, message text NOT NULL, dedupe_key text UNIQUE NOT NULL,
  resolved boolean NOT NULL DEFAULT false, revision bigint NOT NULL DEFAULT 1,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL, reason text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX partner_incidents_open ON public.partner_incidents(partner_id) WHERE NOT resolved;
CREATE TABLE public.partner_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL CHECK(kind IN ('payment','ledger','renewal','instagram')),
  input jsonb NOT NULL CHECK(jsonb_typeof(input)='object'), dedupe_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed')),
  due_at timestamptz NOT NULL DEFAULT now(), lease uuid, lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0, error_code text, completed_at timestamptz
);
CREATE INDEX partner_jobs_due ON public.partner_jobs(status,due_at);
CREATE TABLE public.partner_public_limits (
  key text NOT NULL, window_start timestamptz NOT NULL, attempts integer NOT NULL,
  PRIMARY KEY(key,window_start)
);
CREATE TABLE public.partner_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL,
  request_id uuid NOT NULL, action text NOT NULL, fingerprint text NOT NULL,
  reason text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(actor_id,request_id)
);
DO $block$
DECLARE _table text;
BEGIN
  FOREACH _table IN ARRAY ARRAY['partner_program_config','partners','partner_agreements','partner_instagram_accounts',
    'partner_instagram_credentials','partner_oauth_states','partner_payout_accounts','partner_referrals','partner_checkout_quotes',
    'partner_payment_receipts','partner_commissions','partner_adjustments','partner_payout_batches','partner_payout_items',
    'partner_payout_entries','partner_incidents','partner_jobs','partner_public_limits','partner_operations'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated',_table);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.%I TO service_role',_table);
  END LOOP;
END $block$;
GRANT USAGE ON SCHEMA auth TO service_role;
GRANT SELECT ON auth.users TO service_role;

CREATE FUNCTION public.partner_tier_input(_partner_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $function$
  SELECT jsonb_build_object('qualifiedOrganizations',(SELECT count(*) FROM partner_referrals WHERE partner_id=_partner_id AND qualified),
    'instagram',(SELECT jsonb_build_object('accountId',account_id,'followers',followers,'verifiedAt',verified_at,'connected',connected)
      FROM partner_instagram_accounts WHERE partner_id=_partner_id),
    'agreement',(SELECT jsonb_build_object('percent',percent,'startsAt',starts_at,'endsAt',ends_at,'suspended',suspended)
      FROM partner_agreements WHERE partner_id=_partner_id AND NOT suspended AND starts_at<=now() AND ends_at>now()
      ORDER BY starts_at DESC LIMIT 1));
$function$;
CREATE FUNCTION public.partner_rate(_partner_id uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $function$
  SELECT coalesce((SELECT percent FROM partner_agreements WHERE partner_id=_partner_id AND NOT suspended
    AND starts_at<=now() AND ends_at>now() ORDER BY starts_at DESC LIMIT 1),greatest(
      CASE WHEN (SELECT count(*) FROM partner_referrals WHERE partner_id=_partner_id AND qualified)>=20 THEN 30
           WHEN (SELECT count(*) FROM partner_referrals WHERE partner_id=_partner_id AND qualified)>=5 THEN 20 ELSE 10 END,
      coalesce((SELECT CASE WHEN followers>=50000 THEN 30 WHEN followers>=10000 THEN 20 ELSE 10 END
        FROM partner_instagram_accounts WHERE partner_id=_partner_id AND connected AND verified_at<=now()
        AND verified_at>now()-interval '30 days'),10)));
$function$;
CREATE FUNCTION public.partner_reference(_input jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $function$
DECLARE _id uuid;
BEGIN
  IF _input ? 'attributionId' THEN RETURN (_input->>'attributionId')::uuid; END IF;
  IF _input ? 'paymentId' THEN
    SELECT referral_id INTO _id FROM partner_payment_receipts WHERE payment_id=(_input->>'paymentId')::uuid;
  ELSIF _input ? 'eventId' THEN
    SELECT r.id INTO _id FROM mercadopago_subscription_events e
      JOIN subscription_payments p ON p.id=e.payment_id AND p.organization_id=e.organization_id
      JOIN partner_referrals r ON r.organization_id=p.organization_id
      WHERE e.id=(_input->>'eventId')::uuid AND e.processed_at IS NOT NULL;
  END IF;
  RETURN _id;
END $function$;
CREATE FUNCTION public.partner_observe_payment(_event_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $function$
DECLARE _e mercadopago_subscription_events%ROWTYPE; _p subscription_payments%ROWTYPE;
  _r partner_referrals%ROWTYPE; _s organization_subscriptions%ROWTYPE; _q partner_checkout_quotes%ROWTYPE;
BEGIN
  SELECT * INTO _e FROM mercadopago_subscription_events WHERE id=_event_id AND processed_at IS NOT NULL;
  IF NOT FOUND OR _e.payment_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO _p FROM subscription_payments WHERE id=_e.payment_id AND organization_id=_e.organization_id;
  IF NOT FOUND OR _p.provider<>'mercadopago' OR _p.currency_id<>'ARS' OR _p.amount_ars<=0 THEN RETURN NULL; END IF;
  SELECT * INTO _r FROM partner_referrals WHERE organization_id=_p.organization_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO _s FROM organization_subscriptions WHERE id=_p.subscription_id AND organization_id=_r.organization_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT EXISTS(SELECT 1 FROM partner_payment_receipts WHERE payment_id=_p.id) THEN
    IF _p.status='approved' AND _p.paid_at>now() THEN
      INSERT INTO partner_jobs(kind,input,dedupe_key,due_at) VALUES('ledger',jsonb_build_object('eventId',_e.id),'event:'||_e.id,_p.paid_at)
        ON CONFLICT DO NOTHING;
      RETURN NULL;
    END IF;
    IF _p.status<>'approved' OR _p.paid_at IS NULL OR _p.period_start IS NULL OR _p.period_end IS NULL
      OR _p.period_end<=_p.period_start THEN RETURN NULL; END IF;
    IF _s.mercadopago_preapproval_id IS DISTINCT FROM _p.mercadopago_preapproval_id
      OR _s.metadata->>'last_confirmed_mercadopago_preapproval_id' IS DISTINCT FROM _p.mercadopago_preapproval_id
      OR _s.last_payment_at<_p.paid_at OR nullif(_s.metadata->>'last_confirmed_mercadopago_external_reference','') IS NULL THEN RETURN NULL; END IF;
    IF _r.first_payment_id IS NULL THEN
      SELECT * INTO _q FROM partner_checkout_quotes WHERE referral_id=_r.id AND status='bound'
        AND preapproval_id=_p.mercadopago_preapproval_id AND plan_code=_p.plan_code
        AND amount_cents=round(_p.amount_ars*100)::bigint
        AND external_reference=_s.metadata->>'last_confirmed_mercadopago_external_reference' FOR UPDATE;
      IF NOT FOUND THEN RETURN NULL; END IF;
      UPDATE partner_referrals SET first_payment_id=_p.id,revision=revision+1 WHERE id=_r.id;
    END IF;
    INSERT INTO partner_payment_receipts(payment_id,referral_id,organization_id,sucursal_id,amount_cents,status,cycle_key,paid_at,external_reference)
      VALUES(_p.id,_r.id,_r.organization_id,_r.sucursal_id,round(_p.amount_ars*100)::bigint,_p.status,
        to_char(coalesce(_p.due_at,_p.period_start,_p.paid_at) AT TIME ZONE 'America/Argentina/Buenos_Aires','YYYY-MM'),_p.paid_at,
        _s.metadata->>'last_confirmed_mercadopago_external_reference');
  ELSE
    UPDATE partner_payment_receipts SET status=CASE WHEN status IN ('refunded','charged_back') THEN status ELSE _p.status END,
      refunded_cents=CASE WHEN _p.status IN ('refunded','charged_back') THEN amount_cents ELSE refunded_cents END,
      updated_at=clock_timestamp() WHERE payment_id=_p.id AND status IS DISTINCT FROM _p.status
      AND status NOT IN ('refunded','charged_back');
  END IF;
  RETURN _r.id;
END $function$;
CREATE FUNCTION public.partner_apply_effect(_reference jsonb,_revision text,_effect jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $function$
DECLARE _id uuid; _r partner_referrals%ROWTYPE; _ctx jsonb; _c partner_commissions%ROWTYPE;
  _first jsonb; _amount bigint; _adjust bigint; _status text; _qualified boolean; _held boolean; _net bigint;
  _item uuid; _old_amount bigint;
BEGIN
  _id:=partner_reference(_reference);
  PERFORM 1 FROM partners WHERE id=(SELECT partner_id FROM partner_referrals WHERE id=_id) FOR UPDATE;
  SELECT * INTO _r FROM partner_referrals WHERE id=_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('applied',false); END IF;
  PERFORM 1 FROM partner_payment_receipts WHERE referral_id=_r.id FOR UPDATE;
  SELECT * INTO _c FROM partner_commissions WHERE referral_id=_r.id FOR UPDATE;
  _ctx:=partner_context(_r.id);
  IF _ctx->>'revision' IS DISTINCT FROM _revision THEN RAISE EXCEPTION 'REVISION_CONFLICT'; END IF;
  _first:=_ctx->'firstPayment';
  IF _first='null'::jsonb THEN RETURN jsonb_build_object('applied',false); END IF;
  _net:=CASE WHEN _first->>'status'='approved' THEN (_first->>'amountCents')::bigint-(_first->>'refundedCents')::bigint ELSE 0 END;
  _amount:=round(_net::numeric*_r.percent_snapshot/100)::bigint;
  _qualified:=jsonb_array_length(_ctx->'validPaidCycleIds')>=2;
  _held:=(_ctx->>'held')::boolean;
  _status:=CASE WHEN coalesce(_c.paid_cents,0)>0 THEN 'paid' WHEN _net=0 THEN 'reversed' WHEN _held THEN 'held'
    WHEN now()>=(_first->>'paidAt')::timestamptz+interval '30 days' THEN 'available' ELSE 'pending' END;
  _adjust:=least(0,_amount-coalesce(_c.paid_cents,0))-coalesce(_c.adjustments_cents,0);
  -- Independent SQL recomputation: the service caller cannot smuggle an arbitrary effect.
  IF (_effect->>'firstPaymentId')::uuid IS DISTINCT FROM _r.first_payment_id
    OR (_effect->>'amountCents')::bigint IS DISTINCT FROM _amount
    OR (_effect->>'qualified')::boolean IS DISTINCT FROM _qualified
    OR (_effect->>'adjustmentDeltaCents')::bigint IS DISTINCT FROM _adjust THEN RAISE EXCEPTION 'INVALID_EFFECT'; END IF;
  _old_amount:=_c.amount_cents;
  INSERT INTO partner_commissions(referral_id,organization_id,sucursal_id,partner_id,first_payment_id,percent,amount_cents,status,available_at)
    VALUES(_r.id,_r.organization_id,_r.sucursal_id,_r.partner_id,_r.first_payment_id,_r.percent_snapshot,_amount,_status,
      (_first->>'paidAt')::timestamptz+interval '30 days')
    ON CONFLICT(referral_id) DO UPDATE SET amount_cents=excluded.amount_cents,status=excluded.status,
      revision=partner_commissions.revision+1
      WHERE partner_commissions.amount_cents IS DISTINCT FROM excluded.amount_cents OR partner_commissions.status IS DISTINCT FROM excluded.status;
  SELECT * INTO _c FROM partner_commissions WHERE referral_id=_r.id FOR UPDATE;
  IF _adjust<>0 THEN
    INSERT INTO partner_adjustments(commission_id,referral_id,organization_id,sucursal_id,delta_cents,source_revision)
      VALUES(_c.id,_r.id,_r.organization_id,_r.sucursal_id,_adjust,_revision) ON CONFLICT DO NOTHING;
    UPDATE partner_commissions SET adjustments_cents=adjustments_cents+_adjust,revision=revision+1 WHERE id=_c.id;
  END IF;
  IF _old_amount IS DISTINCT FROM _amount OR _held THEN
    FOR _item IN SELECT i.id FROM partner_payout_items i JOIN partner_payout_entries pe ON pe.item_id=i.id
      WHERE pe.commission_id=_c.id AND i.status='review' FOR UPDATE OF i LOOP
      UPDATE partner_payout_items SET status='held',revision=revision+1 WHERE id=_item;
      INSERT INTO partner_incidents(partner_id,kind,message,dedupe_key)
        VALUES(_r.partner_id,'payout_changed','La comisión cambió durante la revisión de una liquidación.','payout:'||_item)
        ON CONFLICT(dedupe_key) DO UPDATE SET resolved=false,revision=partner_incidents.revision+1;
    END LOOP;
  END IF;
  UPDATE partner_referrals SET qualified=_qualified,
    intro_consumed=intro_consumed OR _net>0,
    renewal_pending=renewal_pending OR (NOT intro_consumed AND _net>0),
    revision=revision+1 WHERE id=_r.id AND (qualified IS DISTINCT FROM _qualified OR (NOT intro_consumed AND _net>0));
  IF NOT _r.intro_consumed AND _net>0 THEN
    UPDATE partner_checkout_quotes SET status='consumed' WHERE referral_id=_r.id AND preapproval_id=
      (SELECT mercadopago_preapproval_id FROM subscription_payments WHERE id=_r.first_payment_id);
    INSERT INTO partner_jobs(kind,input,dedupe_key) VALUES('renewal',jsonb_build_object('attributionId',_r.id),'renewal:'||_r.id)
      ON CONFLICT(dedupe_key) DO NOTHING;
  END IF;
  RETURN jsonb_build_object('applied',true);
END $function$;
CREATE FUNCTION public.partner_context(_referral_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $function$
DECLARE _r partner_referrals%ROWTYPE; _p partner_payment_receipts%ROWTYPE; _c partner_commissions%ROWTYPE; _cycles jsonb; _rev text;
BEGIN
  SELECT * INTO _r FROM partner_referrals WHERE id=_referral_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO _p FROM partner_payment_receipts WHERE payment_id=_r.first_payment_id;
  SELECT * INTO _c FROM partner_commissions WHERE referral_id=_r.id;
  SELECT coalesce(jsonb_agg(DISTINCT cycle_key),'[]'::jsonb) INTO _cycles FROM partner_payment_receipts
    WHERE referral_id=_r.id AND status='approved' AND refunded_cents=0;
  SELECT md5(_r.revision::text||coalesce(_c.revision::text,'')||coalesce(string_agg(payment_id::text||status||refunded_cents::text||updated_at::text,',' ORDER BY payment_id),''))
    INTO _rev FROM partner_payment_receipts WHERE referral_id=_r.id;
  RETURN jsonb_build_object('revision',_rev,'firstPayment',CASE WHEN _p.payment_id IS NULL THEN NULL ELSE
    jsonb_build_object('id',_p.payment_id,'amountCents',_p.amount_cents,'refundedCents',_p.refunded_cents,'status',_p.status,'paidAt',_p.paid_at) END,
    'percent',coalesce(_r.percent_snapshot,10),'validPaidCycleIds',_cycles,'commissionPaidCents',coalesce(_c.paid_cents,0),
    'adjustmentsRecordedCents',coalesce(_c.adjustments_cents,0),'held',EXISTS(SELECT 1 FROM partner_incidents WHERE partner_id=_r.partner_id AND NOT resolved)
      OR EXISTS(SELECT 1 FROM partners WHERE id=_r.partner_id AND suspended),
    'introConsumed',_r.intro_consumed,'renewalPending',_r.renewal_pending);
END $function$;
CREATE FUNCTION public.partner_check_payout(_holder text,_tax text,_account text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=public AS $function$
DECLARE _sum integer:=0; _i integer; _digit integer; _weights integer[]:=ARRAY[5,4,3,2,7,6,5,4,3,2];
BEGIN
  IF length(btrim(_holder)) NOT BETWEEN 3 AND 80 OR _tax !~ '^\d{11}$' OR _account !~ '^\d{22}$' OR _account ~ '^0+$' THEN RETURN false; END IF;
  FOR _i IN 1..10 LOOP _sum:=_sum+substring(_tax,_i,1)::integer*_weights[_i]; END LOOP;
  _digit:=11-(_sum%11); IF _digit=11 THEN _digit:=0; ELSIF _digit=10 THEN _digit:=9; END IF;
  IF substring(_tax,11,1)::integer<>_digit THEN RETURN false; END IF;
  _sum:=0; _weights:=ARRAY[7,1,3,9,7,1,3];
  FOR _i IN 1..7 LOOP _sum:=_sum+substring(_account,_i,1)::integer*_weights[_i]; END LOOP;
  IF substring(_account,8,1)::integer<>(10-_sum%10)%10 THEN RETURN false; END IF;
  _sum:=0; _weights:=ARRAY[3,9,7,1,3,9,7,1,3,9,7,1,3];
  FOR _i IN 1..13 LOOP _sum:=_sum+substring(_account,_i+8,1)::integer*_weights[_i]; END LOOP;
  RETURN substring(_account,22,1)::integer=(10-_sum%10)%10;
END $function$;

CREATE FUNCTION public.partner_program_command(_contract_version integer,_action text,_actor_id uuid,_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $function$
DECLARE
  _u auth.users%ROWTYPE; _partner partners%ROWTYPE; _account partner_payout_accounts%ROWTYPE;
  _ref partner_referrals%ROWTYPE; _quote partner_checkout_quotes%ROWTYPE; _plan subscription_plans%ROWTYPE;
  _job partner_jobs%ROWTYPE; _sub organization_subscriptions%ROWTYPE; _item partner_payout_items%ROWTYPE;
  _incident partner_incidents%ROWTYPE; _op partner_operations%ROWTYPE;
  _result jsonb; _rows jsonb; _ctx jsonb; _id uuid; _batch uuid; _request uuid; _target uuid;
  _code text; _key text; _action_name text; _fingerprint text; _window timestamptz; _cutoff timestamptz;
  _max integer; _attempts integer; _allowed boolean:=true; _admin boolean:=false;
  _page integer; _size integer; _percent integer; _cents bigint; _net bigint; _revision bigint; _message text;
  _record record;
BEGIN
  IF current_user<>'service_role' THEN RAISE EXCEPTION 'PARTNER_SERVICE_ROLE_REQUIRED' USING ERRCODE='42501'; END IF;
  IF _contract_version IS DISTINCT FROM 1 OR jsonb_typeof(_input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  IF _action='readiness' THEN RETURN jsonb_build_object('ready',(SELECT enrollment_enabled AND billing_ready FROM partner_program_config WHERE singleton)); END IF;
  IF _actor_id IS NOT NULL THEN
    SELECT * INTO _u FROM auth.users WHERE id=_actor_id;
    IF NOT FOUND OR _u.email_confirmed_at IS NULL OR coalesce(_u.banned_until>now(),false) THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
    _admin:=coalesce(_u.raw_app_meta_data->>'platform_role','')='platform_admin';
  ELSIF _action NOT IN ('public_limit','validate_code','billing_context','apply_billing','historical_intro_payment',
    'payment_lookup','sync_payment','claim_jobs','prepare_renewal','complete_job','retry_job','instagram_consume_state',
    'instagram_job_credential','instagram_job_verified') THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  IF _action LIKE 'admin_%' AND NOT _admin THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF _action IN ('admin_agreement','admin_verify_payout','admin_prepare_payouts','admin_mark_paid','admin_resolve_incident','admin_suspend') THEN
    _request:=(_input->>'requestId')::uuid;
    IF _request IS NULL OR length(btrim(_input->>'reason')) NOT BETWEEN 10 AND 500 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
    _fingerprint:=md5(_action||_input::text);
    PERFORM pg_advisory_xact_lock(hashtextextended(_actor_id::text||_request::text,0));
    SELECT * INTO _op FROM partner_operations WHERE actor_id=_actor_id AND request_id=_request;
    IF FOUND THEN
      IF _op.fingerprint<>_fingerprint OR _op.action<>_action THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
      RETURN _op.result;
    END IF;
  END IF;
  IF _action='public_limit' THEN
    _action_name:=_input->>'action';
    IF _action_name NOT IN ('register','resend','validate_code') OR length(_input->>'sourceHash')<>44 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
    _window:=date_trunc(CASE WHEN _action_name='validate_code' THEN 'minute' ELSE 'hour' END,now());
    FOREACH _key IN ARRAY ARRAY[_action_name||':source:'||(_input->>'sourceHash'),
      CASE WHEN _action_name<>'validate_code' THEN 'mail:email:'||(_input->>'emailHash') END,
      CASE WHEN _action_name='validate_code' THEN 'code:global' ELSE 'mail:global' END] LOOP
      IF _key IS NULL THEN CONTINUE; END IF;
      _max:=CASE WHEN _key LIKE '%:global' THEN CASE WHEN _action_name='validate_code' THEN 600 ELSE 50 END
        WHEN _key LIKE 'mail:email:%' THEN 3 WHEN _action_name='validate_code' THEN 30 ELSE 5 END;
      INSERT INTO partner_public_limits(key,window_start,attempts) VALUES(_key,_window,1)
        ON CONFLICT(key,window_start) DO UPDATE SET attempts=partner_public_limits.attempts+1 RETURNING attempts INTO _attempts;
      _allowed:=_allowed AND _attempts<=_max;
    END LOOP;
    RETURN jsonb_build_object('allowed',_allowed);
  ELSIF _action='validate_code' THEN
    RETURN jsonb_build_object('valid',EXISTS(SELECT 1 FROM partners p,partner_program_config c
      WHERE p.code=upper(btrim(_input->>'code')) AND NOT p.suspended AND p.user_id IS NOT NULL
      AND c.enrollment_enabled AND c.billing_ready));
  ELSIF _action='enroll' THEN
    IF _admin OR _actor_id IS NULL OR _input->>'country' IS DISTINCT FROM 'AR' OR _input->>'termsVersion' IS DISTINCT FROM '2026-10-14-v1'
      OR NOT EXISTS(SELECT 1 FROM partner_program_config WHERE enrollment_enabled AND billing_ready) THEN RAISE EXCEPTION 'CAPABILITY_NOT_READY'; END IF;
    IF coalesce(_u.raw_app_meta_data->>'account_kind','')<>'partner' AND NOT EXISTS(
      SELECT 1 FROM user_roles ur JOIN profiles p ON p.id=ur.user_id WHERE ur.user_id=_actor_id AND ur.role='owner' AND p.organization_id IS NOT NULL) THEN RAISE EXCEPTION 'NOT_OWNER'; END IF;
    _code:=upper(btrim(_input->>'code'));
    IF _code IS NULL OR _code !~ '^[A-Z0-9]{4,20}$' OR _code IN ('VITTRO','ADMIN','SUPPORT','SOPORTE') THEN RAISE EXCEPTION 'INVALID_CODE'; END IF;
    PERFORM 1 FROM auth.users WHERE id=_actor_id FOR UPDATE;
    SELECT * INTO _partner FROM partners WHERE user_id=_actor_id;
    IF FOUND THEN
      IF _partner.code<>_code THEN RAISE EXCEPTION 'ALREADY_ENROLLED'; END IF;
      RETURN jsonb_build_object('id',_partner.id,'code',_partner.code);
    END IF;
    BEGIN
      INSERT INTO partners(user_id,name,code,terms_version) VALUES(_actor_id,
        left(coalesce(nullif(btrim(_u.raw_user_meta_data->>'full_name'),''),_u.email),80),_code,'2026-10-14-v1') RETURNING * INTO _partner;
    EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'CODE_TAKEN'; END;
    RETURN jsonb_build_object('id',_partner.id,'code',_partner.code);
  ELSIF _action='summary' THEN
    SELECT * INTO _partner FROM partners WHERE user_id=_actor_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('summary',NULL); END IF;
    SELECT * INTO _account FROM partner_payout_accounts WHERE partner_id=_partner.id;
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'amountCents',amount_cents,'status',status,
      'createdAt',created_at,'availableAt',available_at) ORDER BY created_at DESC),'[]'::jsonb) INTO _rows
      FROM (SELECT * FROM partner_commissions WHERE partner_id=_partner.id ORDER BY created_at DESC LIMIT 50) c;
    RETURN jsonb_build_object('tierInput',partner_tier_input(_partner.id),'summary',jsonb_build_object('id',_partner.id,'name',_partner.name,
      'code',_partner.code,'registrations',(SELECT count(*) FROM partner_referrals WHERE partner_id=_partner.id),
      'pendingCents',(SELECT coalesce(sum(amount_cents),0) FROM partner_commissions WHERE partner_id=_partner.id AND status IN ('pending','held')),
      'availableCents',(SELECT coalesce(sum(amount_cents),0) FROM partner_commissions WHERE partner_id=_partner.id AND status='available'),
      'paidCents',(SELECT coalesce(sum(amount_cents),0) FROM partner_payout_items WHERE partner_id=_partner.id AND status='paid'),
      'adjustmentsCents',(SELECT coalesce(sum(a.delta_cents),0) FROM partner_adjustments a JOIN partner_commissions c ON c.id=a.commission_id
        WHERE c.partner_id=_partner.id AND NOT EXISTS(SELECT 1 FROM partner_payout_entries pe JOIN partner_payout_items i ON i.id=pe.item_id WHERE pe.adjustment_id=a.id AND i.status='paid')),
      'instagram',coalesce((SELECT jsonb_build_object('connected',connected,'username',username,'followers',followers,'verifiedAt',verified_at)
        FROM partner_instagram_accounts WHERE partner_id=_partner.id),jsonb_build_object('connected',false,'username',NULL,'followers',NULL,'verifiedAt',NULL)),
      'payout',jsonb_build_object('configured',_account.partner_id IS NOT NULL,'verified',coalesce(_account.verified,false),'lastFour',right(_account.account,4)),
      'commissions',_rows));
  ELSIF _action='save_payout' THEN
    SELECT * INTO _partner FROM partners WHERE user_id=_actor_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
    IF NOT partner_check_payout(_input->>'holder',_input->>'taxId',_input->>'account') THEN RAISE EXCEPTION 'INVALID_PAYOUT'; END IF;
    IF EXISTS(SELECT 1 FROM partner_payout_items WHERE partner_id=_partner.id AND status IN ('review','held')) THEN RAISE EXCEPTION 'INCIDENT_OPEN'; END IF;
    INSERT INTO partner_payout_accounts(partner_id,holder,tax_id,account) VALUES(_partner.id,btrim(_input->>'holder'),_input->>'taxId',_input->>'account')
      ON CONFLICT(partner_id) DO UPDATE SET holder=excluded.holder,tax_id=excluded.tax_id,account=excluded.account,
      verified=false,verified_by=NULL,verified_at=NULL,revision=partner_payout_accounts.revision+1,updated_at=clock_timestamp();
    FOR _id IN SELECT partner_id FROM partner_payout_accounts WHERE partner_id<>_partner.id
      AND (account=_input->>'account' OR tax_id=_input->>'taxId') LOOP
      FOREACH _target IN ARRAY ARRAY[_id,_partner.id] LOOP
        INSERT INTO partner_incidents(partner_id,kind,message,dedupe_key) VALUES(_target,'duplicate_beneficiary',
          'El beneficiario coincide con otra identidad del programa.', 'duplicate:'||least(_id::text,_partner.id::text)||':'||greatest(_id::text,_partner.id::text)||':'||_target)
          ON CONFLICT(dedupe_key) DO UPDATE SET resolved=false,revision=partner_incidents.revision+1;
      END LOOP;
    END LOOP;
    RETURN jsonb_build_object('saved',true);
  ELSIF _action='prepare_checkout' THEN
    _id:=(_input->>'organizationId')::uuid;
    IF NOT EXISTS(SELECT 1 FROM profiles p JOIN user_roles ur ON ur.user_id=p.id WHERE p.id=_actor_id
      AND p.organization_id=_id AND ur.role IN ('owner','general_manager')) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    SELECT * INTO _ref FROM partner_referrals WHERE organization_id=_id FOR UPDATE;
    IF NOT FOUND OR _ref.intro_consumed THEN RETURN jsonb_build_object('quote',NULL); END IF;
    IF EXISTS(SELECT 1 FROM subscription_payments WHERE organization_id=_id AND status='approved') THEN RAISE EXCEPTION 'INCIDENT_OPEN'; END IF;
    SELECT * INTO _plan FROM subscription_plans WHERE code=_input->>'planCode' FOR SHARE;
    IF NOT FOUND OR NOT _plan.is_active OR _plan.amount_ars IS DISTINCT FROM (_input->>'catalogAmountArs')::numeric
      OR _plan.price_version IS DISTINCT FROM (_input->>'priceVersion')::integer OR _plan.updated_at IS DISTINCT FROM (_input->>'planUpdatedAt')::timestamptz THEN RAISE EXCEPTION 'REVISION_CONFLICT'; END IF;
    SELECT * INTO _quote FROM partner_checkout_quotes WHERE referral_id=_ref.id AND status IN ('quoted','bound')
      AND plan_code=_plan.code AND price_version=_plan.price_version AND plan_updated_at=_plan.updated_at
      AND catalog_amount_cents=round(_plan.amount_ars*100)::bigint ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN
      UPDATE partner_checkout_quotes SET status='invalidated' WHERE referral_id=_ref.id AND status IN ('quoted','bound');
      _cents:=round(_plan.amount_ars*100)::bigint;
      INSERT INTO partner_checkout_quotes(referral_id,organization_id,sucursal_id,plan_code,catalog_amount_cents,amount_cents,price_version,plan_updated_at,percent,terms_version)
        VALUES(_ref.id,_id,_ref.sucursal_id,_plan.code,_cents,_cents-round(_cents::numeric*10/100)::bigint,_plan.price_version,_plan.updated_at,
          coalesce(_ref.percent_snapshot,partner_rate(_ref.partner_id)),coalesce(_ref.snapshot_terms,'2026-10-14-v1')) RETURNING * INTO _quote;
    END IF;
    RETURN jsonb_build_object('quote',jsonb_build_object('id',_quote.id,'amountArs',_quote.amount_cents::numeric/100,
      'catalogAmountArs',_quote.catalog_amount_cents::numeric/100,'percent',_quote.percent,'termsVersion',_quote.terms_version));
  ELSIF _action='billing_context' THEN
    _id:=CASE WHEN _input ? 'eventId' THEN partner_observe_payment((_input->>'eventId')::uuid) ELSE partner_reference(_input) END;
    RETURN jsonb_build_object('context',partner_context(_id));
  ELSIF _action='apply_billing' THEN
    RETURN partner_apply_effect(_input,_input->>'revision',_input->'effect');
  ELSIF _action='historical_intro_payment' THEN
    RETURN jsonb_build_object('accepted',EXISTS(SELECT 1 FROM partner_referrals r JOIN subscription_payments p ON p.id=r.first_payment_id
      JOIN partner_checkout_quotes q ON q.referral_id=r.id AND q.preapproval_id=p.mercadopago_preapproval_id
      WHERE r.organization_id=(_input->>'organizationId')::uuid AND p.mercadopago_authorized_payment_id=_input->>'authorizedPaymentId'
      AND p.mercadopago_preapproval_id=_input->>'preapprovalId' AND p.currency_id='ARS' AND _input->>'currency'='ARS'
      AND p.amount_ars=(_input->>'amountArs')::numeric AND round(p.amount_ars*100)::bigint=q.amount_cents));
  ELSIF _action='payment_lookup' THEN
    SELECT jsonb_build_object('id',p.id,'providerId',p.mercadopago_payment_id,'reference',pr.external_reference,'amountArs',p.amount_ars) INTO _result
      FROM partner_payment_receipts pr JOIN subscription_payments p ON p.id=pr.payment_id
      WHERE p.mercadopago_payment_id=_input->>'providerPaymentId' AND p.provider='mercadopago' AND p.currency_id='ARS' LIMIT 1;
    RETURN jsonb_build_object('payment',_result);
  ELSIF _action='sync_payment' THEN
    SELECT referral_id INTO _id FROM partner_payment_receipts WHERE payment_id=(_input->>'paymentId')::uuid;
    PERFORM 1 FROM partner_referrals WHERE id=_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
    IF NOT EXISTS(SELECT 1 FROM subscription_payments WHERE id=(_input->>'paymentId')::uuid AND provider='mercadopago'
      AND mercadopago_payment_id=_input->>'providerPaymentId') THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
    IF _input->>'status' NOT IN ('approved','refunded','charged_back','cancelled','in_process','rejected') THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
    UPDATE partner_payment_receipts SET status=CASE WHEN status IN ('refunded','charged_back') THEN status ELSE _input->>'status' END,
      refunded_cents=greatest(refunded_cents,CASE WHEN _input->>'status' IN ('refunded','charged_back') THEN amount_cents ELSE (_input->>'refundedCents')::bigint END),
      updated_at=clock_timestamp() WHERE payment_id=(_input->>'paymentId')::uuid;
    RETURN jsonb_build_object('synced',true);
  ELSIF _action='claim_jobs' THEN
    DELETE FROM partner_public_limits WHERE window_start<now()-interval '2 days';
    DELETE FROM partner_oauth_states WHERE expires_at<now()-interval '1 day';
    INSERT INTO partner_jobs(kind,input,dedupe_key)
      SELECT 'ledger',jsonb_build_object('attributionId',r.id),'ledger:'||r.id FROM partner_referrals r
      WHERE r.first_payment_id IS NOT NULL
      ON CONFLICT(dedupe_key) DO UPDATE SET status='pending',due_at=now(),completed_at=NULL
        WHERE partner_jobs.status='completed' AND partner_jobs.due_at<=now();
    INSERT INTO partner_jobs(kind,input,dedupe_key)
      SELECT 'payment',jsonb_build_object('providerPaymentId',p.mercadopago_payment_id),'payment:'||p.id
      FROM partner_payment_receipts pr JOIN subscription_payments p ON p.id=pr.payment_id WHERE p.mercadopago_payment_id IS NOT NULL
      ON CONFLICT(dedupe_key) DO UPDATE SET status='pending',due_at=now(),completed_at=NULL
        WHERE partner_jobs.status='completed' AND partner_jobs.due_at<=now();
    INSERT INTO partner_jobs(kind,input,dedupe_key)
      SELECT 'instagram',jsonb_build_object('partnerId',partner_id),'instagram:'||partner_id FROM partner_instagram_accounts
      WHERE connected AND verified_at<=now()-interval '25 days'
      ON CONFLICT(dedupe_key) DO UPDATE SET status='pending',due_at=now(),completed_at=NULL
        WHERE partner_jobs.status='completed' AND partner_jobs.due_at<=now();
    UPDATE partner_jobs SET status='pending',lease=NULL,lease_until=NULL WHERE status='running' AND lease_until<=now();
    WITH chosen AS (SELECT id FROM partner_jobs WHERE status='pending' AND due_at<=now()
      ORDER BY CASE kind WHEN 'renewal' THEN 0 WHEN 'payment' THEN 1 ELSE 2 END,due_at,id LIMIT least(25,greatest(1,coalesce((_input->>'limit')::integer,25))) FOR UPDATE SKIP LOCKED),
    leased AS (UPDATE partner_jobs j SET status='running',lease=gen_random_uuid(),lease_until=now()+interval '3 minutes',attempts=attempts+1
      FROM chosen c WHERE j.id=c.id RETURNING j.*)
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'lease',lease,'kind',kind,'input',input)),'[]'::jsonb) INTO _rows FROM leased;
    RETURN jsonb_build_object('jobs',_rows);
  ELSIF _action IN ('prepare_renewal','complete_job','retry_job','instagram_job_credential','instagram_job_verified') THEN
    SELECT * INTO _job FROM partner_jobs WHERE id=(_input->>'jobId')::uuid AND lease=(_input->>'lease')::uuid
      AND status='running' AND lease_until>now() FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'REVISION_CONFLICT'; END IF;
    IF _action='prepare_renewal' THEN
      IF _job.kind<>'renewal' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
      SELECT * INTO _ref FROM partner_referrals WHERE id=(_job.input->>'attributionId')::uuid FOR UPDATE;
      SELECT * INTO _sub FROM organization_subscriptions WHERE organization_id=_ref.organization_id FOR UPDATE;
      IF NOT FOUND OR _sub.status<>'active' OR _sub.provider<>'mercadopago' OR _sub.mercadopago_preapproval_id IS DISTINCT FROM
        (SELECT mercadopago_preapproval_id FROM subscription_payments WHERE id=_ref.first_payment_id) THEN RETURN jsonb_build_object('intent',NULL); END IF;
      SELECT * INTO _plan FROM subscription_plans WHERE code=coalesce(_sub.billing_plan_code,_sub.current_plan_code) FOR SHARE;
      IF NOT FOUND OR _plan.amount_ars<=0 THEN RAISE EXCEPTION 'CAPABILITY_NOT_READY'; END IF;
      UPDATE organization_subscriptions SET billing_amount_ars=_plan.amount_ars,billing_price_version=_plan.price_version,
        metadata=metadata||jsonb_build_object('partner_intro_consumed',true,'partner_intro_amount_ars',
          (SELECT amount_ars FROM subscription_payments WHERE id=_ref.first_payment_id)),updated_at=clock_timestamp()
        WHERE id=_sub.id RETURNING * INTO _sub;
      RETURN jsonb_build_object('intent',jsonb_build_object('organizationId',_ref.organization_id,
        'preapprovalId',_sub.mercadopago_preapproval_id,'externalReference',_sub.mercadopago_external_reference));
    ELSIF _action='complete_job' THEN
      UPDATE partner_jobs SET status='completed',lease=NULL,lease_until=NULL,error_code=NULL,completed_at=now(),
        due_at=now()+CASE kind WHEN 'payment' THEN interval '1 day' WHEN 'ledger' THEN interval '1 hour' WHEN 'instagram' THEN interval '25 days' ELSE interval '100 years' END WHERE id=_job.id;
      IF _job.kind='renewal' THEN UPDATE partner_referrals SET renewal_pending=false,revision=revision+1 WHERE id=(_job.input->>'attributionId')::uuid; END IF;
      RETURN jsonb_build_object('completed',true);
    ELSIF _action='retry_job' THEN
      UPDATE partner_jobs SET status='pending',lease=NULL,lease_until=NULL,error_code='JOB_RETRY',
        due_at=now()+make_interval(secs=>least(3600,30*power(2,least(attempts,7)))::integer) WHERE id=_job.id;
      IF _job.attempts>=5 THEN
        SELECT partner_id INTO _id FROM partner_referrals WHERE id=(_job.input->>'attributionId')::uuid;
        IF _job.kind='instagram' THEN _id:=(_job.input->>'partnerId')::uuid; END IF;
        IF _job.kind='payment' THEN SELECT r.partner_id INTO _id FROM partner_payment_receipts pr
          JOIN partner_referrals r ON r.id=pr.referral_id JOIN subscription_payments p ON p.id=pr.payment_id
          WHERE p.mercadopago_payment_id=_job.input->>'providerPaymentId'; END IF;
        IF _id IS NOT NULL THEN INSERT INTO partner_incidents(partner_id,kind,message,dedupe_key)
          VALUES(_id,'job_failed','Un proceso del programa requiere revisión.','job:'||_job.id)
          ON CONFLICT(dedupe_key) DO UPDATE SET resolved=false,revision=partner_incidents.revision+1; END IF;
      END IF;
      RETURN jsonb_build_object('retry',true);
    ELSE
      IF _job.kind<>'instagram' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
      SELECT partner_id INTO _id FROM partner_instagram_accounts WHERE partner_id=(_job.input->>'partnerId')::uuid AND connected FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'REVISION_CONFLICT'; END IF;
      IF _action='instagram_job_credential' THEN
        RETURN (SELECT jsonb_build_object('accountId',a.account_id,'encryptedToken',c.ciphertext) FROM partner_instagram_accounts a
          JOIN partner_instagram_credentials c ON c.partner_id=a.partner_id WHERE a.partner_id=_id);
      END IF;
      IF NOT EXISTS(SELECT 1 FROM partner_instagram_accounts WHERE partner_id=_id AND account_id=_input->>'accountId') THEN RAISE EXCEPTION 'REVISION_CONFLICT'; END IF;
      UPDATE partner_instagram_accounts SET username=_input->>'username',followers=(_input->>'followers')::bigint,verified_at=now(),revision=revision+1 WHERE partner_id=_id;
      UPDATE partner_instagram_credentials SET ciphertext=_input->>'encryptedToken',expires_at=(_input->>'expiresAt')::timestamptz WHERE partner_id=_id;
      RETURN jsonb_build_object('verified',true);
    END IF;
  ELSIF _action IN ('instagram_state','instagram_verified','instagram_disconnect') THEN
    SELECT * INTO _partner FROM partners WHERE user_id=_actor_id AND NOT suspended FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
    IF _action='instagram_state' THEN
      IF length(_input->>'hash')<>44 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
      INSERT INTO partner_oauth_states(hash,partner_id,actor_id) VALUES(_input->>'hash',_partner.id,_actor_id);
      RETURN jsonb_build_object('created',true);
    ELSIF _action='instagram_disconnect' THEN
      UPDATE partner_instagram_accounts SET connected=false,revision=revision+1 WHERE partner_id=_partner.id;
      DELETE FROM partner_instagram_credentials WHERE partner_id=_partner.id;
      DELETE FROM partner_oauth_states WHERE partner_id=_partner.id;
      RETURN jsonb_build_object('disconnected',true);
    ELSE
      INSERT INTO partner_instagram_accounts(partner_id,account_id,username,followers,verified_at)
        VALUES(_partner.id,_input->>'accountId',_input->>'username',(_input->>'followers')::bigint,now())
        ON CONFLICT(partner_id) DO UPDATE SET account_id=excluded.account_id,username=excluded.username,followers=excluded.followers,
          verified_at=now(),connected=true,revision=partner_instagram_accounts.revision+1;
      INSERT INTO partner_instagram_credentials(partner_id,ciphertext,expires_at) VALUES(_partner.id,_input->>'encryptedToken',(_input->>'expiresAt')::timestamptz)
        ON CONFLICT(partner_id) DO UPDATE SET ciphertext=excluded.ciphertext,expires_at=excluded.expires_at;
      RETURN jsonb_build_object('verified',true);
    END IF;
  ELSIF _action='instagram_consume_state' THEN
    UPDATE partner_oauth_states s SET consumed_at=now() WHERE hash=_input->>'hash' AND consumed_at IS NULL AND expires_at>now()
      AND EXISTS(SELECT 1 FROM partners p WHERE p.id=s.partner_id AND p.user_id=s.actor_id AND NOT p.suspended) RETURNING actor_id INTO _id;
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_OAUTH_STATE'; END IF;
    RETURN jsonb_build_object('actorId',_id);
  ELSIF _action='admin_summary' THEN
    _page:=greatest(1,coalesce((_input->>'page')::integer,1)); _size:=least(50,greatest(1,coalesce((_input->>'pageSize')::integer,25)));
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'code',p.code,'percent',partner_rate(p.id),
      'registrations',(SELECT count(*) FROM partner_referrals WHERE partner_id=p.id),
      'qualifiedOrganizations',(SELECT count(*) FROM partner_referrals WHERE partner_id=p.id AND qualified),
      'availableCents',(SELECT coalesce(sum(amount_cents),0) FROM partner_commissions WHERE partner_id=p.id AND status='available'),
      'payoutVerified',coalesce((SELECT verified FROM partner_payout_accounts WHERE partner_id=p.id),false),'suspended',p.suspended,'revision',p.revision::text)
      ORDER BY p.created_at DESC),'[]'::jsonb) INTO _rows FROM (SELECT * FROM partners ORDER BY created_at DESC,id LIMIT _size OFFSET (_page-1)*_size) p;
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'partnerId',i.partner_id,'name',p.name,'amountCents',i.amount_cents,'holder',i.holder,
      'taxId',i.tax_id,'account',i.account,'verified',a.verified AND a.revision=i.account_revision,'status',i.status,'revision',i.revision::text)
      ORDER BY b.created_at DESC),'[]'::jsonb) INTO _result FROM (SELECT * FROM partner_payout_items WHERE status IN ('review','held') ORDER BY id LIMIT _size OFFSET (_page-1)*_size) i
      JOIN partners p ON p.id=i.partner_id JOIN partner_payout_batches b ON b.id=i.batch_id JOIN partner_payout_accounts a ON a.partner_id=i.partner_id;
    RETURN jsonb_build_object('partners',_rows,'payouts',_result,'totalPartners',(SELECT count(*) FROM partners),'page',_page,'pageSize',_size,
      'incidents',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'partnerId',partner_id,'message',message,'revision',revision::text)),'[]'::jsonb)
        FROM (SELECT * FROM partner_incidents WHERE NOT resolved ORDER BY created_at,id LIMIT _size OFFSET (_page-1)*_size) z));
  ELSIF _action='admin_payout_details' THEN
    RETURN (SELECT jsonb_build_object('holder',holder,'taxId',tax_id,'account',account,'revision',revision::text,'verified',verified)
      FROM partner_payout_accounts WHERE partner_id=(_input->>'partnerId')::uuid);
  ELSIF _action='admin_operation_status' THEN
    SELECT result INTO _result FROM partner_operations WHERE actor_id=_actor_id AND request_id=(_input->>'requestId')::uuid;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;
    RETURN jsonb_build_object('status',coalesce(_result->>'status','completed'),'result',_result);
  ELSIF _action='admin_agreement' THEN
    SELECT * INTO _partner FROM partners WHERE id=(_input->>'partnerId')::uuid FOR UPDATE;
    IF NOT FOUND OR _partner.revision::text IS DISTINCT FROM _input->>'revision' THEN RAISE EXCEPTION 'REVISION_CONFLICT'; END IF;
    IF (_input->>'percent')::integer NOT BETWEEN 1 AND 100 OR (_input->>'endsAt')::timestamptz<=(_input->>'startsAt')::timestamptz THEN RAISE EXCEPTION 'INVALID_AGREEMENT'; END IF;
    IF EXISTS(SELECT 1 FROM partner_agreements WHERE partner_id=_partner.id AND NOT suspended
      AND tstzrange(starts_at,ends_at,'[)') && tstzrange((_input->>'startsAt')::timestamptz,(_input->>'endsAt')::timestamptz,'[)')) THEN RAISE EXCEPTION 'AGREEMENT_OVERLAP'; END IF;
    INSERT INTO partner_agreements(partner_id,percent,starts_at,ends_at,reason,actor_id)
      VALUES(_partner.id,(_input->>'percent')::integer,(_input->>'startsAt')::timestamptz,(_input->>'endsAt')::timestamptz,btrim(_input->>'reason'),_actor_id);
    UPDATE partners SET revision=revision+1 WHERE id=_partner.id;
    _result:=jsonb_build_object('saved',true);
  ELSIF _action='admin_verify_payout' THEN
    PERFORM 1 FROM partners WHERE id=(_input->>'partnerId')::uuid FOR UPDATE;
    SELECT * INTO _account FROM partner_payout_accounts WHERE partner_id=(_input->>'partnerId')::uuid FOR UPDATE;
    IF NOT FOUND OR _account.revision::text IS DISTINCT FROM _input->>'revision' THEN RAISE EXCEPTION 'REVISION_CONFLICT'; END IF;
    IF EXISTS(SELECT 1 FROM partner_incidents WHERE partner_id=_account.partner_id AND NOT resolved) THEN RAISE EXCEPTION 'INCIDENT_OPEN'; END IF;
    UPDATE partner_payout_accounts SET verified=true,verified_by=_actor_id,verified_at=now(),revision=revision+1 WHERE partner_id=_account.partner_id;
    _result:=jsonb_build_object('verified',true);
  ELSIF _action='admin_prepare_payouts' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('partner-payout-preparation',0));
    _cutoff:=date_trunc('month',now() AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'America/Argentina/Buenos_Aires';
    INSERT INTO partner_payout_batches(cutoff,created_by) VALUES(_cutoff,_actor_id) RETURNING id INTO _batch;
    FOR _partner IN SELECT p.* FROM partners p JOIN partner_payout_accounts a ON a.partner_id=p.id
      WHERE a.verified AND NOT p.suspended AND NOT EXISTS(SELECT 1 FROM partner_incidents WHERE partner_id=p.id AND NOT resolved)
      AND NOT EXISTS(SELECT 1 FROM partner_payout_items WHERE partner_id=p.id AND status IN ('review','held')) ORDER BY p.id FOR UPDATE OF p LOOP
      SELECT * INTO _account FROM partner_payout_accounts WHERE partner_id=_partner.id FOR UPDATE;
      PERFORM 1 FROM partner_commissions WHERE partner_id=_partner.id FOR UPDATE;
      SELECT coalesce(sum(amount_cents),0) INTO _net FROM partner_commissions c WHERE partner_id=_partner.id AND status='available'
        AND available_at<_cutoff AND NOT EXISTS(SELECT 1 FROM partner_payout_entries WHERE commission_id=c.id);
      SELECT _net+coalesce(sum(a.delta_cents),0) INTO _net FROM partner_adjustments a JOIN partner_commissions c ON c.id=a.commission_id
        WHERE c.partner_id=_partner.id AND a.created_at<_cutoff AND NOT EXISTS(SELECT 1 FROM partner_payout_entries WHERE adjustment_id=a.id);
      IF _net<=0 THEN CONTINUE; END IF;
      INSERT INTO partner_payout_items(batch_id,partner_id,amount_cents,holder,tax_id,account,account_revision)
        VALUES(_batch,_partner.id,_net,_account.holder,_account.tax_id,_account.account,_account.revision) RETURNING id INTO _id;
      INSERT INTO partner_payout_entries(item_id,commission_id,amount_cents) SELECT _id,c.id,c.amount_cents FROM partner_commissions c
        WHERE partner_id=_partner.id AND status='available' AND available_at<_cutoff AND NOT EXISTS(SELECT 1 FROM partner_payout_entries WHERE commission_id=c.id);
      INSERT INTO partner_payout_entries(item_id,adjustment_id,amount_cents) SELECT _id,a.id,a.delta_cents FROM partner_adjustments a JOIN partner_commissions c ON c.id=a.commission_id
        WHERE c.partner_id=_partner.id AND a.created_at<_cutoff AND NOT EXISTS(SELECT 1 FROM partner_payout_entries WHERE adjustment_id=a.id);
    END LOOP;
    _result:=jsonb_build_object('batchId',_batch,'items',(SELECT count(*) FROM partner_payout_items WHERE batch_id=_batch));
  ELSIF _action='admin_mark_paid' THEN
    PERFORM 1 FROM partners WHERE id=(SELECT partner_id FROM partner_payout_items WHERE id=(_input->>'payoutId')::uuid) FOR UPDATE;
    SELECT * INTO _item FROM partner_payout_items WHERE id=(_input->>'payoutId')::uuid FOR UPDATE;
    IF NOT FOUND OR _item.revision::text IS DISTINCT FROM _input->>'revision' THEN RAISE EXCEPTION 'REVISION_CONFLICT'; END IF;
    IF _item.status='paid' THEN RAISE EXCEPTION 'ALREADY_PAID'; END IF;
    SELECT * INTO _partner FROM partners WHERE id=_item.partner_id FOR UPDATE;
    SELECT * INTO _account FROM partner_payout_accounts WHERE partner_id=_item.partner_id FOR UPDATE;
    IF _item.status<>'review' OR NOT _account.verified OR _item.account_revision<>_account.revision OR _item.account<>_account.account OR _partner.suspended
      OR EXISTS(SELECT 1 FROM partner_incidents WHERE partner_id=_item.partner_id AND NOT resolved) THEN RAISE EXCEPTION 'PAYOUT_NOT_VERIFIED'; END IF;
    PERFORM 1 FROM partner_commissions c JOIN partner_payout_entries pe ON pe.commission_id=c.id WHERE pe.item_id=_item.id FOR UPDATE OF c;
    IF EXISTS(SELECT 1 FROM partner_commissions c JOIN partner_payout_entries pe ON pe.commission_id=c.id
      WHERE pe.item_id=_item.id AND (c.status<>'available' OR c.amount_cents<>pe.amount_cents OR c.paid_cents<>0)) THEN RAISE EXCEPTION 'REVISION_CONFLICT'; END IF;
    IF coalesce(length(btrim(_input->>'reference')),0) NOT BETWEEN 3 AND 150 OR NOT EXISTS(SELECT 1 FROM storage.objects
      WHERE bucket_id='partner-payout-receipts' AND name=_input->>'receiptPath'
      AND name LIKE 'partner-payouts/'||_item.id||'/'||_request||'.%' AND owner_id=_actor_id::text) THEN RAISE EXCEPTION 'INVALID_RECEIPT'; END IF;
    UPDATE partner_payout_items SET status='paid',reference=btrim(_input->>'reference'),receipt_path=_input->>'receiptPath',paid_at=now(),paid_by=_actor_id,revision=revision+1 WHERE id=_item.id;
    UPDATE partner_commissions c SET status='paid',paid_cents=pe.amount_cents,revision=revision+1 FROM partner_payout_entries pe WHERE pe.item_id=_item.id AND pe.commission_id=c.id;
    _result:=jsonb_build_object('paid',true,'payoutId',_item.id);
  ELSIF _action='admin_resolve_incident' THEN
    SELECT * INTO _incident FROM partner_incidents WHERE id=(_input->>'id')::uuid FOR UPDATE;
    IF NOT FOUND OR _incident.revision::text IS DISTINCT FROM _input->>'revision' THEN RAISE EXCEPTION 'REVISION_CONFLICT'; END IF;
    PERFORM 1 FROM partners WHERE id=_incident.partner_id FOR UPDATE;
    UPDATE partner_incidents SET resolved=true,reason=btrim(_input->>'reason'),resolved_by=_actor_id,revision=revision+1 WHERE id=_incident.id;
    IF _incident.kind='payout_changed' THEN
      SELECT id INTO _id FROM partner_payout_items WHERE id=substring(_incident.dedupe_key FROM 8)::uuid AND status='held' FOR UPDATE;
      IF FOUND THEN
        DELETE FROM partner_payout_entries WHERE item_id=_id;
        UPDATE partner_payout_items SET status='cancelled',revision=revision+1 WHERE id=_id;
      END IF;
    END IF;
    INSERT INTO partner_jobs(kind,input,dedupe_key) SELECT 'ledger',jsonb_build_object('attributionId',id),'ledger:'||id FROM partner_referrals WHERE partner_id=_incident.partner_id
      ON CONFLICT(dedupe_key) DO UPDATE SET status='pending',due_at=now() WHERE partner_jobs.status<>'running';
    _result:=jsonb_build_object('resolved',true);
  ELSIF _action='admin_suspend' THEN
    SELECT * INTO _partner FROM partners WHERE id=(_input->>'id')::uuid FOR UPDATE;
    IF NOT FOUND OR _partner.revision::text IS DISTINCT FROM _input->>'revision' THEN RAISE EXCEPTION 'REVISION_CONFLICT'; END IF;
    UPDATE partners SET suspended=true,revision=revision+1 WHERE id=_partner.id;
    UPDATE partner_commissions SET status='held',revision=revision+1 WHERE partner_id=_partner.id AND status IN ('pending','available');
    UPDATE partner_payout_items SET status='held',revision=revision+1 WHERE partner_id=_partner.id AND status='review';
    _result:=jsonb_build_object('suspended',true);
  ELSE RAISE EXCEPTION 'INVALID_ACTION'; END IF;
  INSERT INTO partner_operations(actor_id,request_id,action,fingerprint,reason,result)
    VALUES(_actor_id,_request,_action,_fingerprint,btrim(_input->>'reason'),_result||jsonb_build_object('status','completed'));
  RETURN _result;
EXCEPTION WHEN OTHERS THEN
  IF _admin AND _request IS NOT NULL AND _fingerprint IS NOT NULL THEN
    GET STACKED DIAGNOSTICS _message=MESSAGE_TEXT;
    _message:=CASE WHEN _message IN ('REVISION_CONFLICT','INVALID_REQUEST','INVALID_AGREEMENT','AGREEMENT_OVERLAP','INCIDENT_OPEN',
      'PAYOUT_NOT_VERIFIED','ALREADY_PAID','INVALID_RECEIPT','REQUEST_CONFLICT') THEN _message ELSE 'OPERATION_REJECTED' END;
    _result:=jsonb_build_object('status','rejected','code',_message);
    INSERT INTO partner_operations(actor_id,request_id,action,fingerprint,reason,result)
      VALUES(_actor_id,_request,_action,_fingerprint,left(coalesce(_input->>'reason',''),500),_result) ON CONFLICT(actor_id,request_id) DO NOTHING;
    RETURN _result;
  END IF;
  RAISE;
END $function$;
