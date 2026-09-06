-- Vittro platform administration foundation.
--
-- IMPORTANT DEPLOYMENT NOTE
-- -------------------------
-- This migration intentionally replaces public.handle_new_user(), which is an
-- existing SECURITY DEFINER trigger function, only to add the early
-- platform_admin provisioning exception below. Per the repository policy this
-- file must be reviewed and applied through Lovable; do not apply it directly
-- from a local or automated agent session.

-- subscription_plans.amount_ars is the only commercial price source.
ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS price_version integer NOT NULL DEFAULT 1
  CHECK (price_version > 0);

ALTER TABLE public.organization_subscriptions
  ADD COLUMN IF NOT EXISTS billing_amount_ars numeric(12, 2)
    CHECK (billing_amount_ars IS NULL OR billing_amount_ars > 0),
  ADD COLUMN IF NOT EXISTS billing_price_version integer
    CHECK (billing_price_version IS NULL OR billing_price_version > 0),
  ADD COLUMN IF NOT EXISTS pending_checkout_amount_ars numeric(12, 2)
    CHECK (pending_checkout_amount_ars IS NULL OR pending_checkout_amount_ars > 0),
  ADD COLUMN IF NOT EXISTS pending_checkout_price_version integer
    CHECK (pending_checkout_price_version IS NULL OR pending_checkout_price_version > 0);

-- Preserve a best-effort billing snapshot for existing paid subscriptions.
-- Existing pending links deliberately remain unversioned so checkout code will
-- never reuse a link created before this migration.
UPDATE public.organization_subscriptions AS subscription
SET
  billing_amount_ars = COALESCE(
    subscription.billing_amount_ars,
    (
      SELECT payment.amount_ars
      FROM public.subscription_payments AS payment
      WHERE payment.subscription_id = subscription.id
        AND payment.status = 'approved'
      ORDER BY payment.paid_at DESC NULLS LAST, payment.created_at DESC
      LIMIT 1
    ),
    plan.amount_ars
  ),
  billing_price_version = COALESCE(
    subscription.billing_price_version,
    CASE
      WHEN COALESCE(
        subscription.billing_amount_ars,
        (
          SELECT payment.amount_ars
          FROM public.subscription_payments AS payment
          WHERE payment.subscription_id = subscription.id
            AND payment.status = 'approved'
          ORDER BY payment.paid_at DESC NULLS LAST, payment.created_at DESC
          LIMIT 1
        ),
        plan.amount_ars
      ) = plan.amount_ars
      THEN plan.price_version
      ELSE NULL
    END
  )
FROM public.subscription_plans AS plan
WHERE plan.code = COALESCE(
  subscription.billing_plan_code,
  subscription.current_plan_code,
  subscription.effective_plan_code
)
  AND (
    subscription.billing_amount_ars IS NULL
    OR subscription.billing_price_version IS NULL
  );

CREATE TABLE IF NOT EXISTS public.platform_admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_alias text NOT NULL DEFAULT 'admin',
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  reason text,
  previous_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  next_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_status text NOT NULL DEFAULT 'succeeded'
    CHECK (result_status IN ('pending', 'succeeded', 'partial', 'failed', 'skipped')),
  result_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_admin_audit_reason_length
    CHECK (reason IS NULL OR char_length(reason) <= 500)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_admin_audit_request_action
  ON public.platform_admin_audit_log (request_id, action);
CREATE INDEX IF NOT EXISTS idx_platform_admin_audit_created
  ON public.platform_admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_admin_audit_actor
  ON public.platform_admin_audit_log (actor_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.subscription_price_change_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_code text NOT NULL REFERENCES public.subscription_plans(code),
  old_amount_ars numeric(12, 2) NOT NULL CHECK (old_amount_ars > 0),
  new_amount_ars numeric(12, 2) NOT NULL CHECK (new_amount_ars > 0),
  old_price_version integer NOT NULL CHECK (old_price_version > 0),
  new_price_version integer NOT NULL CHECK (new_price_version > 0),
  expected_updated_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'partially_completed', 'completed', 'failed')),
  total_items integer NOT NULL DEFAULT 0 CHECK (total_items >= 0),
  processed_items integer NOT NULL DEFAULT 0 CHECK (processed_items >= 0),
  succeeded_items integer NOT NULL DEFAULT 0 CHECK (succeeded_items >= 0),
  failed_items integer NOT NULL DEFAULT 0 CHECK (failed_items >= 0),
  skipped_items integer NOT NULL DEFAULT 0 CHECK (skipped_items >= 0),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_alias text NOT NULL DEFAULT 'admin',
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 10 AND 500),
  request_id uuid NOT NULL UNIQUE,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscription_price_change_version_step
    CHECK (new_price_version = old_price_version + 1),
  CONSTRAINT subscription_price_change_amount_changed
    CHECK (new_amount_ars <> old_amount_ars)
);

CREATE INDEX IF NOT EXISTS idx_price_change_batches_plan_created
  ON public.subscription_price_change_batches (plan_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_change_batches_status
  ON public.subscription_price_change_batches (status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_price_change_batches_one_unfinished_plan
  ON public.subscription_price_change_batches (plan_code)
  WHERE status <> 'completed';

CREATE TABLE IF NOT EXISTS public.subscription_price_change_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL
    REFERENCES public.subscription_price_change_batches(id) ON DELETE CASCADE,
  organization_id uuid
    REFERENCES public.organizations(id) ON DELETE SET NULL,
  subscription_id uuid
    REFERENCES public.organization_subscriptions(id) ON DELETE SET NULL,
  preapproval_id text,
  expected_external_reference text,
  item_type text NOT NULL
    CHECK (item_type IN ('active_renewal', 'pending_checkout')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'skipped')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 100),
  compensation_attempts integer NOT NULL DEFAULT 0
    CHECK (compensation_attempts BETWEEN 0 AND 100),
  requires_compensation boolean NOT NULL DEFAULT false,
  provider_mutation_started_at timestamptz,
  provider_mutation_kind text
    CHECK (provider_mutation_kind IS NULL OR provider_mutation_kind IN ('set_amount', 'cancel')),
  provider_mutation_subscription_id uuid,
  provider_mutation_subscription_updated_at timestamptz,
  idempotency_key uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  last_http_status integer,
  error_code text,
  error_message text,
  provider_response_ref text,
  next_retry_at timestamptz,
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, subscription_id, item_type),
  CONSTRAINT subscription_price_change_provider_snapshot
    CHECK (
      (provider_mutation_subscription_id IS NULL) =
      (provider_mutation_subscription_updated_at IS NULL)
    ),
  CONSTRAINT subscription_price_change_error_length
    CHECK (error_message IS NULL OR char_length(error_message) <= 500)
);

CREATE INDEX IF NOT EXISTS idx_price_change_items_work_queue
  ON public.subscription_price_change_items (batch_id, status, next_retry_at, created_at);
CREATE INDEX IF NOT EXISTS idx_price_change_items_subscription
  ON public.subscription_price_change_items (subscription_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_price_change_batches_touch
  ON public.subscription_price_change_batches;
CREATE TRIGGER trg_price_change_batches_touch
BEFORE UPDATE ON public.subscription_price_change_batches
FOR EACH ROW EXECUTE FUNCTION public.touch_subscription_updated_at();

DROP TRIGGER IF EXISTS trg_price_change_items_touch
  ON public.subscription_price_change_items;
CREATE TRIGGER trg_price_change_items_touch
BEFORE UPDATE ON public.subscription_price_change_items
FOR EACH ROW EXECUTE FUNCTION public.touch_subscription_updated_at();

ALTER TABLE public.platform_admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_price_change_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_price_change_items ENABLE ROW LEVEL SECURITY;

-- There are intentionally no client policies. These control-plane tables are
-- reachable only by service_role after an Edge Function has authenticated the
-- platform administrator.
REVOKE ALL ON TABLE public.platform_admin_audit_log FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.subscription_price_change_batches FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.subscription_price_change_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.platform_admin_audit_log TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.subscription_price_change_batches TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.subscription_price_change_items TO service_role;

-- Read models keep operational filtering, ordering and pagination inside
-- Postgres. They deliberately expose only the platform DTO allow-list and are
-- unavailable to browser roles. MAU remains joined from Auth Admin in Edge.
CREATE OR REPLACE VIEW public.platform_admin_organizations_v
WITH (security_invoker = true)
AS
WITH profile_counts AS (
  SELECT organization_id, count(*)::integer AS users_count
  FROM public.profiles
  WHERE organization_id IS NOT NULL
  GROUP BY organization_id
), branch_counts AS (
  SELECT organization_id, count(*)::integer AS branches_count
  FROM public.sucursales
  WHERE deleted_at IS NULL
  GROUP BY organization_id
)
SELECT
  organization.id,
  organization.name,
  organization.slug,
  organization.is_active IS DISTINCT FROM false AS is_enabled,
  organization.created_at,
  CASE
    WHEN organization.is_active = false THEN 'inactive'
    WHEN subscription.id IS NULL THEN 'legacy'
    WHEN subscription.status = 'trialing' THEN
      CASE WHEN subscription.trial_ends_at > now() THEN 'trialing' ELSE 'expired' END
    WHEN subscription.status IN ('active', 'cancelled') THEN
      CASE
        WHEN subscription.current_period_end > now() THEN subscription.status
        WHEN subscription.current_period_end IS NULL THEN 'legacy'
        ELSE 'expired'
      END
    ELSE subscription.status
  END AS access_status,
  COALESCE(
    subscription.billing_plan_code,
    subscription.current_plan_code,
    subscription.effective_plan_code
  ) AS plan_code,
  plan.name AS plan_name,
  subscription.trial_ends_at,
  subscription.current_period_end,
  subscription.billing_amount_ars,
  COALESCE(branch_counts.branches_count, 0) AS branches_count,
  COALESCE(profile_counts.users_count, 0) AS users_count,
  COALESCE(subscription.last_payment_at, organization.last_payment_at) AS last_payment_at,
  lower(concat_ws(' ', organization.name, organization.slug)) AS search_text
FROM public.organizations AS organization
LEFT JOIN public.organization_subscriptions AS subscription
  ON subscription.organization_id = organization.id
LEFT JOIN public.subscription_plans AS plan
  ON plan.code = COALESCE(
    subscription.billing_plan_code,
    subscription.current_plan_code,
    subscription.effective_plan_code
  )
LEFT JOIN profile_counts ON profile_counts.organization_id = organization.id
LEFT JOIN branch_counts ON branch_counts.organization_id = organization.id;

CREATE OR REPLACE VIEW public.platform_admin_subscriptions_v
WITH (security_invoker = true)
AS
SELECT
  subscription.id,
  subscription.organization_id,
  organization.name AS organization_name,
  organization.slug AS organization_slug,
  subscription.status AS source_status,
  CASE
    WHEN subscription.status = 'trialing' THEN
      CASE WHEN subscription.trial_ends_at > now() THEN 'trialing' ELSE 'expired' END
    WHEN subscription.status IN ('active', 'cancelled') THEN
      CASE
        WHEN subscription.current_period_end > now() THEN subscription.status
        WHEN subscription.current_period_end IS NULL THEN 'legacy'
        ELSE 'expired'
      END
    ELSE subscription.status
  END AS access_status,
  subscription.provider,
  subscription.effective_plan_code,
  subscription.pending_plan_code,
  subscription.billing_plan_code,
  COALESCE(subscription.billing_plan_code, subscription.effective_plan_code) AS resolved_plan_code,
  subscription.billing_amount_ars,
  subscription.billing_price_version,
  subscription.pending_checkout_amount_ars,
  subscription.pending_checkout_price_version,
  subscription.trial_ends_at,
  subscription.current_period_start,
  subscription.current_period_end,
  subscription.next_payment_date,
  subscription.cancel_at_period_end,
  subscription.mercadopago_status,
  NULLIF(subscription.mercadopago_preapproval_id, '') IS NOT NULL AS has_preapproval,
  subscription.updated_at,
  lower(organization.name) AS search_text
FROM public.organization_subscriptions AS subscription
JOIN public.organizations AS organization
  ON organization.id = subscription.organization_id;

CREATE OR REPLACE VIEW public.platform_admin_payments_v
WITH (security_invoker = true)
AS
SELECT
  payment.id,
  payment.organization_id,
  organization.name AS organization_name,
  payment.subscription_id,
  COALESCE(payment.plan_code, payment.billing_plan_code) AS plan_code,
  payment.amount_ars,
  payment.currency_id,
  payment.status,
  payment.provider,
  payment.mercadopago_payment_id,
  payment.mercadopago_authorized_payment_id,
  payment.period_start,
  payment.period_end,
  payment.due_at,
  payment.paid_at,
  payment.created_at,
  COALESCE(payment.paid_at, payment.created_at) AS effective_at,
  lower(concat_ws(
    ' ',
    organization.name,
    payment.mercadopago_payment_id,
    payment.mercadopago_authorized_payment_id
  )) AS search_text
FROM public.subscription_payments AS payment
JOIN public.organizations AS organization
  ON organization.id = payment.organization_id;

CREATE OR REPLACE VIEW public.platform_admin_audit_v
WITH (security_invoker = true)
AS
SELECT
  audit.id,
  audit.actor_user_id,
  audit.actor_alias,
  audit.action,
  audit.target_type,
  audit.target_id,
  audit.reason,
  audit.previous_state,
  audit.next_state,
  audit.result_status,
  CASE
    WHEN audit.result_status = 'succeeded' THEN 'success'
    WHEN audit.result_status = 'failed' THEN 'failure'
    ELSE 'partial'
  END AS result,
  audit.request_id,
  audit.created_at,
  lower(concat_ws(
    ' ',
    audit.actor_alias,
    audit.action,
    audit.target_type,
    audit.target_id,
    audit.reason,
    audit.request_id::text
  )) AS search_text
FROM public.platform_admin_audit_log AS audit;

CREATE OR REPLACE VIEW public.platform_admin_price_change_batches_v
WITH (security_invoker = true)
AS
SELECT
  batch.*,
  COALESCE(item_counts.pending_count, 0) AS pending_count,
  COALESCE(item_counts.processing_count, 0) AS processing_count,
  COALESCE(item_counts.retryable_count, 0) AS retryable_count
FROM public.subscription_price_change_batches AS batch
LEFT JOIN LATERAL (
  SELECT
    count(*) FILTER (WHERE item.status = 'pending')::integer AS pending_count,
    count(*) FILTER (WHERE item.status = 'processing')::integer AS processing_count,
    count(*) FILTER (
      WHERE item.status = 'failed'
         OR (item.status = 'skipped' AND item.error_code = 'missing_preapproval')
    )::integer AS retryable_count
  FROM public.subscription_price_change_items AS item
  WHERE item.batch_id = batch.id
) AS item_counts ON true;

CREATE OR REPLACE VIEW public.platform_admin_price_change_items_v
WITH (security_invoker = true)
AS
SELECT
  item.id,
  item.batch_id,
  item.organization_id,
  COALESCE(organization.name, 'Organizacion eliminada') AS organization_name,
  item.subscription_id,
  item.preapproval_id,
  item.item_type,
  item.status,
  item.attempts,
  item.last_http_status,
  item.error_code,
  item.error_message,
  item.claimed_at,
  item.completed_at,
  item.updated_at
FROM public.subscription_price_change_items AS item
LEFT JOIN public.organizations AS organization
  ON organization.id = item.organization_id;

CREATE OR REPLACE VIEW public.platform_admin_price_impact_v
WITH (security_invoker = true)
AS
WITH subscription_intents AS (
  SELECT
    subscription.*,
    (
      NULLIF(subscription.metadata->>'pending_mercadopago_preapproval_id', '') IS NOT NULL
      OR (
        subscription.mercadopago_status = 'pending'
        AND NULLIF(subscription.mercadopago_preapproval_id, '') IS NOT NULL
      )
      OR subscription.pending_checkout_amount_ars IS NOT NULL
      OR subscription.pending_checkout_price_version IS NOT NULL
    ) AS has_pending_checkout
  FROM public.organization_subscriptions AS subscription
), candidates AS (
  SELECT
    COALESCE(
      CASE WHEN NOT subscription.has_pending_checkout THEN subscription.pending_plan_code END,
      subscription.billing_plan_code,
      subscription.current_plan_code,
      subscription.effective_plan_code
    ) AS plan_code,
    'active_renewal'::text AS item_type,
    CASE
      WHEN subscription.provider <> 'mercadopago' THEN 'Proveedor no compatible'
      WHEN NULLIF(subscription.mercadopago_preapproval_id, '') IS NULL THEN 'Falta preapproval activo'
      ELSE NULL
    END AS exclusion_reason
  FROM subscription_intents AS subscription
  WHERE subscription.status = 'active'

  UNION ALL

  SELECT
    subscription.pending_plan_code AS plan_code,
    'pending_checkout'::text AS item_type,
    CASE
      WHEN subscription.provider <> 'mercadopago' THEN 'Checkout con proveedor no compatible'
      WHEN COALESCE(
        NULLIF(subscription.metadata->>'pending_mercadopago_preapproval_id', ''),
        CASE WHEN subscription.mercadopago_status = 'pending'
          THEN NULLIF(subscription.mercadopago_preapproval_id, '')
        END
      ) IS NULL THEN 'Falta preapproval pendiente'
      ELSE NULL
    END AS exclusion_reason
  FROM subscription_intents AS subscription
  WHERE subscription.pending_plan_code IS NOT NULL
    AND subscription.has_pending_checkout
), grouped AS (
  SELECT plan_code, item_type, exclusion_reason, count(*)::integer AS item_count
  FROM candidates
  WHERE plan_code IS NOT NULL
  GROUP BY plan_code, item_type, exclusion_reason
)
SELECT
  plan_code,
  COALESCE(sum(item_count) FILTER (
    WHERE item_type = 'active_renewal' AND exclusion_reason IS NULL
  ), 0)::integer AS eligible_active_renewals,
  COALESCE(sum(item_count) FILTER (
    WHERE item_type = 'pending_checkout' AND exclusion_reason IS NULL
  ), 0)::integer AS pending_checkouts,
  COALESCE(sum(item_count) FILTER (WHERE exclusion_reason IS NOT NULL), 0)::integer AS excluded,
  COALESCE(
    jsonb_object_agg(exclusion_reason, item_count) FILTER (WHERE exclusion_reason IS NOT NULL),
    '{}'::jsonb
  ) AS exclusions
FROM grouped
GROUP BY plan_code;

CREATE OR REPLACE VIEW public.platform_admin_overview_v
WITH (security_invoker = true)
AS
WITH organization_breakdown AS (
  SELECT access_status AS key, count(*)::integer AS value
  FROM public.platform_admin_organizations_v
  GROUP BY access_status
), subscription_breakdown AS (
  SELECT access_status AS key, count(*)::integer AS value
  FROM public.platform_admin_subscriptions_v
  GROUP BY access_status
), payment_breakdown AS (
  SELECT status AS key, count(*)::integer AS value
  FROM public.platform_admin_payments_v
  WHERE effective_at >= now() - interval '30 days'
  GROUP BY status
), price_breakdown AS (
  SELECT status AS key, count(*)::integer AS value
  FROM public.subscription_price_change_batches
  GROUP BY status
)
SELECT
  (
    SELECT count(*)::integer
    FROM public.platform_admin_organizations_v
    WHERE is_enabled
      AND access_status IN ('trialing', 'active', 'cancelled')
  ) AS barberias_acceso,
  (
    SELECT count(*)::integer
    FROM public.platform_admin_payments_v
    WHERE status = 'approved'
      AND paid_at >= now() - interval '30 days'
  ) AS approved_payments_count,
  COALESCE((
    SELECT sum(amount_ars)
    FROM public.platform_admin_payments_v
    WHERE status = 'approved'
      AND paid_at >= now() - interval '30 days'
  ), 0) AS approved_payments_amount_ars,
  (
    SELECT count(*)
    FROM public.platform_admin_subscriptions_v
    WHERE access_status IN ('past_due', 'expired')
       OR (access_status = 'legacy' AND source_status IN ('active', 'cancelled'))
  ) + (
    SELECT count(*)
    FROM public.subscription_price_change_items
    WHERE status = 'failed'
  ) + (
    SELECT count(*)
    FROM public.platform_admin_payments_v
    WHERE status IN ('rejected', 'cancelled', 'refunded', 'charged_back')
      AND created_at >= now() - interval '30 days'
  ) + (
    SELECT count(*)
    FROM public.mercadopago_subscription_events
    WHERE processed_at IS NULL
      AND created_at <= now() - interval '5 minutes'
  ) + (
    SELECT count(*)
    FROM public.platform_admin_audit_log
    WHERE action IN (
      'subscription_price_change.invalidated_checkout_payment',
      'subscription_price_change.previous_amount_payment',
      'subscription.stale_preapproval_payment'
    )
      AND result_status IN ('partial', 'failed')
      AND created_at >= now() - interval '30 days'
  ) AS incidencias,
  COALESCE((SELECT jsonb_object_agg(key, value) FROM organization_breakdown), '{}'::jsonb)
    AS organizations_breakdown,
  COALESCE((SELECT jsonb_object_agg(key, value) FROM subscription_breakdown), '{}'::jsonb)
    AS subscriptions_breakdown,
  COALESCE((SELECT jsonb_object_agg(key, value) FROM payment_breakdown), '{}'::jsonb)
    AS payments_30_breakdown,
  COALESCE((SELECT jsonb_object_agg(key, value) FROM price_breakdown), '{}'::jsonb)
    AS price_changes_breakdown;

REVOKE ALL ON TABLE public.platform_admin_organizations_v FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.platform_admin_subscriptions_v FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.platform_admin_payments_v FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.platform_admin_audit_v FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.platform_admin_overview_v FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.platform_admin_price_change_batches_v FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.platform_admin_price_change_items_v FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.platform_admin_price_impact_v FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.platform_admin_organizations_v TO service_role;
GRANT SELECT ON TABLE public.platform_admin_subscriptions_v TO service_role;
GRANT SELECT ON TABLE public.platform_admin_payments_v TO service_role;
GRANT SELECT ON TABLE public.platform_admin_audit_v TO service_role;
GRANT SELECT ON TABLE public.platform_admin_overview_v TO service_role;
GRANT SELECT ON TABLE public.platform_admin_price_change_batches_v TO service_role;
GRANT SELECT ON TABLE public.platform_admin_price_change_items_v TO service_role;
GRANT SELECT ON TABLE public.platform_admin_price_impact_v TO service_role;

CREATE INDEX IF NOT EXISTS idx_profiles_platform_admin_organization
  ON public.profiles (organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_subscription_payments_paid_at
  ON public.subscription_payments (paid_at DESC) WHERE paid_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mp_subscription_events_unprocessed
  ON public.mercadopago_subscription_events (created_at)
  WHERE processed_at IS NULL;

-- Transactionally updates the catalog and materializes an immutable work list.
-- SECURITY INVOKER is deliberate: only service_role has table privileges/RLS
-- bypass and EXECUTE permission.
CREATE OR REPLACE FUNCTION public.platform_admin_create_price_change_batch(
  _plan_code text,
  _new_amount_ars numeric,
  _expected_amount_ars numeric,
  _expected_price_version integer,
  _expected_updated_at timestamptz,
  _actor_user_id uuid,
  _reason text,
  _request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  _plan public.subscription_plans%ROWTYPE;
  _batch public.subscription_price_change_batches%ROWTYPE;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'PLATFORM_ADMIN_SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;

  IF _new_amount_ars IS NULL OR _new_amount_ars <= 0 THEN
    RAISE EXCEPTION 'INVALID_PRICE' USING ERRCODE = '22023';
  END IF;

  IF char_length(btrim(COALESCE(_reason, ''))) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'INVALID_REASON' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _plan
  FROM public.subscription_plans
  WHERE code = _plan_code
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PLAN_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF _plan.amount_ars IS DISTINCT FROM _expected_amount_ars
    OR _plan.price_version IS DISTINCT FROM _expected_price_version
    OR _plan.updated_at IS DISTINCT FROM _expected_updated_at THEN
    RAISE EXCEPTION 'CATALOG_CONFLICT' USING ERRCODE = '40001';
  END IF;

  IF _plan.amount_ars = _new_amount_ars THEN
    RAISE EXCEPTION 'PRICE_UNCHANGED' USING ERRCODE = '22023';
  END IF;

  -- Freeze every subscription snapshot that can contribute work to this
  -- batch. In particular, an authorized-payment webhook cannot promote a
  -- pending checkout between materialization and invalidation: it either
  -- commits before these locks (and is classified as an active renewal) or
  -- loses its updated_at CAS after the pending intent is invalidated below.
  PERFORM subscription.id
  FROM public.organization_subscriptions AS subscription
  WHERE (
    subscription.status = 'active'
    AND COALESCE(
      CASE
        WHEN subscription.pending_plan_code IS NOT NULL
          AND NULLIF(subscription.metadata->>'pending_mercadopago_preapproval_id', '') IS NULL
          AND subscription.mercadopago_status IS DISTINCT FROM 'pending'
          AND subscription.pending_checkout_amount_ars IS NULL
          AND subscription.pending_checkout_price_version IS NULL
        THEN subscription.pending_plan_code
      END,
      subscription.billing_plan_code,
      subscription.current_plan_code,
      subscription.effective_plan_code
    ) = _plan.code
  ) OR subscription.pending_plan_code = _plan.code
  FOR UPDATE;

  INSERT INTO public.subscription_price_change_batches (
    plan_code,
    old_amount_ars,
    new_amount_ars,
    old_price_version,
    new_price_version,
    expected_updated_at,
    actor_user_id,
    actor_alias,
    reason,
    request_id
  ) VALUES (
    _plan.code,
    _plan.amount_ars,
    _new_amount_ars,
    _plan.price_version,
    _plan.price_version + 1,
    _plan.updated_at,
    _actor_user_id,
    CASE WHEN _actor_user_id IS NULL THEN 'deployment' ELSE 'admin' END,
    btrim(_reason),
    _request_id
  )
  RETURNING * INTO _batch;

  UPDATE public.subscription_plans
  SET
    amount_ars = _new_amount_ars,
    price_version = _plan.price_version + 1
  WHERE code = _plan.code;

  INSERT INTO public.subscription_price_change_items (
    batch_id,
    organization_id,
    subscription_id,
    preapproval_id,
    expected_external_reference,
    item_type,
    status,
    error_code,
    error_message,
    completed_at
  )
  SELECT
    _batch.id,
    subscription.organization_id,
    subscription.id,
    NULLIF(subscription.mercadopago_preapproval_id, ''),
    NULLIF(subscription.mercadopago_external_reference, ''),
    'active_renewal',
    CASE
      WHEN subscription.provider <> 'mercadopago' THEN 'skipped'
      WHEN NULLIF(subscription.mercadopago_preapproval_id, '') IS NULL THEN 'skipped'
      ELSE 'pending'
    END,
    CASE
      WHEN subscription.provider <> 'mercadopago' THEN 'provider_not_supported'
      WHEN NULLIF(subscription.mercadopago_preapproval_id, '') IS NULL THEN 'missing_preapproval'
      ELSE NULL
    END,
    CASE
      WHEN subscription.provider <> 'mercadopago' THEN 'La suscripcion no usa Mercado Pago.'
      WHEN NULLIF(subscription.mercadopago_preapproval_id, '') IS NULL THEN 'Falta la referencia de preapproval.'
      ELSE NULL
    END,
    CASE
      WHEN subscription.provider <> 'mercadopago'
        OR NULLIF(subscription.mercadopago_preapproval_id, '') IS NULL
      THEN now()
      ELSE NULL
    END
  FROM public.organization_subscriptions AS subscription
  WHERE subscription.status = 'active'
    AND COALESCE(
      CASE
        WHEN subscription.pending_plan_code IS NOT NULL
          AND NULLIF(subscription.metadata->>'pending_mercadopago_preapproval_id', '') IS NULL
          AND subscription.mercadopago_status IS DISTINCT FROM 'pending'
          AND subscription.pending_checkout_amount_ars IS NULL
          AND subscription.pending_checkout_price_version IS NULL
        THEN subscription.pending_plan_code
      END,
      subscription.billing_plan_code,
      subscription.current_plan_code,
      subscription.effective_plan_code
    ) = _plan.code;

  INSERT INTO public.subscription_price_change_items (
    batch_id,
    organization_id,
    subscription_id,
    preapproval_id,
    expected_external_reference,
    item_type,
    status,
    error_code,
    error_message,
    completed_at
  )
  SELECT
    _batch.id,
    subscription.organization_id,
    subscription.id,
    pending_checkout.preapproval_id,
    pending_checkout.external_reference,
    'pending_checkout',
    CASE
      WHEN subscription.provider <> 'mercadopago' THEN 'skipped'
      WHEN pending_checkout.preapproval_id IS NULL THEN 'skipped'
      ELSE 'pending'
    END,
    CASE
      WHEN subscription.provider <> 'mercadopago' THEN 'provider_not_supported'
      WHEN pending_checkout.preapproval_id IS NULL THEN 'missing_preapproval'
      ELSE NULL
    END,
    CASE
      WHEN subscription.provider <> 'mercadopago' THEN 'El checkout pendiente no usa Mercado Pago.'
      WHEN pending_checkout.preapproval_id IS NULL THEN 'Falta la referencia del checkout pendiente.'
      ELSE NULL
    END,
    CASE
      WHEN subscription.provider <> 'mercadopago'
        OR pending_checkout.preapproval_id IS NULL
      THEN now()
      ELSE NULL
    END
  FROM public.organization_subscriptions AS subscription
  CROSS JOIN LATERAL (
    SELECT
      COALESCE(
        NULLIF(subscription.metadata->>'pending_mercadopago_preapproval_id', ''),
        CASE WHEN subscription.mercadopago_status = 'pending'
          THEN NULLIF(subscription.mercadopago_preapproval_id, '')
        END
      ) AS preapproval_id,
      COALESCE(
        NULLIF(subscription.metadata->>'pending_mercadopago_external_reference', ''),
        CASE WHEN subscription.mercadopago_status = 'pending'
          THEN NULLIF(subscription.mercadopago_external_reference, '')
        END
      ) AS external_reference
  ) AS pending_checkout
  WHERE subscription.pending_plan_code = _plan.code
    AND (
      pending_checkout.preapproval_id IS NOT NULL
      OR subscription.pending_checkout_amount_ars IS NOT NULL
      OR subscription.pending_checkout_price_version IS NOT NULL
    );

  -- Pending checkout links cannot be updated atomically with Mercado Pago.
  -- Invalidate their local reuse contract in the same transaction as the
  -- catalog change, while the immutable queue item keeps the provider ID and
  -- reference required to cancel that old link asynchronously.
  UPDATE public.organization_subscriptions AS subscription
  SET
    pending_plan_code = NULL,
    pending_checkout_amount_ars = NULL,
    pending_checkout_price_version = NULL,
    mercadopago_preapproval_id = CASE
      WHEN NULLIF(subscription.mercadopago_preapproval_id, '') = item.preapproval_id
        AND subscription.mercadopago_status = 'pending'
      THEN NULL
      ELSE subscription.mercadopago_preapproval_id
    END,
    mercadopago_external_reference = CASE
      WHEN NULLIF(subscription.mercadopago_preapproval_id, '') = item.preapproval_id
        AND subscription.mercadopago_status = 'pending'
      THEN NULL
      ELSE subscription.mercadopago_external_reference
    END,
    mercadopago_status = CASE
      WHEN NULLIF(subscription.mercadopago_preapproval_id, '') = item.preapproval_id
        AND subscription.mercadopago_status = 'pending'
      THEN NULL
      ELSE subscription.mercadopago_status
    END,
    mercadopago_init_point = NULL,
    metadata = COALESCE(subscription.metadata, '{}'::jsonb) - ARRAY[
      'checkout_requested_at',
      'checkout_requested_by',
      'pending_mercadopago_preapproval_id',
      'pending_mercadopago_external_reference',
      'pending_checkout_amount_ars',
      'pending_checkout_price_version',
      'previous_mercadopago_preapproval_id',
      'previous_mercadopago_external_reference'
    ]
  FROM public.subscription_price_change_items AS item
  WHERE item.batch_id = _batch.id
    AND item.item_type = 'pending_checkout'
    AND item.subscription_id = subscription.id
    AND subscription.pending_plan_code = _plan.code
    AND COALESCE(
      NULLIF(subscription.metadata->>'pending_mercadopago_preapproval_id', ''),
      CASE WHEN subscription.mercadopago_status = 'pending'
        THEN NULLIF(subscription.mercadopago_preapproval_id, '')
      END
    ) IS NOT DISTINCT FROM item.preapproval_id;

  INSERT INTO public.platform_admin_audit_log (
    actor_user_id,
    actor_alias,
    action,
    target_type,
    target_id,
    reason,
    previous_state,
    next_state,
    result_status,
    request_id
  ) VALUES (
    _actor_user_id,
    CASE WHEN _actor_user_id IS NULL THEN 'deployment' ELSE 'admin' END,
    'subscription_price_change.created',
    'subscription_plan',
    _plan.code,
    btrim(_reason),
    jsonb_build_object(
      'amountArs', _plan.amount_ars,
      'priceVersion', _plan.price_version,
      'updatedAt', _plan.updated_at
    ),
    jsonb_build_object(
      'amountArs', _new_amount_ars,
      'priceVersion', _plan.price_version + 1,
      'batchId', _batch.id
    ),
    'pending',
    _request_id
  );

  SELECT * INTO _batch
  FROM public.subscription_price_change_batches
  WHERE id = _batch.id;

  RETURN to_jsonb(_batch);
END;
$function$;

-- Atomically claims no more than the requested bounded work set. Rows left in
-- processing by an interrupted worker become claimable after 15 minutes.
CREATE OR REPLACE FUNCTION public.platform_admin_claim_price_change_items(
  _batch_id uuid,
  _limit integer DEFAULT 20
)
RETURNS SETOF public.subscription_price_change_items
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'PLATFORM_ADMIN_SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;

  UPDATE public.subscription_price_change_items AS item
  SET
    status = 'skipped',
    error_code = 'subscription_removed',
    error_message = 'La suscripcion fue eliminada antes del procesamiento.',
    claimed_at = NULL,
    next_retry_at = NULL,
    completed_at = now()
  WHERE item.batch_id = _batch_id
    AND item.item_type = 'active_renewal'
    AND NOT item.requires_compensation
    AND item.provider_mutation_started_at IS NULL
    AND (
      item.status = 'pending'
      OR (item.status = 'processing' AND item.claimed_at < now() - interval '15 minutes')
    )
    AND (
      item.subscription_id IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM public.organization_subscriptions AS subscription
        WHERE subscription.id = item.subscription_id
      )
    );

  -- A subscription can change plan or checkout while a batch is waiting. Do
  -- not let a stale work item mutate the replacement preapproval.
  UPDATE public.subscription_price_change_items AS item
  SET
    status = 'skipped',
    error_code = 'subscription_changed',
    error_message = 'La suscripcion o su preapproval cambiaron antes del procesamiento.',
    claimed_at = NULL,
    next_retry_at = NULL,
    completed_at = now()
  FROM public.organization_subscriptions AS subscription,
       public.subscription_price_change_batches AS batch
  WHERE item.batch_id = _batch_id
    AND batch.id = item.batch_id
    AND subscription.id = item.subscription_id
    AND item.item_type = 'active_renewal'
    AND NOT item.requires_compensation
    AND item.provider_mutation_started_at IS NULL
    AND (
      item.status = 'pending'
      OR (item.status = 'processing' AND item.claimed_at < now() - interval '15 minutes')
    )
    AND NOT (
      subscription.provider = 'mercadopago'
      AND (
        (
          item.item_type = 'active_renewal'
          AND subscription.status = 'active'
          AND COALESCE(
            CASE
              WHEN subscription.pending_plan_code IS NOT NULL
                AND NULLIF(subscription.metadata->>'pending_mercadopago_preapproval_id', '') IS NULL
                AND subscription.mercadopago_status IS DISTINCT FROM 'pending'
                AND subscription.pending_checkout_amount_ars IS NULL
                AND subscription.pending_checkout_price_version IS NULL
              THEN subscription.pending_plan_code
            END,
            subscription.billing_plan_code,
            subscription.current_plan_code,
            subscription.effective_plan_code
          ) = batch.plan_code
          AND NULLIF(subscription.mercadopago_preapproval_id, '') = item.preapproval_id
        )
        OR (
          item.item_type = 'pending_checkout'
          AND subscription.pending_plan_code = batch.plan_code
          AND COALESCE(
            NULLIF(subscription.metadata->>'pending_mercadopago_preapproval_id', ''),
            CASE WHEN subscription.mercadopago_status = 'pending'
              THEN NULLIF(subscription.mercadopago_preapproval_id, '')
            END
          ) = item.preapproval_id
        )
      )
    );

  IF _limit IS NULL OR _limit < 1 OR _limit > 20 THEN
    RAISE EXCEPTION 'INVALID_BATCH_LIMIT' USING ERRCODE = '22023';
  END IF;

  UPDATE public.subscription_price_change_batches
  SET status = 'processing', started_at = COALESCE(started_at, now())
  WHERE id = _batch_id
    AND status IN ('pending', 'processing', 'partially_completed', 'failed');

  RETURN QUERY
  WITH candidates AS (
    SELECT item.id
    FROM public.subscription_price_change_items AS item
    WHERE item.batch_id = _batch_id
      AND (
        (item.requires_compensation AND item.compensation_attempts < 3)
        OR (NOT item.requires_compensation AND item.attempts < 3)
      )
      AND (
        (item.status = 'pending' AND (item.next_retry_at IS NULL OR item.next_retry_at <= now()))
        OR (item.status = 'processing' AND item.claimed_at < now() - interval '15 minutes')
      )
    ORDER BY item.created_at, item.id
    FOR UPDATE SKIP LOCKED
    LIMIT _limit
  )
  UPDATE public.subscription_price_change_items AS item
  SET
    status = 'processing',
    claimed_at = now(),
    next_retry_at = NULL
  FROM candidates
  WHERE item.id = candidates.id
  RETURNING item.*;
END;
$function$;

CREATE OR REPLACE FUNCTION public.platform_admin_retry_price_change_items(
  _batch_id uuid,
  _item_ids uuid[] DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  _updated integer;
  _step integer;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'PLATFORM_ADMIN_SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;

  UPDATE public.subscription_price_change_items AS item
  SET
    status = 'skipped',
    error_code = 'subscription_removed',
    error_message = 'La suscripcion fue eliminada antes del reintento.',
    next_retry_at = NULL,
    claimed_at = NULL,
    completed_at = now()
  WHERE item.batch_id = _batch_id
    AND item.item_type = 'active_renewal'
    AND NOT item.requires_compensation
    AND item.provider_mutation_started_at IS NULL
    AND (
      item.status = 'failed'
      OR (item.status = 'skipped' AND item.error_code = 'missing_preapproval')
      OR (item.status = 'processing' AND item.claimed_at < now() - interval '5 minutes')
    )
    AND (_item_ids IS NULL OR item.id = ANY(_item_ids))
    AND (
      item.subscription_id IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM public.organization_subscriptions AS subscription
        WHERE subscription.id = item.subscription_id
      )
    );

  -- A different plan is a terminal exclusion for this immutable batch.
  UPDATE public.subscription_price_change_items AS item
  SET
    status = 'skipped',
    error_code = 'subscription_changed',
    error_message = 'La suscripcion cambio de plan antes del reintento.',
    next_retry_at = NULL,
    claimed_at = NULL,
    completed_at = now()
  FROM public.organization_subscriptions AS subscription,
       public.subscription_price_change_batches AS batch
  WHERE item.batch_id = _batch_id
    AND batch.id = item.batch_id
    AND item.subscription_id = subscription.id
    AND item.item_type = 'active_renewal'
    AND NOT item.requires_compensation
    AND item.provider_mutation_started_at IS NULL
    AND (
      item.status = 'failed'
      OR (item.status = 'skipped' AND item.error_code = 'missing_preapproval')
      OR (item.status = 'processing' AND item.claimed_at < now() - interval '5 minutes')
    )
    AND (_item_ids IS NULL OR item.id = ANY(_item_ids))
    AND NOT (
      subscription.provider = 'mercadopago'
      AND (
        (
          item.item_type = 'active_renewal'
          AND subscription.status = 'active'
          AND COALESCE(
            CASE
              WHEN subscription.pending_plan_code IS NOT NULL
                AND NULLIF(subscription.metadata->>'pending_mercadopago_preapproval_id', '') IS NULL
                AND subscription.mercadopago_status IS DISTINCT FROM 'pending'
                AND subscription.pending_checkout_amount_ars IS NULL
                AND subscription.pending_checkout_price_version IS NULL
              THEN subscription.pending_plan_code
            END,
            subscription.billing_plan_code,
            subscription.current_plan_code,
            subscription.effective_plan_code
          ) = batch.plan_code
        )
        OR (
          item.item_type = 'pending_checkout'
          AND subscription.pending_plan_code = batch.plan_code
        )
      )
    );

  -- A frozen pending-checkout cancellation or any row whose provider mutation
  -- may already have started must retain its original preapproval. Retargeting
  -- it could hide an orphan that still charges at the wrong amount.
  UPDATE public.subscription_price_change_items AS item
  SET
    status = 'pending',
    attempts = CASE WHEN item.requires_compensation THEN item.attempts ELSE 0 END,
    compensation_attempts = 0,
    last_http_status = NULL,
    error_code = CASE
      WHEN item.requires_compensation THEN 'provider_compensation_required'
      ELSE NULL
    END,
    error_message = CASE
      WHEN item.requires_compensation
      THEN 'Mercado Pago debe reconciliarse con la intencion local vigente.'
      ELSE NULL
    END,
    provider_response_ref = NULL,
    next_retry_at = NULL,
    claimed_at = NULL,
    completed_at = NULL
  WHERE item.batch_id = _batch_id
    AND (
      item.status = 'failed'
      OR (item.status = 'processing' AND item.claimed_at < now() - interval '5 minutes')
    )
    AND (_item_ids IS NULL OR item.id = ANY(_item_ids))
    AND (
      item.item_type = 'pending_checkout'
      OR item.requires_compensation
      OR item.provider_mutation_started_at IS NOT NULL
    );

  GET DIAGNOSTICS _updated = ROW_COUNT;

  -- Reopen only a target that still belongs to the same plan. If a checkout
  -- was safely recreated for that plan, rotate the provider idempotency key.
  UPDATE public.subscription_price_change_items AS item
  SET
    preapproval_id = CASE item.item_type
      WHEN 'active_renewal' THEN NULLIF(subscription.mercadopago_preapproval_id, '')
      ELSE COALESCE(
        NULLIF(subscription.metadata->>'pending_mercadopago_preapproval_id', ''),
        CASE WHEN subscription.mercadopago_status = 'pending'
          THEN NULLIF(subscription.mercadopago_preapproval_id, '')
        END
      )
    END,
    expected_external_reference = NULLIF(subscription.mercadopago_external_reference, ''),
    idempotency_key = CASE
      WHEN item.preapproval_id IS DISTINCT FROM CASE item.item_type
        WHEN 'active_renewal' THEN NULLIF(subscription.mercadopago_preapproval_id, '')
        ELSE COALESCE(
          NULLIF(subscription.metadata->>'pending_mercadopago_preapproval_id', ''),
          CASE WHEN subscription.mercadopago_status = 'pending'
            THEN NULLIF(subscription.mercadopago_preapproval_id, '')
          END
        )
      END
      THEN gen_random_uuid()
      ELSE item.idempotency_key
    END,
    status = 'pending',
    attempts = 0,
    last_http_status = NULL,
    error_code = NULL,
    error_message = NULL,
    provider_response_ref = NULL,
    next_retry_at = NULL,
    claimed_at = NULL,
    completed_at = NULL
  FROM public.organization_subscriptions AS subscription,
       public.subscription_price_change_batches AS batch
  WHERE item.batch_id = _batch_id
    AND batch.id = item.batch_id
    AND item.subscription_id = subscription.id
    AND (
      item.status = 'failed'
      OR (item.status = 'skipped' AND item.error_code = 'missing_preapproval')
      OR (item.status = 'processing' AND item.claimed_at < now() - interval '5 minutes')
    )
    AND (_item_ids IS NULL OR item.id = ANY(_item_ids))
    AND item.item_type = 'active_renewal'
    AND NOT item.requires_compensation
    AND item.provider_mutation_started_at IS NULL
    AND subscription.provider = 'mercadopago'
    AND (
      (
        item.item_type = 'active_renewal'
        AND subscription.status = 'active'
        AND COALESCE(
          CASE
            WHEN subscription.pending_plan_code IS NOT NULL
              AND NULLIF(subscription.metadata->>'pending_mercadopago_preapproval_id', '') IS NULL
              AND subscription.mercadopago_status IS DISTINCT FROM 'pending'
              AND subscription.pending_checkout_amount_ars IS NULL
              AND subscription.pending_checkout_price_version IS NULL
            THEN subscription.pending_plan_code
          END,
          subscription.billing_plan_code,
          subscription.current_plan_code,
          subscription.effective_plan_code
        ) = batch.plan_code
        AND NULLIF(subscription.mercadopago_preapproval_id, '') IS NOT NULL
      )
      OR (
        item.item_type = 'pending_checkout'
        AND subscription.pending_plan_code = batch.plan_code
        AND COALESCE(
          NULLIF(subscription.metadata->>'pending_mercadopago_preapproval_id', ''),
          CASE WHEN subscription.mercadopago_status = 'pending'
            THEN NULLIF(subscription.mercadopago_preapproval_id, '')
          END
        ) IS NOT NULL
      )
    );

  GET DIAGNOSTICS _step = ROW_COUNT;
  _updated := _updated + _step;

  IF _updated > 0 THEN
    UPDATE public.subscription_price_change_batches
    SET status = 'processing', completed_at = NULL
    WHERE id = _batch_id;
  END IF;

  RETURN _updated;
END;
$function$;

CREATE OR REPLACE FUNCTION public.platform_admin_refresh_price_change_batch(
  _batch_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  _total integer;
  _pending integer;
  _processing integer;
  _succeeded integer;
  _failed integer;
  _skipped integer;
  _next_status text;
  _batch public.subscription_price_change_batches%ROWTYPE;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'PLATFORM_ADMIN_SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE status = 'pending')::integer,
    count(*) FILTER (WHERE status = 'processing')::integer,
    count(*) FILTER (WHERE status = 'succeeded')::integer,
    count(*) FILTER (WHERE status = 'failed')::integer,
    count(*) FILTER (WHERE status = 'skipped')::integer
  INTO _total, _pending, _processing, _succeeded, _failed, _skipped
  FROM public.subscription_price_change_items
  WHERE batch_id = _batch_id;

  _next_status := CASE
    WHEN _pending > 0 OR _processing > 0 THEN 'processing'
    WHEN _failed = 0 THEN 'completed'
    WHEN _succeeded > 0 OR _skipped > 0 THEN 'partially_completed'
    ELSE 'failed'
  END;

  UPDATE public.subscription_price_change_batches
  SET
    status = _next_status,
    total_items = _total,
    processed_items = _succeeded + _failed + _skipped,
    succeeded_items = _succeeded,
    failed_items = _failed,
    skipped_items = _skipped,
    completed_at = CASE
      WHEN _pending = 0 AND _processing = 0 THEN COALESCE(completed_at, now())
      ELSE NULL
    END
  WHERE id = _batch_id
  RETURNING * INTO _batch;

  IF _batch.id IS NULL THEN
    RAISE EXCEPTION 'BATCH_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.platform_admin_audit_log
  SET
    result_status = CASE _next_status
      WHEN 'completed' THEN 'succeeded'
      WHEN 'partially_completed' THEN 'partial'
      WHEN 'failed' THEN 'failed'
      ELSE 'pending'
    END,
    result_detail = jsonb_build_object(
      'batchId', _batch.id,
      'total', _total,
      'succeeded', _succeeded,
      'failed', _failed,
      'skipped', _skipped
    )
  WHERE request_id = _batch.request_id
    AND action = 'subscription_price_change.created';

  RETURN to_jsonb(_batch);
END;
$function$;

-- Persists the external side-effect boundary before the worker calls Mercado
-- Pago. A reclaimed processing row with this marker is never safe to retarget
-- or skip without first reconciling the frozen provider ID.
CREATE OR REPLACE FUNCTION public.platform_admin_start_price_change_provider_mutation(
  _item_id uuid,
  _expected_idempotency_key uuid,
  _expected_preapproval_id text,
  _expected_claimed_at timestamptz,
  _mutation_kind text,
  _expected_subscription_id uuid,
  _expected_subscription_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  _item public.subscription_price_change_items%ROWTYPE;
  _subscription public.organization_subscriptions%ROWTYPE;
  _subscription_found boolean;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'PLATFORM_ADMIN_SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;

  IF _mutation_kind IS NULL OR _mutation_kind NOT IN ('set_amount', 'cancel') THEN
    RAISE EXCEPTION 'INVALID_PROVIDER_MUTATION_KIND' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _item
  FROM public.subscription_price_change_items
  WHERE id = _item_id
  FOR UPDATE;

  IF NOT FOUND
    OR _item.status <> 'processing'
    OR _item.idempotency_key IS DISTINCT FROM _expected_idempotency_key
    OR _item.preapproval_id IS DISTINCT FROM _expected_preapproval_id
    OR _item.claimed_at IS DISTINCT FROM _expected_claimed_at THEN
    RAISE EXCEPTION 'ITEM_CLAIM_LOST' USING ERRCODE = '40001';
  END IF;

  IF _item.provider_mutation_kind IS NOT NULL
    AND _item.provider_mutation_kind IS DISTINCT FROM _mutation_kind THEN
    RAISE EXCEPTION 'PROVIDER_MUTATION_KIND_CHANGED' USING ERRCODE = '40001';
  END IF;

  SELECT * INTO _subscription
  FROM public.organization_subscriptions
  WHERE organization_id = _item.organization_id
  FOR UPDATE;
  _subscription_found := FOUND;

  IF _expected_subscription_id IS NULL THEN
    IF _subscription_found OR _expected_subscription_updated_at IS NOT NULL THEN
      RAISE EXCEPTION 'SUBSCRIPTION_CONFLICT' USING ERRCODE = '40001';
    END IF;
  ELSIF NOT _subscription_found
    OR _expected_subscription_updated_at IS NULL
    OR _subscription.id IS DISTINCT FROM _expected_subscription_id
    OR _subscription.updated_at IS DISTINCT FROM _expected_subscription_updated_at THEN
    RAISE EXCEPTION 'SUBSCRIPTION_CONFLICT' USING ERRCODE = '40001';
  END IF;

  IF _item.provider_mutation_started_at IS NOT NULL AND (
    _item.provider_mutation_subscription_id IS DISTINCT FROM _expected_subscription_id
    OR _item.provider_mutation_subscription_updated_at IS DISTINCT FROM _expected_subscription_updated_at
  ) THEN
    RAISE EXCEPTION 'SUBSCRIPTION_CONFLICT' USING ERRCODE = '40001';
  END IF;

  UPDATE public.subscription_price_change_items AS item
  SET
    provider_mutation_started_at = COALESCE(item.provider_mutation_started_at, now()),
    provider_mutation_kind = COALESCE(item.provider_mutation_kind, _mutation_kind),
    provider_mutation_subscription_id = COALESCE(
      item.provider_mutation_subscription_id,
      _expected_subscription_id
    ),
    provider_mutation_subscription_updated_at = COALESCE(
      item.provider_mutation_subscription_updated_at,
      _expected_subscription_updated_at
    )
  WHERE item.id = _item_id
    AND item.status = 'processing'
    AND item.idempotency_key = _expected_idempotency_key
    AND item.preapproval_id IS NOT DISTINCT FROM _expected_preapproval_id
    AND item.claimed_at IS NOT DISTINCT FROM _expected_claimed_at
  RETURNING item.* INTO _item;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ITEM_CLAIM_LOST' USING ERRCODE = '40001';
  END IF;

  RETURN to_jsonb(_item);
END;
$function$;

CREATE OR REPLACE FUNCTION public.platform_admin_require_price_change_compensation(
  _item_id uuid,
  _expected_idempotency_key uuid,
  _expected_preapproval_id text,
  _expected_claimed_at timestamptz,
  _reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  _item public.subscription_price_change_items%ROWTYPE;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'PLATFORM_ADMIN_SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;

  UPDATE public.subscription_price_change_items AS item
  SET
    requires_compensation = true,
    error_code = 'provider_compensation_required',
    error_message = left(COALESCE(NULLIF(btrim(_reason), ''),
      'Mercado Pago debe reconciliarse con la intencion local vigente.'), 500),
    next_retry_at = NULL,
    completed_at = NULL
  WHERE item.id = _item_id
    AND item.status = 'processing'
    AND item.idempotency_key = _expected_idempotency_key
    AND item.preapproval_id IS NOT DISTINCT FROM _expected_preapproval_id
    AND item.claimed_at IS NOT DISTINCT FROM _expected_claimed_at
    AND item.provider_mutation_started_at IS NOT NULL
  RETURNING item.* INTO _item;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ITEM_CLAIM_LOST' USING ERRCODE = '40001';
  END IF;

  RETURN to_jsonb(_item);
END;
$function$;

-- Confirms that a compensation PUT/cancel still matches the exact local
-- subscription revision used to derive it. Touching updated_at fences a tenant
-- mutation that started from the same stale revision; its own CAS must then
-- compensate or retry instead of committing divergent provider state.
CREATE OR REPLACE FUNCTION public.platform_admin_complete_price_change_compensation(
  _item_id uuid,
  _expected_idempotency_key uuid,
  _expected_preapproval_id text,
  _expected_claimed_at timestamptz,
  _expected_subscription_id uuid,
  _expected_subscription_updated_at timestamptz,
  _should_cancel boolean,
  _expected_amount_ars numeric,
  _complete_price_change boolean,
  _compensation_attempts integer,
  _http_status integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  _item public.subscription_price_change_items%ROWTYPE;
  _batch public.subscription_price_change_batches%ROWTYPE;
  _subscription public.organization_subscriptions%ROWTYPE;
  _subscription_found boolean;
  _desired_amount numeric;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'PLATFORM_ADMIN_SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;

  IF _should_cancel IS NULL OR _complete_price_change IS NULL THEN
    RAISE EXCEPTION 'INVALID_COMPENSATION_MODE' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _item
  FROM public.subscription_price_change_items
  WHERE id = _item_id
  FOR UPDATE;

  IF NOT FOUND
    OR _item.status <> 'processing'
    OR NOT _item.requires_compensation
    OR _item.idempotency_key IS DISTINCT FROM _expected_idempotency_key
    OR _item.preapproval_id IS DISTINCT FROM _expected_preapproval_id
    OR _item.claimed_at IS DISTINCT FROM _expected_claimed_at THEN
    RAISE EXCEPTION 'ITEM_CLAIM_LOST' USING ERRCODE = '40001';
  END IF;

  SELECT * INTO _batch
  FROM public.subscription_price_change_batches
  WHERE id = _item.batch_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BATCH_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO _subscription
  FROM public.organization_subscriptions
  WHERE organization_id = _item.organization_id
  FOR UPDATE;
  _subscription_found := FOUND;

  IF _expected_subscription_id IS NULL THEN
    IF _subscription_found THEN
      RAISE EXCEPTION 'SUBSCRIPTION_CONFLICT' USING ERRCODE = '40001';
    END IF;
  ELSIF NOT _subscription_found
    OR _subscription.id IS DISTINCT FROM _expected_subscription_id
    OR _subscription.updated_at IS DISTINCT FROM _expected_subscription_updated_at THEN
    RAISE EXCEPTION 'SUBSCRIPTION_CONFLICT' USING ERRCODE = '40001';
  END IF;

  IF _complete_price_change THEN
    IF _should_cancel
      OR NOT _subscription_found
      OR _subscription.status <> 'active'
      OR _subscription.provider <> 'mercadopago'
      OR NULLIF(_subscription.mercadopago_preapproval_id, '') <> _item.preapproval_id
      OR COALESCE(
        CASE
          WHEN _subscription.pending_plan_code IS NOT NULL
            AND NULLIF(_subscription.metadata->>'pending_mercadopago_preapproval_id', '') IS NULL
            AND _subscription.mercadopago_status IS DISTINCT FROM 'pending'
            AND _subscription.pending_checkout_amount_ars IS NULL
            AND _subscription.pending_checkout_price_version IS NULL
          THEN _subscription.pending_plan_code
        END,
        _subscription.billing_plan_code,
        _subscription.current_plan_code,
        _subscription.effective_plan_code
      ) IS DISTINCT FROM _batch.plan_code
      OR _expected_amount_ars IS DISTINCT FROM _batch.new_amount_ars THEN
      RAISE EXCEPTION 'COMPENSATION_INTENT_CHANGED' USING ERRCODE = '40001';
    END IF;

    IF _subscription.pending_plan_code = _batch.plan_code
      AND NULLIF(_subscription.metadata->>'pending_mercadopago_preapproval_id', '') IS NULL
      AND _subscription.mercadopago_status IS DISTINCT FROM 'pending'
      AND _subscription.pending_checkout_amount_ars IS NULL
      AND _subscription.pending_checkout_price_version IS NULL THEN
      UPDATE public.organization_subscriptions
      SET metadata = metadata || jsonb_build_object(
        'scheduled_renewal_amount_ars', _batch.new_amount_ars,
        'scheduled_renewal_price_version', _batch.new_price_version
      )
      WHERE id = _subscription.id;
    ELSE
      UPDATE public.organization_subscriptions
      SET
        billing_amount_ars = _batch.new_amount_ars,
        billing_price_version = _batch.new_price_version
      WHERE id = _subscription.id;
    END IF;
  ELSIF _should_cancel THEN
    IF _subscription_found
      AND _subscription.provider = 'mercadopago'
      AND (
        (
          _subscription.status = 'active'
          AND NULLIF(_subscription.mercadopago_preapproval_id, '') = _item.preapproval_id
        )
        OR NULLIF(_subscription.metadata->>'pending_mercadopago_preapproval_id', '') =
          _item.preapproval_id
        OR (
          _subscription.mercadopago_status = 'pending'
          AND NULLIF(_subscription.mercadopago_preapproval_id, '') = _item.preapproval_id
        )
      ) THEN
      RAISE EXCEPTION 'COMPENSATION_INTENT_CHANGED' USING ERRCODE = '40001';
    END IF;
  ELSE
    IF NOT _subscription_found
      OR _subscription.status <> 'active'
      OR _subscription.provider <> 'mercadopago'
      OR NULLIF(_subscription.mercadopago_preapproval_id, '') <> _item.preapproval_id THEN
      RAISE EXCEPTION 'COMPENSATION_INTENT_CHANGED' USING ERRCODE = '40001';
    END IF;

    _desired_amount := CASE
      WHEN _subscription.pending_plan_code IS NOT NULL
        AND NULLIF(_subscription.metadata->>'pending_mercadopago_preapproval_id', '') IS NULL
        AND _subscription.mercadopago_status IS DISTINCT FROM 'pending'
        AND _subscription.pending_checkout_amount_ars IS NULL
        AND _subscription.pending_checkout_price_version IS NULL
      THEN NULLIF(_subscription.metadata->>'scheduled_renewal_amount_ars', '')::numeric
      ELSE _subscription.billing_amount_ars
    END;

    IF _desired_amount IS NULL
      OR _desired_amount <= 0
      OR _desired_amount IS DISTINCT FROM _expected_amount_ars THEN
      RAISE EXCEPTION 'COMPENSATION_INTENT_CHANGED' USING ERRCODE = '40001';
    END IF;
  END IF;

  IF _subscription_found AND NOT _complete_price_change THEN
    UPDATE public.organization_subscriptions
    SET updated_at = clock_timestamp()
    WHERE id = _subscription.id;
  END IF;

  UPDATE public.subscription_price_change_items
  SET
    status = CASE WHEN _complete_price_change THEN 'succeeded' ELSE 'skipped' END,
    requires_compensation = false,
    compensation_attempts = LEAST(GREATEST(_compensation_attempts, compensation_attempts), 100),
    last_http_status = _http_status,
    error_code = CASE
      WHEN _complete_price_change THEN NULL
      ELSE 'subscription_changed_compensated'
    END,
    error_message = CASE
      WHEN _complete_price_change THEN NULL
      ELSE 'Se reconcilio Mercado Pago con la intencion local vigente.'
    END,
    next_retry_at = NULL,
    completed_at = now()
  WHERE id = _item.id
  RETURNING * INTO _item;

  RETURN to_jsonb(_item);
END;
$function$;

-- Commits the local billing snapshot and the successful queue result together,
-- after Mercado Pago accepted the idempotent PUT.
CREATE OR REPLACE FUNCTION public.platform_admin_complete_price_change_item(
  _item_id uuid,
  _expected_idempotency_key uuid,
  _expected_preapproval_id text,
  _expected_claimed_at timestamptz,
  _attempts integer,
  _http_status integer,
  _provider_response_ref text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  _item public.subscription_price_change_items%ROWTYPE;
  _batch public.subscription_price_change_batches%ROWTYPE;
  _subscription public.organization_subscriptions%ROWTYPE;
  _subscription_found boolean;
  _subscription_snapshot_matches boolean;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'PLATFORM_ADMIN_SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _item
  FROM public.subscription_price_change_items
  WHERE id = _item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ITEM_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF _item.idempotency_key IS DISTINCT FROM _expected_idempotency_key
    OR _item.preapproval_id IS DISTINCT FROM _expected_preapproval_id
    OR _item.claimed_at IS DISTINCT FROM _expected_claimed_at THEN
    RAISE EXCEPTION 'ITEM_CLAIM_LOST' USING ERRCODE = '40001';
  END IF;

  IF _item.status = 'succeeded' THEN
    RETURN to_jsonb(_item);
  END IF;
  IF _item.status <> 'processing' THEN
    RAISE EXCEPTION 'ITEM_NOT_CLAIMED' USING ERRCODE = '55000';
  END IF;
  IF _item.provider_mutation_started_at IS NULL THEN
    RAISE EXCEPTION 'PROVIDER_MUTATION_NOT_STARTED' USING ERRCODE = '55000';
  END IF;
  IF _item.provider_mutation_kind IS NULL
    OR _item.provider_mutation_kind NOT IN ('set_amount', 'cancel') THEN
    RAISE EXCEPTION 'INVALID_PROVIDER_MUTATION_KIND' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO _batch
  FROM public.subscription_price_change_batches
  WHERE id = _item.batch_id;

  SELECT * INTO _subscription
  FROM public.organization_subscriptions
  WHERE organization_id = _item.organization_id
  FOR UPDATE;
  _subscription_found := FOUND;

  _subscription_snapshot_matches := CASE
    WHEN _item.provider_mutation_subscription_id IS NULL
    THEN NOT _subscription_found
    ELSE _subscription_found
      AND _subscription.id IS NOT DISTINCT FROM _item.provider_mutation_subscription_id
      AND _subscription.updated_at IS NOT DISTINCT FROM
        _item.provider_mutation_subscription_updated_at
  END;

  IF NOT _subscription_snapshot_matches
    OR _item.provider_mutation_kind = 'set_amount' AND (
      NOT _subscription_found OR NOT (
      _subscription.provider = 'mercadopago'
      AND _subscription.status = 'active'
      AND COALESCE(
        CASE
          WHEN _subscription.pending_plan_code IS NOT NULL
            AND NULLIF(_subscription.metadata->>'pending_mercadopago_preapproval_id', '') IS NULL
            AND _subscription.mercadopago_status IS DISTINCT FROM 'pending'
            AND _subscription.pending_checkout_amount_ars IS NULL
            AND _subscription.pending_checkout_price_version IS NULL
          THEN _subscription.pending_plan_code
        END,
        _subscription.billing_plan_code,
        _subscription.current_plan_code,
        _subscription.effective_plan_code
      ) = _batch.plan_code
      AND NULLIF(_subscription.mercadopago_preapproval_id, '') = _item.preapproval_id
      )
    )
    OR _item.provider_mutation_kind = 'cancel' AND _subscription_found AND (
      _subscription.provider = 'mercadopago'
      AND _subscription.status = 'active'
      AND NULLIF(_subscription.mercadopago_preapproval_id, '') = _item.preapproval_id
    ) THEN
    -- Mercado Pago already accepted the PUT, so the worker must first restore
    -- the provider's newly-current local intent (or cancel an orphan) before
    -- this item can become skipped/failed. Keep the fenced claim untouched.
    UPDATE public.subscription_price_change_items
    SET
      requires_compensation = true,
      attempts = LEAST(GREATEST(_attempts, attempts), 100),
      last_http_status = _http_status,
      error_code = 'provider_compensation_required',
      error_message = 'La intencion local cambio despues de iniciar la mutacion externa.',
      provider_response_ref = left(_provider_response_ref, 250),
      next_retry_at = NULL,
      completed_at = NULL
    WHERE id = _item.id
    RETURNING * INTO _item;

    RETURN to_jsonb(_item) || jsonb_build_object('status', 'compensation_required');
  END IF;

  IF _item.provider_mutation_kind = 'set_amount' THEN
    IF _subscription.pending_plan_code = _batch.plan_code
      AND NULLIF(_subscription.metadata->>'pending_mercadopago_preapproval_id', '') IS NULL
      AND _subscription.mercadopago_status IS DISTINCT FROM 'pending'
      AND _subscription.pending_checkout_amount_ars IS NULL
      AND _subscription.pending_checkout_price_version IS NULL THEN
      UPDATE public.organization_subscriptions
      SET metadata = metadata || jsonb_build_object(
        'scheduled_renewal_amount_ars', _batch.new_amount_ars,
        'scheduled_renewal_price_version', _batch.new_price_version
      )
      WHERE id = _subscription.id;
    ELSE
      UPDATE public.organization_subscriptions
      SET
        billing_amount_ars = _batch.new_amount_ars,
        billing_price_version = _batch.new_price_version
      WHERE id = _subscription.id;
    END IF;
  END IF;

  UPDATE public.subscription_price_change_items
  SET
    status = 'succeeded',
    attempts = LEAST(GREATEST(_attempts, attempts), 100),
    last_http_status = _http_status,
    error_code = NULL,
    error_message = NULL,
    requires_compensation = false,
    provider_response_ref = left(_provider_response_ref, 250),
    next_retry_at = NULL,
    completed_at = now()
  WHERE id = _item.id
  RETURNING * INTO _item;

  RETURN to_jsonb(_item);
END;
$function$;

-- Serializes checkout persistence with catalog price changes. The checkout is
-- created at Mercado Pago first, then this transaction takes a shared lock on
-- the exact catalog version. A concurrent admin price batch takes FOR UPDATE on
-- the same row, so either the checkout is included in that batch or it is
-- rejected and its provider preapproval is cancelled by the Edge Function.
CREATE OR REPLACE FUNCTION public.subscription_finalize_checkout(
  _organization_id uuid,
  _plan_code text,
  _expected_amount_ars numeric,
  _expected_price_version integer,
  _expected_plan_updated_at timestamptz,
  _existing_subscription_id uuid,
  _expected_subscription_updated_at timestamptz,
  _preapproval_id text,
  _external_reference text,
  _init_point text,
  _payer_email text,
  _provider_status text,
  _metadata jsonb,
  _preserve_current_provider boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  _plan public.subscription_plans%ROWTYPE;
  _subscription public.organization_subscriptions%ROWTYPE;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'SUBSCRIPTION_SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _plan
  FROM public.subscription_plans
  WHERE code = _plan_code
  FOR SHARE;

  IF NOT FOUND
    OR NOT _plan.is_active
    OR _plan.amount_ars IS DISTINCT FROM _expected_amount_ars
    OR _plan.price_version IS DISTINCT FROM _expected_price_version
    OR _plan.updated_at IS DISTINCT FROM _expected_plan_updated_at THEN
    RAISE EXCEPTION 'CATALOG_CONFLICT' USING ERRCODE = '40001';
  END IF;

  IF NULLIF(_preapproval_id, '') IS NULL
    OR NULLIF(_external_reference, '') IS NULL
    OR NULLIF(_init_point, '') IS NULL THEN
    RAISE EXCEPTION 'INVALID_CHECKOUT_REFERENCE' USING ERRCODE = '22023';
  END IF;

  IF _existing_subscription_id IS NULL THEN
    IF _preserve_current_provider THEN
      RAISE EXCEPTION 'INVALID_PRESERVE_STATE' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.organization_subscriptions (
      organization_id,
      provider,
      pending_plan_code,
      pending_checkout_amount_ars,
      pending_checkout_price_version,
      mercadopago_preapproval_id,
      mercadopago_external_reference,
      mercadopago_init_point,
      mercadopago_status,
      payer_email,
      metadata
    ) VALUES (
      _organization_id,
      'mercadopago',
      _plan.code,
      _plan.amount_ars,
      _plan.price_version,
      _preapproval_id,
      _external_reference,
      _init_point,
      _provider_status,
      _payer_email,
      COALESCE(_metadata, '{}'::jsonb)
    )
    RETURNING * INTO _subscription;
  ELSE
    UPDATE public.organization_subscriptions AS subscription
    SET
      provider = 'mercadopago',
      pending_plan_code = _plan.code,
      pending_checkout_amount_ars = _plan.amount_ars,
      pending_checkout_price_version = _plan.price_version,
      mercadopago_preapproval_id = CASE
        WHEN _preserve_current_provider THEN subscription.mercadopago_preapproval_id
        ELSE _preapproval_id
      END,
      mercadopago_external_reference = CASE
        WHEN _preserve_current_provider THEN subscription.mercadopago_external_reference
        ELSE _external_reference
      END,
      mercadopago_status = CASE
        WHEN _preserve_current_provider THEN subscription.mercadopago_status
        ELSE _provider_status
      END,
      mercadopago_init_point = _init_point,
      payer_email = _payer_email,
      metadata = COALESCE(_metadata, '{}'::jsonb)
    WHERE subscription.id = _existing_subscription_id
      AND subscription.organization_id = _organization_id
      AND subscription.updated_at IS NOT DISTINCT FROM _expected_subscription_updated_at
    RETURNING subscription.* INTO _subscription;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'SUBSCRIPTION_CONFLICT' USING ERRCODE = '40001';
    END IF;
  END IF;

  RETURN to_jsonb(_subscription);
END;
$function$;

-- Finalizes a scheduled downgrade under the same catalog-row lock used by
-- price batches. Mercado Pago is updated first; a stale catalog or subscription
-- snapshot makes this transaction fail so the Edge Function can compensate the
-- provider instead of committing an old amount/version locally.
CREATE OR REPLACE FUNCTION public.subscription_finalize_scheduled_plan_change(
  _organization_id uuid,
  _subscription_id uuid,
  _expected_subscription_updated_at timestamptz,
  _expected_preapproval_id text,
  _from_plan_code text,
  _to_plan_code text,
  _expected_amount_ars numeric,
  _expected_price_version integer,
  _expected_plan_updated_at timestamptz,
  _metadata jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  _plan public.subscription_plans%ROWTYPE;
  _subscription public.organization_subscriptions%ROWTYPE;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'SUBSCRIPTION_SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _plan
  FROM public.subscription_plans
  WHERE code = _to_plan_code
  FOR SHARE;

  IF NOT FOUND
    OR NOT _plan.is_active
    OR _plan.amount_ars IS DISTINCT FROM _expected_amount_ars
    OR _plan.price_version IS DISTINCT FROM _expected_price_version
    OR _plan.updated_at IS DISTINCT FROM _expected_plan_updated_at THEN
    RAISE EXCEPTION 'CATALOG_CONFLICT' USING ERRCODE = '40001';
  END IF;

  SELECT * INTO _subscription
  FROM public.organization_subscriptions
  WHERE id = _subscription_id
    AND organization_id = _organization_id
  FOR UPDATE;

  IF NOT FOUND
    OR _subscription.status <> 'active'
    OR _subscription.provider <> 'mercadopago'
    OR NULLIF(_expected_preapproval_id, '') IS NULL
    OR _subscription.mercadopago_preapproval_id IS DISTINCT FROM _expected_preapproval_id
    OR _subscription.updated_at IS DISTINCT FROM _expected_subscription_updated_at
    OR COALESCE(
      _subscription.effective_plan_code,
      _subscription.current_plan_code,
      _subscription.billing_plan_code
    ) IS DISTINCT FROM _from_plan_code THEN
    RAISE EXCEPTION 'SUBSCRIPTION_CONFLICT' USING ERRCODE = '40001';
  END IF;

  UPDATE public.organization_subscriptions
  SET
    pending_plan_code = _plan.code,
    pending_checkout_amount_ars = NULL,
    pending_checkout_price_version = NULL,
    mercadopago_init_point = NULL,
    metadata = COALESCE(_metadata, '{}'::jsonb)
  WHERE id = _subscription.id
  RETURNING * INTO _subscription;

  RETURN to_jsonb(_subscription);
END;
$function$;

-- Reactivation is likewise serialized with catalog price changes. It only
-- restores immediate access for a cancelled subscription whose paid period is
-- still current; expired subscriptions must create a fresh checkout.
CREATE OR REPLACE FUNCTION public.subscription_finalize_reactivation(
  _organization_id uuid,
  _subscription_id uuid,
  _expected_subscription_updated_at timestamptz,
  _expected_preapproval_id text,
  _plan_code text,
  _expected_amount_ars numeric,
  _expected_price_version integer,
  _expected_plan_updated_at timestamptz,
  _metadata jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  _plan public.subscription_plans%ROWTYPE;
  _subscription public.organization_subscriptions%ROWTYPE;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'SUBSCRIPTION_SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _plan
  FROM public.subscription_plans
  WHERE code = _plan_code
  FOR SHARE;

  IF NOT FOUND
    OR NOT _plan.is_active
    OR _plan.amount_ars IS DISTINCT FROM _expected_amount_ars
    OR _plan.price_version IS DISTINCT FROM _expected_price_version
    OR _plan.updated_at IS DISTINCT FROM _expected_plan_updated_at THEN
    RAISE EXCEPTION 'CATALOG_CONFLICT' USING ERRCODE = '40001';
  END IF;

  SELECT * INTO _subscription
  FROM public.organization_subscriptions
  WHERE id = _subscription_id
    AND organization_id = _organization_id
  FOR UPDATE;

  IF NOT FOUND
    OR _subscription.status <> 'cancelled'
    OR _subscription.provider <> 'mercadopago'
    OR NULLIF(_expected_preapproval_id, '') IS NULL
    OR _subscription.mercadopago_preapproval_id IS DISTINCT FROM _expected_preapproval_id
    OR _subscription.updated_at IS DISTINCT FROM _expected_subscription_updated_at
    OR _subscription.current_period_end IS NULL
    OR _subscription.current_period_end <= now()
    OR _subscription.pending_plan_code IS NOT NULL
    OR NULLIF(_subscription.metadata->>'pending_mercadopago_preapproval_id', '') IS NOT NULL
    OR _subscription.pending_checkout_amount_ars IS NOT NULL
    OR _subscription.pending_checkout_price_version IS NOT NULL
    OR COALESCE(
      _subscription.current_plan_code,
      _subscription.billing_plan_code,
      _subscription.effective_plan_code
    ) IS DISTINCT FROM _plan.code THEN
    RAISE EXCEPTION 'SUBSCRIPTION_CONFLICT' USING ERRCODE = '40001';
  END IF;

  UPDATE public.organization_subscriptions
  SET
    status = 'active',
    cancel_at_period_end = false,
    cancelled_at = NULL,
    pending_plan_code = NULL,
    billing_plan_code = _plan.code,
    billing_amount_ars = _plan.amount_ars,
    billing_price_version = _plan.price_version,
    pending_checkout_amount_ars = NULL,
    pending_checkout_price_version = NULL,
    mercadopago_status = 'authorized',
    mercadopago_init_point = NULL,
    metadata = COALESCE(_metadata, '{}'::jsonb)
  WHERE id = _subscription.id
  RETURNING * INTO _subscription;

  RETURN to_jsonb(_subscription);
END;
$function$;

-- Clears either a pending upgrade checkout or a scheduled downgrade when the
-- tenant explicitly returns to its current plan. Provider work happens first;
-- this CAS prevents clearing a newer checkout created concurrently.
CREATE OR REPLACE FUNCTION public.subscription_finalize_pending_plan_cancellation(
  _organization_id uuid,
  _subscription_id uuid,
  _expected_subscription_updated_at timestamptz,
  _expected_current_preapproval_id text,
  _expected_pending_preapproval_id text,
  _current_plan_code text,
  _mode text,
  _expected_billing_amount_ars numeric,
  _metadata jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  _subscription public.organization_subscriptions%ROWTYPE;
  _pending_preapproval_id text;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'SUBSCRIPTION_SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;

  IF _mode IS NULL OR _mode NOT IN (
    'pending_checkout',
    'scheduled_downgrade',
    'reactivation'
  ) THEN
    RAISE EXCEPTION 'INVALID_PENDING_CHANGE_MODE' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _subscription
  FROM public.organization_subscriptions
  WHERE id = _subscription_id
    AND organization_id = _organization_id
  FOR UPDATE;

  IF NOT FOUND
    OR (
      (_mode = 'reactivation' AND _subscription.status <> 'cancelled')
      OR (_mode <> 'reactivation' AND _subscription.status <> 'active')
    )
    OR _subscription.provider <> 'mercadopago'
    OR _subscription.updated_at IS DISTINCT FROM _expected_subscription_updated_at
    OR NULLIF(_subscription.mercadopago_preapproval_id, '') IS DISTINCT FROM _expected_current_preapproval_id
    OR CASE
      WHEN _mode = 'reactivation' THEN COALESCE(
        _subscription.current_plan_code,
        _subscription.billing_plan_code,
        _subscription.effective_plan_code
      )
      ELSE COALESCE(
        _subscription.effective_plan_code,
        _subscription.current_plan_code,
        _subscription.billing_plan_code
      )
    END IS DISTINCT FROM _current_plan_code
    OR _subscription.pending_plan_code IS NULL THEN
    RAISE EXCEPTION 'SUBSCRIPTION_CONFLICT' USING ERRCODE = '40001';
  END IF;

  _pending_preapproval_id := COALESCE(
    NULLIF(_subscription.metadata->>'pending_mercadopago_preapproval_id', ''),
    CASE WHEN _subscription.mercadopago_status = 'pending'
      THEN NULLIF(_subscription.mercadopago_preapproval_id, '')
    END
  );

  IF _mode IN ('pending_checkout', 'reactivation') AND (
    NULLIF(_expected_pending_preapproval_id, '') IS NULL
    OR _pending_preapproval_id IS DISTINCT FROM _expected_pending_preapproval_id
    OR _pending_preapproval_id = _expected_current_preapproval_id
  ) THEN
    RAISE EXCEPTION 'SUBSCRIPTION_CONFLICT' USING ERRCODE = '40001';
  END IF;

  IF _mode = 'scheduled_downgrade' AND (
    _pending_preapproval_id IS NOT NULL
    OR _subscription.pending_checkout_amount_ars IS NOT NULL
    OR _subscription.pending_checkout_price_version IS NOT NULL
    OR _subscription.billing_amount_ars IS DISTINCT FROM _expected_billing_amount_ars
  ) THEN
    RAISE EXCEPTION 'SUBSCRIPTION_CONFLICT' USING ERRCODE = '40001';
  END IF;

  UPDATE public.organization_subscriptions
  SET
    pending_plan_code = NULL,
    pending_checkout_amount_ars = NULL,
    pending_checkout_price_version = NULL,
    mercadopago_init_point = NULL,
    metadata = COALESCE(_metadata, '{}'::jsonb)
  WHERE id = _subscription.id
  RETURNING * INTO _subscription;

  RETURN to_jsonb(_subscription);
END;
$function$;

-- Fences provider compensation used by tenant billing actions. The caller
-- derives an exact local revision, applies the compensating PUT/cancel and then
-- confirms it here. Touching the row forces any concurrent stale finalizer to
-- lose its own compare-and-swap instead of committing divergence.
CREATE OR REPLACE FUNCTION public.subscription_confirm_provider_reconciliation(
  _organization_id uuid,
  _expected_subscription_id uuid,
  _expected_subscription_updated_at timestamptz,
  _preapproval_id text,
  _should_cancel boolean,
  _expected_amount_ars numeric
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  _subscription public.organization_subscriptions%ROWTYPE;
  _subscription_found boolean;
  _desired_amount numeric;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'SUBSCRIPTION_SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;

  IF _should_cancel IS NULL THEN
    RAISE EXCEPTION 'INVALID_RECONCILIATION_MODE' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _subscription
  FROM public.organization_subscriptions
  WHERE organization_id = _organization_id
  FOR UPDATE;
  _subscription_found := FOUND;

  IF _expected_subscription_id IS NULL THEN
    IF _subscription_found THEN
      RAISE EXCEPTION 'SUBSCRIPTION_CONFLICT' USING ERRCODE = '40001';
    END IF;
  ELSIF NOT _subscription_found
    OR _subscription.id IS DISTINCT FROM _expected_subscription_id
    OR _subscription.updated_at IS DISTINCT FROM _expected_subscription_updated_at THEN
    RAISE EXCEPTION 'SUBSCRIPTION_CONFLICT' USING ERRCODE = '40001';
  END IF;

  IF _should_cancel THEN
    IF _subscription_found
      AND _subscription.provider = 'mercadopago'
      AND (
        (
          _subscription.status = 'active'
          AND NULLIF(_subscription.mercadopago_preapproval_id, '') = _preapproval_id
        )
        OR NULLIF(_subscription.metadata->>'pending_mercadopago_preapproval_id', '') =
          _preapproval_id
        OR (
          _subscription.mercadopago_status = 'pending'
          AND NULLIF(_subscription.mercadopago_preapproval_id, '') = _preapproval_id
        )
      ) THEN
      RAISE EXCEPTION 'RECONCILIATION_INTENT_CHANGED' USING ERRCODE = '40001';
    END IF;
  ELSE
    IF NOT _subscription_found
      OR _subscription.status <> 'active'
      OR _subscription.provider <> 'mercadopago'
      OR NULLIF(_subscription.mercadopago_preapproval_id, '') <> _preapproval_id THEN
      RAISE EXCEPTION 'RECONCILIATION_INTENT_CHANGED' USING ERRCODE = '40001';
    END IF;

    _desired_amount := CASE
      WHEN _subscription.pending_plan_code IS NOT NULL
        AND NULLIF(_subscription.metadata->>'pending_mercadopago_preapproval_id', '') IS NULL
        AND _subscription.mercadopago_status IS DISTINCT FROM 'pending'
        AND _subscription.pending_checkout_amount_ars IS NULL
        AND _subscription.pending_checkout_price_version IS NULL
      THEN NULLIF(_subscription.metadata->>'scheduled_renewal_amount_ars', '')::numeric
      ELSE _subscription.billing_amount_ars
    END;

    IF _desired_amount IS NULL
      OR _desired_amount <= 0
      OR _desired_amount IS DISTINCT FROM _expected_amount_ars THEN
      RAISE EXCEPTION 'RECONCILIATION_INTENT_CHANGED' USING ERRCODE = '40001';
    END IF;
  END IF;

  IF _subscription_found THEN
    UPDATE public.organization_subscriptions
    SET updated_at = clock_timestamp()
    WHERE id = _subscription.id;
  END IF;

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.subscription_finalize_cancellation(
  _organization_id uuid,
  _subscription_id uuid,
  _expected_subscription_updated_at timestamptz,
  _expected_preapproval_id text,
  _cancelled_at timestamptz,
  _metadata jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  _subscription public.organization_subscriptions%ROWTYPE;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'SUBSCRIPTION_SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _subscription
  FROM public.organization_subscriptions
  WHERE id = _subscription_id
    AND organization_id = _organization_id
  FOR UPDATE;

  IF NOT FOUND
    OR _subscription.provider <> 'mercadopago'
    OR _subscription.updated_at IS DISTINCT FROM _expected_subscription_updated_at
    OR NULLIF(_subscription.mercadopago_preapproval_id, '') IS DISTINCT FROM _expected_preapproval_id THEN
    RAISE EXCEPTION 'SUBSCRIPTION_CONFLICT' USING ERRCODE = '40001';
  END IF;

  UPDATE public.organization_subscriptions
  SET
    status = 'cancelled',
    cancel_at_period_end = true,
    cancelled_at = _cancelled_at,
    mercadopago_status = 'cancelled',
    pending_plan_code = NULL,
    pending_checkout_amount_ars = NULL,
    pending_checkout_price_version = NULL,
    mercadopago_init_point = NULL,
    metadata = COALESCE(_metadata, '{}'::jsonb)
  WHERE id = _subscription.id
  RETURNING * INTO _subscription;

  RETURN to_jsonb(_subscription);
END;
$function$;

REVOKE ALL ON FUNCTION public.platform_admin_create_price_change_batch(
  text, numeric, numeric, integer, timestamptz, uuid, text, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_admin_claim_price_change_items(uuid, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_admin_retry_price_change_items(uuid, uuid[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_admin_refresh_price_change_batch(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_admin_start_price_change_provider_mutation(
  uuid, uuid, text, timestamptz, text, uuid, timestamptz
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_admin_require_price_change_compensation(
  uuid, uuid, text, timestamptz, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_admin_complete_price_change_compensation(
  uuid, uuid, text, timestamptz, uuid, timestamptz,
  boolean, numeric, boolean, integer, integer
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_admin_complete_price_change_item(
  uuid, uuid, text, timestamptz, integer, integer, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.subscription_finalize_checkout(
  uuid, text, numeric, integer, timestamptz, uuid, timestamptz,
  text, text, text, text, text, jsonb, boolean
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.subscription_finalize_scheduled_plan_change(
  uuid, uuid, timestamptz, text, text, text, numeric, integer, timestamptz, jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.subscription_finalize_reactivation(
  uuid, uuid, timestamptz, text, text, numeric, integer, timestamptz, jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.subscription_finalize_pending_plan_cancellation(
  uuid, uuid, timestamptz, text, text, text, text, numeric, jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.subscription_confirm_provider_reconciliation(
  uuid, uuid, timestamptz, text, boolean, numeric
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.subscription_finalize_cancellation(
  uuid, uuid, timestamptz, text, timestamptz, jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.platform_admin_create_price_change_batch(
  text, numeric, numeric, integer, timestamptz, uuid, text, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION public.platform_admin_claim_price_change_items(uuid, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.platform_admin_retry_price_change_items(uuid, uuid[])
  TO service_role;
GRANT EXECUTE ON FUNCTION public.platform_admin_refresh_price_change_batch(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.platform_admin_start_price_change_provider_mutation(
  uuid, uuid, text, timestamptz, text, uuid, timestamptz
) TO service_role;
GRANT EXECUTE ON FUNCTION public.platform_admin_require_price_change_compensation(
  uuid, uuid, text, timestamptz, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.platform_admin_complete_price_change_compensation(
  uuid, uuid, text, timestamptz, uuid, timestamptz,
  boolean, numeric, boolean, integer, integer
) TO service_role;
GRANT EXECUTE ON FUNCTION public.platform_admin_complete_price_change_item(
  uuid, uuid, text, timestamptz, integer, integer, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.subscription_finalize_checkout(
  uuid, text, numeric, integer, timestamptz, uuid, timestamptz,
  text, text, text, text, text, jsonb, boolean
) TO service_role;
GRANT EXECUTE ON FUNCTION public.subscription_finalize_scheduled_plan_change(
  uuid, uuid, timestamptz, text, text, text, numeric, integer, timestamptz, jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.subscription_finalize_reactivation(
  uuid, uuid, timestamptz, text, text, numeric, integer, timestamptz, jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.subscription_finalize_pending_plan_cancellation(
  uuid, uuid, timestamptz, text, text, text, text, numeric, jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.subscription_confirm_provider_reconciliation(
  uuid, uuid, timestamptz, text, boolean, numeric
) TO service_role;
GRANT EXECUTE ON FUNCTION public.subscription_finalize_cancellation(
  uuid, uuid, timestamptz, text, timestamptz, jsonb
) TO service_role;

-- Bootstrap through the exact same auditable work queue if an older deployment
-- still has Profesional at a different amount. This never overwrites the local
-- billing snapshots: each Mercado Pago preapproval remains pending until an
-- authenticated administrator enables the mutation kill switch and processes
-- this batch. On installations already at ARS 60,000 this block is a no-op.
SET LOCAL ROLE service_role;
DO $bootstrap$
DECLARE
  _plan public.subscription_plans%ROWTYPE;
  _batch jsonb;
BEGIN
  SELECT * INTO _plan
  FROM public.subscription_plans
  WHERE code = 'profesional';

  IF FOUND AND _plan.amount_ars IS DISTINCT FROM 60000 THEN
    _batch := public.platform_admin_create_price_change_batch(
      'profesional',
      60000,
      _plan.amount_ars,
      _plan.price_version,
      _plan.updated_at,
      NULL,
      'Alineacion inicial auditable del precio Profesional a ARS 60.000.',
      gen_random_uuid()
    );
    PERFORM public.platform_admin_refresh_price_change_batch((_batch->>'id')::uuid);
  END IF;
END;
$bootstrap$;
RESET ROLE;

-- SECURITY DEFINER EXCEPTION: this is the existing Auth trigger function. The
-- only new behavior is the first platform_role branch, which returns before any
-- tenant organization, branch, profile, role or trial is provisioned.
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

  RETURN NEW;
END;
$function$;

-- price_monthly is retired only after application consumers are migrated to
-- subscription_plans.amount_ars in the same release.
ALTER TABLE public.plan_features DROP COLUMN IF EXISTS price_monthly;
