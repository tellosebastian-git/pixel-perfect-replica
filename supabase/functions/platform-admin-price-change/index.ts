import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { mpPlatformFetch, readMpError } from '../_shared/mp-client.ts';
import {
  getPlatformAdminContext,
  getRequestId,
  insertAuditLog,
  isRecord,
  jsonError,
  jsonResponse,
  mapWithConcurrency,
  numberValue,
  platformAdminCorsHeaders,
  sanitizeMessage,
  stringValue,
} from '../_shared/platform-admin.ts';

type PriceAction = 'preview' | 'apply' | 'process' | 'retry';
type AuditResult = 'pending' | 'succeeded' | 'partial' | 'failed' | 'skipped';

interface PriceBody extends Record<string, unknown> {
  action?: unknown;
  planCode?: unknown;
  newAmountArs?: unknown;
  expectedAmountArs?: unknown;
  expectedPriceVersion?: unknown;
  expectedUpdatedAt?: unknown;
  reason?: unknown;
  password?: unknown;
  batchId?: unknown;
  itemIds?: unknown;
}

interface WorkItem extends Record<string, unknown> {
  id: string;
  batch_id: string;
  organization_id: string | null;
  subscription_id: string | null;
  preapproval_id: string | null;
  expected_external_reference: string | null;
  item_type: 'active_renewal' | 'pending_checkout';
  status: string;
  attempts: number;
  compensation_attempts: number;
  requires_compensation: boolean;
  provider_mutation_started_at: string | null;
  provider_mutation_kind: 'set_amount' | 'cancel' | null;
  provider_mutation_subscription_id: string | null;
  provider_mutation_subscription_updated_at: string | null;
  idempotency_key: string;
  claimed_at: string;
  plan_code: string;
}

interface ProcessResult {
  itemId: string;
  succeeded: boolean;
  status: string;
}

interface RevalidatedTarget {
  current: boolean;
  expectedExternalReference: string | null;
  subscriptionId: string | null;
  subscriptionUpdatedAt: string | null;
}

interface PendingCheckoutState {
  promoted: boolean;
  subscriptionId: string | null;
  subscriptionUpdatedAt: string | null;
}

type ProviderTargetCheck =
  | { kind: 'ok' }
  | { kind: 'done'; status: number }
  | { kind: 'skip'; code: string; message: string }
  | { kind: 'fail'; attempts: number; status: number | null; code: string; message: string };

type CompensationResult =
  | { ok: true; attempts: number; status: number | null; completedPriceChange: boolean }
  | { ok: false; attempts: number; status: number | null; code: string; message: string };

const ACTIONS: readonly PriceAction[] = ['preview', 'apply', 'process', 'retry'];
const PLAN_CODES = ['basico', 'profesional', 'premium'] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_AMOUNT_ARS = 999_999_999.99;
const PROCESS_LIMIT = 20;
const PROCESS_CONCURRENCY = 5;
const MAX_PROVIDER_ATTEMPTS = 3;

function isPlanCode(value: unknown): value is typeof PLAN_CODES[number] {
  return typeof value === 'string' && PLAN_CODES.includes(value as typeof PLAN_CODES[number]);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function pendingCheckoutPreapprovalId(subscription: Record<string, unknown>): string | null {
  const metadata = isRecord(subscription.metadata) ? subscription.metadata : {};
  return stringValue(metadata.pending_mercadopago_preapproval_id) ?? (
    subscription.mercadopago_status === 'pending'
      ? stringValue(subscription.mercadopago_preapproval_id)
      : null
  );
}

function hasPendingCheckoutIntent(subscription: Record<string, unknown>): boolean {
  return Boolean(
    pendingCheckoutPreapprovalId(subscription) ||
    numberValue(subscription.pending_checkout_amount_ars) !== null ||
    numberValue(subscription.pending_checkout_price_version) !== null
  );
}

function currentBillingPlanCode(subscription: Record<string, unknown>): string | null {
  return stringValue(
    subscription.billing_plan_code ??
      subscription.current_plan_code ??
      subscription.effective_plan_code,
  );
}

function renewalTargetPlanCode(subscription: Record<string, unknown>): string | null {
  const scheduledPlan = !hasPendingCheckoutIntent(subscription)
    ? stringValue(subscription.pending_plan_code)
    : null;
  return scheduledPlan ?? currentBillingPlanCode(subscription);
}

function parseSubscriptionExternalReference(value: unknown): {
  organizationId: string;
  planCode: string;
} | null {
  const reference = stringValue(value);
  if (!reference) return null;
  const match = reference.match(
    /^sub_([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})_(basico|profesional|premium)(?:_|$)/i,
  );
  return match ? { organizationId: match[1], planCode: match[2].toLowerCase() } : null;
}

function mutationsEnabled(): boolean {
  return Deno.env.get('PLATFORM_ADMIN_PRICE_MUTATIONS_ENABLED')?.trim().toLowerCase() === 'true';
}

function planDto(row: Record<string, unknown>): Record<string, unknown> {
  return {
    code: stringValue(row.code) ?? '',
    name: stringValue(row.name) ?? '',
    description: stringValue(row.description),
    amountArs: numberValue(row.amount_ars) ?? 0,
    priceVersion: numberValue(row.price_version) ?? 1,
    billingPeriod: stringValue(row.billing_period) ?? 'monthly',
    isActive: row.is_active === true,
    sortOrder: numberValue(row.sort_order) ?? 0,
    updatedAt: stringValue(row.updated_at) ?? '',
  };
}

function mappedBatchStatus(value: unknown): string {
  return value === 'partially_completed' ? 'partially_failed' : (stringValue(value) ?? 'failed');
}

function batchDto(
  row: Record<string, unknown>,
  itemRows: Record<string, unknown>[] = [],
): Record<string, unknown> {
  const pendingCount = numberValue(row.pending_count) ??
    itemRows.filter((item) => item.status === 'pending').length;
  const processingCount = numberValue(row.processing_count) ??
    itemRows.filter((item) => item.status === 'processing').length;
  const total = numberValue(row.total_items) ?? itemRows.length;
  const skipped = numberValue(row.skipped_items) ?? itemRows.filter((item) => item.status === 'skipped').length;
  const retryable = numberValue(row.retryable_count) ?? itemRows.filter((item) => (
    item.status === 'failed' ||
    (item.status === 'skipped' && item.error_code === 'missing_preapproval')
  )).length;

  return {
    id: stringValue(row.id) ?? '',
    planCode: stringValue(row.plan_code) ?? '',
    previousAmountArs: numberValue(row.old_amount_ars) ?? 0,
    nextAmountArs: numberValue(row.new_amount_ars) ?? 0,
    previousPriceVersion: numberValue(row.old_price_version) ?? 0,
    nextPriceVersion: numberValue(row.new_price_version) ?? 0,
    status: mappedBatchStatus(row.status),
    eligibleCount: Math.max(total - skipped, 0),
    pendingCount,
    processingCount,
    succeededCount: numberValue(row.succeeded_items) ?? 0,
    failedCount: numberValue(row.failed_items) ?? 0,
    skippedCount: skipped,
    retryableCount: retryable,
    actorUserId: stringValue(row.actor_user_id) ?? '',
    actorAlias: stringValue(row.actor_alias) ?? 'admin',
    reason: stringValue(row.reason) ?? '',
    createdAt: stringValue(row.created_at) ?? '',
    startedAt: stringValue(row.started_at),
    completedAt: stringValue(row.completed_at),
    updatedAt: stringValue(row.updated_at) ?? '',
  };
}

async function readBatch(
  supabaseAdmin: SupabaseClient,
  batchId: string,
): Promise<{ batch: Record<string, unknown>; items: Record<string, unknown>[] }> {
  const { data: batch, error: batchError } = await supabaseAdmin
    .from('platform_admin_price_change_batches_v')
    .select('id,plan_code,old_amount_ars,new_amount_ars,old_price_version,new_price_version,status,total_items,processed_items,succeeded_items,failed_items,skipped_items,pending_count,processing_count,retryable_count,actor_user_id,actor_alias,reason,started_at,completed_at,created_at,updated_at')
    .eq('id', batchId)
    .maybeSingle();

  if (batchError) throw new Error('BATCH_READ_FAILED');
  if (!batch) throw new Error('BATCH_NOT_FOUND');
  return {
    batch: batch as Record<string, unknown>,
    items: [],
  };
}

async function assertBatchIsCurrent(
  supabaseAdmin: SupabaseClient,
  batch: Record<string, unknown>,
): Promise<boolean> {
  const { data: plan, error } = await supabaseAdmin
    .from('subscription_plans')
    .select('amount_ars,price_version')
    .eq('code', batch.plan_code)
    .maybeSingle();
  if (error || !plan) throw new Error('PLAN_READ_FAILED');
  return (
    numberValue(plan.amount_ars) === numberValue(batch.new_amount_ars) &&
    numberValue(plan.price_version) === numberValue(batch.new_price_version)
  );
}

async function preview(supabaseAdmin: SupabaseClient, body: PriceBody) {
  if (!isPlanCode(body.planCode)) throw new Error('INVALID_PLAN');

  const [{ data: plan, error: planError }, { data: impact, error: impactError }] = await Promise.all([
    supabaseAdmin
      .from('subscription_plans')
      .select('code,name,description,amount_ars,price_version,billing_period,is_active,sort_order,updated_at')
      .eq('code', body.planCode)
      .maybeSingle(),
    supabaseAdmin
      .from('platform_admin_price_impact_v')
      .select('eligible_active_renewals,pending_checkouts,excluded,exclusions')
      .eq('plan_code', body.planCode)
      .maybeSingle(),
  ]);
  if (planError) throw new Error('PLAN_READ_FAILED');
  if (impactError) throw new Error('PRICE_IMPACT_READ_FAILED');
  if (!plan) throw new Error('PLAN_NOT_FOUND');

  const eligibleActiveRenewals = numberValue(impact?.eligible_active_renewals) ?? 0;
  const pendingCheckouts = numberValue(impact?.pending_checkouts) ?? 0;
  const excluded = numberValue(impact?.excluded) ?? 0;
  const exclusionMap = isRecord(impact?.exclusions) ? impact.exclusions : {};
  const exclusions = Object.entries(exclusionMap).map(([reason, count]) => ({
    reason,
    count: numberValue(count) ?? 0,
  }));
  return {
    plan: planDto(plan as Record<string, unknown>),
    impact: {
      eligibleActiveRenewals,
      pendingCheckouts,
      excluded,
      totalAffected: eligibleActiveRenewals + pendingCheckouts,
    },
    exclusions,
  };
}

async function reauthenticatePassword(
  context: { userId: string; email: string },
  password: string,
): Promise<boolean> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim();
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')?.trim();
  if (!supabaseUrl || !anonKey) throw new Error('AUTH_CONFIGURATION_ERROR');

  const client = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: context.email,
    password,
  });

  return !error && data.user?.id === context.userId &&
    data.user.app_metadata?.platform_role === 'platform_admin';
}

async function applyPrice(
  supabaseAdmin: SupabaseClient,
  context: { userId: string; email: string },
  body: PriceBody,
  requestId: string,
) {
  if (!isPlanCode(body.planCode)) throw new Error('INVALID_PLAN');
  const newAmountArs = numberValue(body.newAmountArs);
  const expectedAmountArs = numberValue(body.expectedAmountArs);
  const expectedPriceVersion = numberValue(body.expectedPriceVersion);
  const expectedUpdatedAt = stringValue(body.expectedUpdatedAt);
  const reason = stringValue(body.reason);
  const password = typeof body.password === 'string' ? body.password : '';

  if (!newAmountArs || newAmountArs <= 0 || newAmountArs > MAX_AMOUNT_ARS) {
    throw new Error('INVALID_PRICE');
  }
  if (expectedAmountArs === null || !Number.isInteger(expectedPriceVersion) || !expectedUpdatedAt) {
    throw new Error('INVALID_EXPECTED_CATALOG');
  }
  if (!Number.isFinite(Date.parse(expectedUpdatedAt))) throw new Error('INVALID_EXPECTED_CATALOG');
  if (!reason || reason.length < 10 || reason.length > 500) throw new Error('INVALID_REASON');
  if (!password || password.length > 1024) throw new Error('INVALID_PASSWORD');

  if (!(await reauthenticatePassword(context, password))) {
    throw new Error('PASSWORD_CONFIRMATION_FAILED');
  }

  const { data: createdBatch, error: createError } = await supabaseAdmin.rpc(
    'platform_admin_create_price_change_batch',
    {
      _plan_code: body.planCode,
      _new_amount_ars: newAmountArs,
      _expected_amount_ars: expectedAmountArs,
      _expected_price_version: expectedPriceVersion,
      _expected_updated_at: expectedUpdatedAt,
      _actor_user_id: context.userId,
      _reason: reason,
      _request_id: requestId,
    },
  );
  if (createError) {
    const message = `${createError.code ?? ''}:${createError.message ?? ''}`;
    if (message.includes('CATALOG_CONFLICT') || createError.code === '40001') {
      throw new Error('CATALOG_CONFLICT');
    }
    if (createError.code === '23505') throw new Error('UNFINISHED_BATCH_EXISTS');
    if (message.includes('PRICE_UNCHANGED')) throw new Error('PRICE_UNCHANGED');
    throw new Error('BATCH_CREATE_FAILED');
  }

  const batchId = stringValue(isRecord(createdBatch) ? createdBatch.id : null);
  if (!batchId) throw new Error('BATCH_CREATE_FAILED');

  const { error: refreshError } = await supabaseAdmin.rpc(
    'platform_admin_refresh_price_change_batch',
    { _batch_id: batchId },
  );
  if (refreshError) throw new Error('BATCH_REFRESH_FAILED');

  const [{ batch, items }, { data: plan, error: planError }] = await Promise.all([
    readBatch(supabaseAdmin, batchId),
    supabaseAdmin
      .from('subscription_plans')
      .select('code,name,description,amount_ars,price_version,billing_period,is_active,sort_order,updated_at')
      .eq('code', body.planCode)
      .single(),
  ]);
  if (planError || !plan) throw new Error('PLAN_READ_FAILED');

  return { batch: batchDto(batch, items), plan: planDto(plan as Record<string, unknown>) };
}

function transientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get('retry-after');
  const seconds = retryAfter ? Number(retryAfter) : Number.NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 1_500);
  return Math.min(250 * (2 ** Math.max(attempt - 1, 0)), 1_500);
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function failItem(
  supabaseAdmin: SupabaseClient,
  item: WorkItem,
  attempts: number,
  status: number | null,
  code: string,
  message: string,
): Promise<ProcessResult> {
  let update = supabaseAdmin
    .from('subscription_price_change_items')
    .update({
      status: 'failed',
      attempts,
      last_http_status: status,
      error_code: code.slice(0, 120),
      error_message: sanitizeMessage(message),
      next_retry_at: null,
      completed_at: new Date().toISOString(),
    })
    .eq('id', item.id)
    .eq('status', 'processing')
    .eq('idempotency_key', item.idempotency_key)
    .eq('claimed_at', item.claimed_at);
  update = item.preapproval_id
    ? update.eq('preapproval_id', item.preapproval_id)
    : update.is('preapproval_id', null);
  const { data, error } = await update.select('id').maybeSingle();
  if (error) throw new Error('ITEM_FAILURE_WRITE_FAILED');
  if (!data) return { itemId: item.id, succeeded: false, status: 'claim_lost' };
  return { itemId: item.id, succeeded: false, status: 'failed' };
}

async function skipItem(
  supabaseAdmin: SupabaseClient,
  item: WorkItem,
  code: string,
  message: string,
): Promise<ProcessResult> {
  let update = supabaseAdmin
    .from('subscription_price_change_items')
    .update({
      status: 'skipped',
      error_code: code.slice(0, 120),
      error_message: sanitizeMessage(message),
      next_retry_at: null,
      completed_at: new Date().toISOString(),
    })
    .eq('id', item.id)
    .eq('status', 'processing')
    .eq('idempotency_key', item.idempotency_key)
    .eq('claimed_at', item.claimed_at);
  update = item.preapproval_id
    ? update.eq('preapproval_id', item.preapproval_id)
    : update.is('preapproval_id', null);
  const { data, error } = await update.select('id').maybeSingle();
  if (error) throw new Error('ITEM_SKIP_WRITE_FAILED');
  if (!data) return { itemId: item.id, succeeded: false, status: 'claim_lost' };
  return { itemId: item.id, succeeded: false, status: 'skipped' };
}

async function workItemStillCurrent(
  supabaseAdmin: SupabaseClient,
  item: WorkItem,
): Promise<RevalidatedTarget> {
  if (!item.subscription_id) {
    return {
      current: false,
      expectedExternalReference: item.expected_external_reference,
      subscriptionId: null,
      subscriptionUpdatedAt: null,
    };
  }
  const { data: subscription, error } = await supabaseAdmin
    .from('organization_subscriptions')
    .select('id,updated_at,status,provider,current_plan_code,effective_plan_code,billing_plan_code,pending_plan_code,pending_checkout_amount_ars,pending_checkout_price_version,mercadopago_preapproval_id,mercadopago_external_reference,mercadopago_status,metadata')
    .eq('id', item.subscription_id)
    .maybeSingle();
  if (error) throw new Error('SUBSCRIPTION_REVALIDATION_FAILED');
  if (!subscription || subscription.provider !== 'mercadopago') {
    return {
      current: false,
      expectedExternalReference: null,
      subscriptionId: stringValue(subscription?.id),
      subscriptionUpdatedAt: stringValue(subscription?.updated_at),
    };
  }

  if (item.item_type === 'active_renewal') {
    const planCode = renewalTargetPlanCode(subscription as Record<string, unknown>);
    return {
      current: subscription.status === 'active' &&
        planCode === item.plan_code &&
        stringValue(subscription.mercadopago_preapproval_id) === item.preapproval_id,
      expectedExternalReference:
        item.expected_external_reference ?? stringValue(subscription.mercadopago_external_reference),
      subscriptionId: stringValue(subscription.id),
      subscriptionUpdatedAt: stringValue(subscription.updated_at),
    };
  }

  const metadata = isRecord(subscription.metadata) ? subscription.metadata : {};
  return {
    current: subscription.pending_plan_code === item.plan_code &&
      pendingCheckoutPreapprovalId(subscription as Record<string, unknown>) === item.preapproval_id,
    expectedExternalReference: item.expected_external_reference ??
      stringValue(metadata.pending_mercadopago_external_reference) ??
      (subscription.mercadopago_status === 'pending'
        ? stringValue(subscription.mercadopago_external_reference)
        : null),
    subscriptionId: stringValue(subscription.id),
    subscriptionUpdatedAt: stringValue(subscription.updated_at),
  };
}

async function pendingCheckoutState(
  supabaseAdmin: SupabaseClient,
  item: WorkItem,
): Promise<PendingCheckoutState> {
  const parsedReference = parseSubscriptionExternalReference(item.expected_external_reference);
  const organizationId = item.organization_id ?? parsedReference?.organizationId ?? null;
  if (!organizationId) {
    return { promoted: false, subscriptionId: null, subscriptionUpdatedAt: null };
  }
  const { data: subscription, error } = await supabaseAdmin
    .from('organization_subscriptions')
    .select('id,updated_at,status,provider,current_plan_code,effective_plan_code,billing_plan_code,mercadopago_preapproval_id,mercadopago_external_reference')
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) throw new Error('SUBSCRIPTION_REVALIDATION_FAILED');
  if (!subscription) {
    return { promoted: false, subscriptionId: null, subscriptionUpdatedAt: null };
  }
  return {
    promoted: subscription.status === 'active' &&
      subscription.provider === 'mercadopago' &&
      stringValue(subscription.mercadopago_preapproval_id) === item.preapproval_id &&
      stringValue(subscription.mercadopago_external_reference) === item.expected_external_reference &&
      currentBillingPlanCode(subscription as Record<string, unknown>) === item.plan_code,
    subscriptionId: stringValue(subscription.id),
    subscriptionUpdatedAt: stringValue(subscription.updated_at),
  };
}

async function bindExpectedExternalReference(
  supabaseAdmin: SupabaseClient,
  item: WorkItem,
  externalReference: string,
): Promise<boolean> {
  let update = supabaseAdmin
    .from('subscription_price_change_items')
    .update({ expected_external_reference: externalReference })
    .eq('id', item.id)
    .eq('status', 'processing')
    .eq('idempotency_key', item.idempotency_key)
    .eq('claimed_at', item.claimed_at)
    .is('expected_external_reference', null)
    .is('provider_mutation_started_at', null);
  update = item.preapproval_id
    ? update.eq('preapproval_id', item.preapproval_id)
    : update.is('preapproval_id', null);
  const { data, error } = await update.select('id').maybeSingle();
  if (error || !data) return false;
  item.expected_external_reference = externalReference;
  return true;
}

async function verifyProviderTarget(
  supabaseAdmin: SupabaseClient,
  item: WorkItem,
  mutationKind: 'set_amount' | 'cancel',
): Promise<ProviderTargetCheck> {
  let lastStatus: number | null = null;
  let lastCode = 'provider_verification_failed';
  let lastMessage = 'No se pudo verificar el preapproval antes de actualizarlo.';

  for (let attempt = 1; attempt <= MAX_PROVIDER_ATTEMPTS; attempt += 1) {
    try {
      const response = await mpPlatformFetch(
        `/preapproval/${encodeURIComponent(item.preapproval_id ?? '')}`,
      );
      lastStatus = response.status;
      if (!response.ok) {
        if (response.status === 404 && mutationKind === 'cancel') {
          return { kind: 'done', status: response.status };
        }
        const providerError = await readMpError(response);
        lastCode = sanitizeMessage(providerError.code, 'provider_verification_failed').slice(0, 120);
        lastMessage = sanitizeMessage(providerError.message, lastMessage);
        if (transientStatus(response.status) && attempt < MAX_PROVIDER_ATTEMPTS) {
          await wait(retryDelay(response, attempt));
          continue;
        }
        return { kind: 'fail', attempts: attempt, status: response.status, code: lastCode, message: lastMessage };
      }

      const payload = await response.json() as Record<string, unknown>;
      const autoRecurring = isRecord(payload.auto_recurring) ? payload.auto_recurring : {};
      const providerReference = stringValue(payload.external_reference);
      const parsedReference = parseSubscriptionExternalReference(providerReference);
      const providerStatus = stringValue(payload.status)?.toLowerCase();
      const hasFrozenReference = Boolean(item.expected_external_reference);

      if (
        String(payload.id ?? '') !== item.preapproval_id ||
        !parsedReference ||
        (!hasFrozenReference && !item.organization_id) ||
        (item.organization_id &&
          parsedReference.organizationId.toLowerCase() !== item.organization_id.toLowerCase()) ||
        (item.item_type === 'pending_checkout' && parsedReference.planCode !== item.plan_code) ||
        (hasFrozenReference && providerReference !== item.expected_external_reference)
      ) {
        return {
          kind: 'fail',
          attempts: attempt,
          status: response.status,
          code: 'provider_ownership_mismatch',
          message: 'El preapproval no pertenece a la organizacion y plan esperados.',
        };
      }

      if (
        !hasFrozenReference &&
        providerReference &&
        !(await bindExpectedExternalReference(supabaseAdmin, item, providerReference))
      ) {
        return {
          kind: 'fail',
          attempts: attempt,
          status: response.status,
          code: 'external_reference_bind_failed',
          message: 'La referencia externa cambio durante la verificacion.',
        };
      }

      if (
        mutationKind === 'cancel' &&
        (providerStatus === 'cancelled' || providerStatus === 'canceled')
      ) {
        return { kind: 'done', status: response.status };
      }

      if (
        mutationKind === 'set_amount' &&
        providerStatus !== 'authorized' &&
        providerStatus !== 'active'
      ) {
        return {
          kind: 'fail',
          attempts: attempt,
          status: response.status,
          code: 'provider_not_active',
          message: 'El preapproval vigente ya no esta activo en Mercado Pago.',
        };
      }
      if (
        mutationKind === 'set_amount' &&
        stringValue(autoRecurring.currency_id) !== 'ARS'
      ) {
        return {
          kind: 'fail',
          attempts: attempt,
          status: response.status,
          code: 'provider_currency_mismatch',
          message: 'La moneda del preapproval no coincide con ARS.',
        };
      }

      return { kind: 'ok' };
    } catch (error) {
      lastCode = 'provider_network_error';
      lastMessage = sanitizeMessage(error);
      if (attempt < MAX_PROVIDER_ATTEMPTS) {
        await wait(Math.min(250 * (2 ** Math.max(attempt - 1, 0)), 1_500));
        continue;
      }
      return { kind: 'fail', attempts: attempt, status: lastStatus, code: lastCode, message: lastMessage };
    }
  }

  return {
    kind: 'fail',
    attempts: MAX_PROVIDER_ATTEMPTS,
    status: lastStatus,
    code: lastCode,
    message: lastMessage,
  };
}

async function startProviderMutation(
  supabaseAdmin: SupabaseClient,
  item: WorkItem,
  mutationKind: 'set_amount' | 'cancel',
  expectedSubscriptionId: string | null,
  expectedSubscriptionUpdatedAt: string | null,
): Promise<'started' | 'subscription_changed' | 'claim_lost'> {
  const { data, error } = await supabaseAdmin.rpc(
    'platform_admin_start_price_change_provider_mutation',
    {
      _item_id: item.id,
      _expected_idempotency_key: item.idempotency_key,
      _expected_preapproval_id: item.preapproval_id,
      _expected_claimed_at: item.claimed_at,
      _mutation_kind: mutationKind,
      _expected_subscription_id: expectedSubscriptionId,
      _expected_subscription_updated_at: expectedSubscriptionUpdatedAt,
    },
  );
  if (error) {
    return error.message?.includes('SUBSCRIPTION_CONFLICT')
      ? 'subscription_changed'
      : 'claim_lost';
  }
  if (!data) return 'claim_lost';
  item.provider_mutation_started_at = stringValue(
    isRecord(data) ? data.provider_mutation_started_at : null,
  );
  item.provider_mutation_kind = isRecord(data) && data.provider_mutation_kind === 'cancel'
    ? 'cancel'
    : 'set_amount';
  item.provider_mutation_subscription_id = stringValue(
    isRecord(data) ? data.provider_mutation_subscription_id : null,
  );
  item.provider_mutation_subscription_updated_at = stringValue(
    isRecord(data) ? data.provider_mutation_subscription_updated_at : null,
  );
  return item.provider_mutation_started_at ? 'started' : 'claim_lost';
}

async function requireCompensation(
  supabaseAdmin: SupabaseClient,
  item: WorkItem,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc(
    'platform_admin_require_price_change_compensation',
    {
      _item_id: item.id,
      _expected_idempotency_key: item.idempotency_key,
      _expected_preapproval_id: item.preapproval_id,
      _expected_claimed_at: item.claimed_at,
      _reason: 'La suscripcion cambio despues de iniciar la mutacion externa.',
    },
  );
  if (error || !data) return false;
  item.requires_compensation = true;
  return true;
}

async function failCompensation(
  supabaseAdmin: SupabaseClient,
  item: WorkItem,
  result: Extract<CompensationResult, { ok: false }>,
): Promise<ProcessResult> {
  let update = supabaseAdmin
    .from('subscription_price_change_items')
    .update({
      status: 'failed',
      requires_compensation: true,
      compensation_attempts: Math.min(result.attempts, 100),
      last_http_status: result.status,
      error_code: result.code.slice(0, 120),
      error_message: sanitizeMessage(result.message),
      next_retry_at: null,
      completed_at: new Date().toISOString(),
    })
    .eq('id', item.id)
    .eq('status', 'processing')
    .eq('requires_compensation', true)
    .eq('idempotency_key', item.idempotency_key)
    .eq('claimed_at', item.claimed_at);
  update = item.preapproval_id
    ? update.eq('preapproval_id', item.preapproval_id)
    : update.is('preapproval_id', null);
  const { data, error } = await update.select('id').maybeSingle();
  if (error) throw new Error('ITEM_COMPENSATION_FAILURE_WRITE_FAILED');
  if (!data) return { itemId: item.id, succeeded: false, status: 'claim_lost' };
  return { itemId: item.id, succeeded: false, status: 'failed' };
}

async function compensationIntent(
  supabaseAdmin: SupabaseClient,
  item: WorkItem,
): Promise<{
  subscriptionId: string | null;
  subscriptionUpdatedAt: string | null;
  shouldCancel: boolean;
  amountArs: number | null;
  completePriceChange: boolean;
}> {
  const parsedReference = parseSubscriptionExternalReference(item.expected_external_reference);
  const organizationId = item.organization_id ?? parsedReference?.organizationId ?? null;
  if (!organizationId) {
    return {
      subscriptionId: null,
      subscriptionUpdatedAt: null,
      shouldCancel: true,
      amountArs: null,
      completePriceChange: false,
    };
  }

  const { data: subscription, error } = await supabaseAdmin
    .from('organization_subscriptions')
    .select('id,updated_at,status,provider,current_plan_code,effective_plan_code,billing_plan_code,billing_amount_ars,pending_plan_code,pending_checkout_amount_ars,pending_checkout_price_version,mercadopago_preapproval_id,mercadopago_status,metadata')
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) throw new Error('COMPENSATION_SUBSCRIPTION_READ_FAILED');
  if (!subscription) {
    return {
      subscriptionId: null,
      subscriptionUpdatedAt: null,
      shouldCancel: true,
      amountArs: null,
      completePriceChange: false,
    };
  }

  const sameActiveProvider = subscription.provider === 'mercadopago' &&
    subscription.status === 'active' &&
    stringValue(subscription.mercadopago_preapproval_id) === item.preapproval_id;
  if (!sameActiveProvider) {
    return {
      subscriptionId: String(subscription.id),
      subscriptionUpdatedAt: stringValue(subscription.updated_at),
      shouldCancel: true,
      amountArs: null,
      completePriceChange: false,
    };
  }

  const subscriptionRow = subscription as Record<string, unknown>;
  const remainsPriceChangeTarget = renewalTargetPlanCode(subscriptionRow) === item.plan_code;
  if (remainsPriceChangeTarget) {
    const batchAmount = numberValue(item.new_amount_ars);
    if (!batchAmount || batchAmount <= 0) throw new Error('COMPENSATION_AMOUNT_MISSING');
    return {
      subscriptionId: String(subscription.id),
      subscriptionUpdatedAt: stringValue(subscription.updated_at),
      shouldCancel: false,
      amountArs: batchAmount,
      completePriceChange: true,
    };
  }

  const metadata = isRecord(subscription.metadata) ? subscription.metadata : {};
  const isScheduledRenewal = Boolean(
    stringValue(subscription.pending_plan_code) &&
    !hasPendingCheckoutIntent(subscriptionRow),
  );
  const amountArs = isScheduledRenewal
    ? numberValue(metadata.scheduled_renewal_amount_ars)
    : numberValue(subscription.billing_amount_ars);
  if (!amountArs || amountArs <= 0) throw new Error('COMPENSATION_AMOUNT_MISSING');

  return {
    subscriptionId: String(subscription.id),
    subscriptionUpdatedAt: stringValue(subscription.updated_at),
    shouldCancel: false,
    amountArs,
    completePriceChange: false,
  };
}

async function compensateProviderAfterLocalChange(
  supabaseAdmin: SupabaseClient,
  item: WorkItem,
): Promise<CompensationResult> {
  let lastStatus: number | null = null;
  let lastCode = 'provider_compensation_failed';
  let lastMessage = 'No se pudo reconciliar Mercado Pago con la intencion local vigente.';
  const baseAttempts = Math.max(item.compensation_attempts, 0);

  for (let offset = 1; offset <= MAX_PROVIDER_ATTEMPTS; offset += 1) {
    const attempts = baseAttempts + offset;
    let intent: Awaited<ReturnType<typeof compensationIntent>>;
    try {
      intent = await compensationIntent(supabaseAdmin, item);
    } catch (error) {
      return {
        ok: false,
        attempts,
        status: lastStatus,
        code: 'compensation_intent_unavailable',
        message: sanitizeMessage(error),
      };
    }

    let providerPayload: Record<string, unknown> | null = null;
    try {
      const readResponse = await mpPlatformFetch(
        `/preapproval/${encodeURIComponent(item.preapproval_id ?? '')}`,
      );
      lastStatus = readResponse.status;
      if (readResponse.status === 404) {
        if (!intent.shouldCancel) {
          return {
            ok: false,
            attempts,
            status: readResponse.status,
            code: 'provider_preapproval_missing',
            message: 'El preapproval vigente no existe en Mercado Pago.',
          };
        }
      } else if (!readResponse.ok) {
        const providerError = await readMpError(readResponse);
        lastCode = sanitizeMessage(providerError.code, lastCode).slice(0, 120);
        lastMessage = sanitizeMessage(providerError.message, lastMessage);
        if (transientStatus(readResponse.status) && offset < MAX_PROVIDER_ATTEMPTS) {
          await wait(retryDelay(readResponse, offset));
          continue;
        }
        return { ok: false, attempts, status: readResponse.status, code: lastCode, message: lastMessage };
      } else {
        providerPayload = await readResponse.json() as Record<string, unknown>;
      }
    } catch (error) {
      lastCode = 'provider_compensation_network_error';
      lastMessage = sanitizeMessage(error);
      if (offset < MAX_PROVIDER_ATTEMPTS) {
        await wait(Math.min(250 * (2 ** Math.max(offset - 1, 0)), 1_500));
        continue;
      }
      return { ok: false, attempts, status: lastStatus, code: lastCode, message: lastMessage };
    }

    if (providerPayload) {
      const providerReference = stringValue(providerPayload.external_reference);
      const parsedReference = parseSubscriptionExternalReference(providerReference);
      const expectedReference = item.expected_external_reference;
      if (
        String(providerPayload.id ?? '') !== item.preapproval_id ||
        !parsedReference ||
        (item.organization_id &&
          parsedReference.organizationId.toLowerCase() !== item.organization_id.toLowerCase()) ||
        !expectedReference ||
        providerReference !== expectedReference
      ) {
        return {
          ok: false,
          attempts,
          status: lastStatus,
          code: 'provider_compensation_ownership_mismatch',
          message: 'No se pudo verificar la propiedad del preapproval a reconciliar.',
        };
      }

      const providerStatus = stringValue(providerPayload.status)?.toLowerCase();
      const alreadyDone = intent.shouldCancel &&
        (providerStatus === 'cancelled' || providerStatus === 'canceled');
      if (!alreadyDone) {
        const body = intent.shouldCancel
          ? { status: 'cancelled' }
          : {
            status: 'authorized',
            auto_recurring: {
              transaction_amount: intent.amountArs,
              currency_id: 'ARS',
            },
          };
        const updateResponse = await mpPlatformFetch(
          `/preapproval/${encodeURIComponent(item.preapproval_id ?? '')}`,
          {
            method: 'PUT',
            headers: { 'X-Idempotency-Key': crypto.randomUUID() },
            body: JSON.stringify(body),
          },
        );
        lastStatus = updateResponse.status;
        if (updateResponse.status === 404 && !intent.shouldCancel) {
          return {
            ok: false,
            attempts,
            status: updateResponse.status,
            code: 'provider_preapproval_missing',
            message: 'El preapproval vigente desaparecio durante la reconciliacion.',
          };
        }
        if (!updateResponse.ok && !(updateResponse.status === 404 && intent.shouldCancel)) {
          const providerError = await readMpError(updateResponse);
          lastCode = sanitizeMessage(providerError.code, lastCode).slice(0, 120);
          lastMessage = sanitizeMessage(providerError.message, lastMessage);
          if (transientStatus(updateResponse.status) && offset < MAX_PROVIDER_ATTEMPTS) {
            await wait(retryDelay(updateResponse, offset));
            continue;
          }
          return { ok: false, attempts, status: updateResponse.status, code: lastCode, message: lastMessage };
        }
      }
    }

    const { data: completion, error: completionError } = await supabaseAdmin.rpc(
      'platform_admin_complete_price_change_compensation',
      {
        _item_id: item.id,
        _expected_idempotency_key: item.idempotency_key,
        _expected_preapproval_id: item.preapproval_id,
        _expected_claimed_at: item.claimed_at,
        _expected_subscription_id: intent.subscriptionId,
        _expected_subscription_updated_at: intent.subscriptionUpdatedAt,
        _should_cancel: intent.shouldCancel,
        _expected_amount_ars: intent.amountArs,
        _complete_price_change: intent.completePriceChange,
        _compensation_attempts: attempts,
        _http_status: lastStatus,
      },
    );
    if (!completionError && completion) {
      return {
        ok: true,
        attempts,
        status: lastStatus,
        completedPriceChange: isRecord(completion) && completion.status === 'succeeded',
      };
    }
    if (
      completionError?.code === '40001' ||
      completionError?.message?.includes('SUBSCRIPTION_CONFLICT') ||
      completionError?.message?.includes('COMPENSATION_INTENT_CHANGED')
    ) {
      continue;
    }
    return {
      ok: false,
      attempts,
      status: lastStatus,
      code: 'compensation_completion_failed',
      message: 'No se pudo confirmar localmente la reconciliacion externa.',
    };
  }

  return {
    ok: false,
    attempts: baseAttempts + MAX_PROVIDER_ATTEMPTS,
    status: lastStatus,
    code: lastCode,
    message: lastMessage,
  };
}

async function processItem(
  supabaseAdmin: SupabaseClient,
  item: WorkItem,
): Promise<ProcessResult> {
  const reconcile = async (): Promise<ProcessResult> => {
    if (!item.requires_compensation) {
      if (!(await requireCompensation(supabaseAdmin, item))) {
        return { itemId: item.id, succeeded: false, status: 'claim_lost' };
      }
    }
    const compensation = await compensateProviderAfterLocalChange(supabaseAdmin, item);
    return compensation.ok
      ? {
        itemId: item.id,
        succeeded: compensation.completedPriceChange,
        status: compensation.completedPriceChange ? 'succeeded' : 'skipped',
      }
      : failCompensation(supabaseAdmin, item, compensation);
  };

  if (item.requires_compensation) return reconcile();

  let mutationKind = item.provider_mutation_kind;
  let mutationSubscriptionId: string | null = null;
  let mutationSubscriptionUpdatedAt: string | null = null;

  if (item.item_type === 'active_renewal') {
    const localTarget = await workItemStillCurrent(supabaseAdmin, item);
    if (!localTarget.current) {
      return item.provider_mutation_started_at
        ? reconcile()
        : skipItem(
          supabaseAdmin,
          item,
          'subscription_changed',
          'La suscripcion o su preapproval cambiaron antes del procesamiento.',
        );
    }
    item.expected_external_reference = localTarget.expectedExternalReference;
    mutationSubscriptionId = localTarget.subscriptionId;
    mutationSubscriptionUpdatedAt = localTarget.subscriptionUpdatedAt;
    if (item.provider_mutation_started_at && mutationKind !== 'set_amount') return reconcile();
    mutationKind = 'set_amount';
  } else {
    const pendingState = await pendingCheckoutState(supabaseAdmin, item);
    const promoted = pendingState.promoted;
    mutationSubscriptionId = pendingState.subscriptionId;
    mutationSubscriptionUpdatedAt = pendingState.subscriptionUpdatedAt;
    if (item.provider_mutation_started_at) {
      if (
        (mutationKind === 'set_amount' && !promoted) ||
        (mutationKind === 'cancel' && promoted) ||
        !mutationKind
      ) return reconcile();
    } else {
      mutationKind = promoted ? 'set_amount' : 'cancel';
    }
  }

  if (item.provider_mutation_started_at && (
    item.provider_mutation_subscription_id !== mutationSubscriptionId ||
    item.provider_mutation_subscription_updated_at !== mutationSubscriptionUpdatedAt
  )) {
    return reconcile();
  }

  if (!item.preapproval_id) {
    return failItem(
      supabaseAdmin,
      item,
      Math.min(item.attempts + 1, MAX_PROVIDER_ATTEMPTS),
      null,
      'missing_preapproval',
      'Falta la referencia de preapproval.',
    );
  }

  const providerTarget = await verifyProviderTarget(supabaseAdmin, item, mutationKind);
  if (providerTarget.kind === 'skip') {
    return skipItem(supabaseAdmin, item, providerTarget.code, providerTarget.message);
  }
  if (providerTarget.kind === 'fail') {
    return failItem(
      supabaseAdmin,
      item,
      Math.min(item.attempts + providerTarget.attempts, MAX_PROVIDER_ATTEMPTS),
      providerTarget.status,
      providerTarget.code,
      providerTarget.message,
    );
  }

  const mutationStart = await startProviderMutation(
    supabaseAdmin,
    item,
    mutationKind,
    mutationSubscriptionId,
    mutationSubscriptionUpdatedAt,
  );
  if (mutationStart === 'subscription_changed') {
    return item.provider_mutation_started_at
      ? reconcile()
      : skipItem(
        supabaseAdmin,
        item,
        'subscription_changed',
        'La suscripcion cambio antes de iniciar la mutacion externa.',
      );
  }
  if (mutationStart !== 'started') {
    return { itemId: item.id, succeeded: false, status: 'claim_lost' };
  }

  let attempts = Math.max(item.attempts, 0);
  let lastStatus: number | null = null;
  let lastCode = 'provider_request_failed';
  let lastMessage = 'Mercado Pago no pudo actualizar la suscripcion.';

  while (attempts < MAX_PROVIDER_ATTEMPTS) {
    attempts += 1;
    try {
      const response = providerTarget.kind === 'done'
        ? new Response(null, { status: providerTarget.status })
        : await mpPlatformFetch(
          `/preapproval/${encodeURIComponent(item.preapproval_id)}`,
          {
            method: 'PUT',
            headers: { 'X-Idempotency-Key': item.idempotency_key },
            body: JSON.stringify(mutationKind === 'cancel'
              ? { status: 'cancelled' }
              : {
                auto_recurring: {
                  transaction_amount: numberValue(item.new_amount_ars),
                  currency_id: 'ARS',
                },
              }),
          },
        );
      lastStatus = response.status;

      if (response.ok || providerTarget.kind === 'done' || (
        mutationKind === 'cancel' && response.status === 404
      )) {
        let providerReference: string | null = null;
        try {
          const payload = await response.json();
          providerReference = isRecord(payload) ? stringValue(payload.id) : null;
        } catch {
          // A successful response does not require a JSON body.
        }

        const { data: completion, error } = await supabaseAdmin.rpc(
          'platform_admin_complete_price_change_item',
          {
            _item_id: item.id,
            _expected_idempotency_key: item.idempotency_key,
            _expected_preapproval_id: item.preapproval_id,
            _expected_claimed_at: item.claimed_at,
            _attempts: attempts,
            _http_status: response.status,
            _provider_response_ref: providerReference,
          },
        );
        if (error) {
          if (error.code === '40001' || error.message?.includes('ITEM_CLAIM_LOST')) {
            return { itemId: item.id, succeeded: false, status: 'claim_lost' };
          }
          throw new Error('ITEM_COMPLETION_WRITE_FAILED');
        }
        if (isRecord(completion) && completion.status === 'compensation_required') {
          item.requires_compensation = true;
          return reconcile();
        }
        return { itemId: item.id, succeeded: true, status: 'succeeded' };
      }

      const providerError = await readMpError(response);
      lastCode = sanitizeMessage(providerError.code, 'provider_error').slice(0, 120);
      lastMessage = sanitizeMessage(providerError.message, 'Mercado Pago rechazo la actualizacion.');
      if (!transientStatus(response.status) || attempts >= MAX_PROVIDER_ATTEMPTS) break;
      await wait(retryDelay(response, attempts));
    } catch (error) {
      const message = sanitizeMessage(error);
      if (message === 'ITEM_COMPLETION_WRITE_FAILED') throw error;
      lastCode = 'provider_network_error';
      lastMessage = message;
      if (attempts >= MAX_PROVIDER_ATTEMPTS) break;
      await wait(Math.min(250 * (2 ** Math.max(attempts - 1, 0)), 1_500));
    }
  }

  return failItem(supabaseAdmin, item, attempts, lastStatus, lastCode, lastMessage);
}

async function processBatch(
  supabaseAdmin: SupabaseClient,
  context: { userId: string },
  batchId: string,
  requestId: string,
) {
  const before = await readBatch(supabaseAdmin, batchId);
  if (!(await assertBatchIsCurrent(supabaseAdmin, before.batch))) {
    throw new Error('STALE_BATCH');
  }

  const { data: claimed, error: claimError } = await supabaseAdmin.rpc(
    'platform_admin_claim_price_change_items',
    { _batch_id: batchId, _limit: PROCESS_LIMIT },
  );
  if (claimError) throw new Error('BATCH_CLAIM_FAILED');

  const batchAmount = numberValue(before.batch.new_amount_ars);
  const workItems = ((claimed ?? []) as Record<string, unknown>[]).map((row) => ({
    ...row,
    id: String(row.id),
    batch_id: String(row.batch_id),
    organization_id: stringValue(row.organization_id),
    subscription_id: stringValue(row.subscription_id),
    preapproval_id: stringValue(row.preapproval_id),
    expected_external_reference: stringValue(row.expected_external_reference),
    item_type: row.item_type === 'pending_checkout' ? 'pending_checkout' : 'active_renewal',
    status: stringValue(row.status) ?? 'processing',
    attempts: numberValue(row.attempts) ?? 0,
    compensation_attempts: numberValue(row.compensation_attempts) ?? 0,
    requires_compensation: row.requires_compensation === true,
    provider_mutation_started_at: stringValue(row.provider_mutation_started_at),
    provider_mutation_kind: row.provider_mutation_kind === 'set_amount' ||
        row.provider_mutation_kind === 'cancel'
      ? row.provider_mutation_kind
      : null,
    provider_mutation_subscription_id: stringValue(row.provider_mutation_subscription_id),
    provider_mutation_subscription_updated_at: stringValue(
      row.provider_mutation_subscription_updated_at,
    ),
    idempotency_key: String(row.idempotency_key),
    claimed_at: String(row.claimed_at),
    plan_code: stringValue(before.batch.plan_code) ?? '',
    new_amount_ars: batchAmount,
  } satisfies WorkItem));

  const results = await mapWithConcurrency(
    workItems,
    PROCESS_CONCURRENCY,
    async (item) => {
      try {
        return await processItem(supabaseAdmin, item);
      } catch (error) {
        console.error(`[platform-admin-price-change] ${requestId}: ${sanitizeMessage(error)}`);
        return failItem(
          supabaseAdmin,
          item,
          Math.min(item.attempts + 1, MAX_PROVIDER_ATTEMPTS),
          null,
          'internal_processing_error',
          'No se pudo confirmar el resultado local.',
        );
      }
    },
  );

  const { error: refreshError } = await supabaseAdmin.rpc(
    'platform_admin_refresh_price_change_batch',
    { _batch_id: batchId },
  );
  if (refreshError) throw new Error('BATCH_REFRESH_FAILED');

  const after = await readBatch(supabaseAdmin, batchId);
  // A concurrent worker may still own `processing` rows. Only advertise work
  // this caller can claim now, otherwise clients can spin in a tight loop.
  const hasMore = (numberValue(after.batch.pending_count) ?? 0) > 0;
  const succeeded = results.filter((result) => result.succeeded).length;
  const failed = results.filter((result) => result.status === 'failed').length;
  const skipped = results.filter((result) => result.status === 'skipped').length;
  const claimLost = results.filter((result) => result.status === 'claim_lost').length;
  const resultStatus: AuditResult = claimLost > 0
    ? (succeeded > 0 || failed > 0 || skipped > 0 ? 'partial' : 'pending')
    : failed > 0
      ? (succeeded > 0 || skipped > 0 ? 'partial' : 'failed')
      : skipped > 0
        ? 'partial'
        : 'succeeded';

  await insertAuditLog(supabaseAdmin, {
    actorUserId: context.userId,
    action: 'subscription_price_change.processed',
    targetType: 'subscription_price_change_batch',
    targetId: batchId,
    resultStatus,
    resultDetail: {
      batchId,
      processed: results.length,
      succeeded,
      failed,
      skipped,
      claimLost,
    },
    requestId,
  });

  return {
    batch: batchDto(after.batch, after.items),
    processed: results.length,
    hasMore,
  };
}

async function retryBatch(
  supabaseAdmin: SupabaseClient,
  context: { userId: string },
  body: PriceBody,
  requestId: string,
) {
  if (!isUuid(body.batchId)) throw new Error('INVALID_BATCH_ID');
  const itemIds = body.itemIds === undefined
    ? null
    : Array.isArray(body.itemIds) && body.itemIds.length <= 50 && body.itemIds.every(isUuid)
      ? body.itemIds
      : undefined;
  if (itemIds === undefined) throw new Error('INVALID_ITEM_IDS');

  const before = await readBatch(supabaseAdmin, body.batchId);
  if (!(await assertBatchIsCurrent(supabaseAdmin, before.batch))) throw new Error('STALE_BATCH');

  const { data: reopened, error } = await supabaseAdmin.rpc(
    'platform_admin_retry_price_change_items',
    { _batch_id: body.batchId, _item_ids: itemIds },
  );
  if (error) throw new Error('BATCH_RETRY_FAILED');

  const { error: refreshError } = await supabaseAdmin.rpc(
    'platform_admin_refresh_price_change_batch',
    { _batch_id: body.batchId },
  );
  if (refreshError) throw new Error('BATCH_REFRESH_FAILED');

  const after = await readBatch(supabaseAdmin, body.batchId);
  await insertAuditLog(supabaseAdmin, {
    actorUserId: context.userId,
    action: 'subscription_price_change.retried',
    targetType: 'subscription_price_change_batch',
    targetId: body.batchId,
    resultStatus: 'pending',
    resultDetail: { batchId: body.batchId, processed: numberValue(reopened) ?? 0 },
    requestId,
  });

  return {
    batch: batchDto(after.batch, after.items),
    reopened: numberValue(reopened) ?? 0,
  };
}

function mutationErrorResponse(req: Request, error: unknown, requestId: string): Response {
  const code = sanitizeMessage(error);
  switch (code) {
    case 'INVALID_PLAN':
    case 'PLAN_NOT_FOUND':
      return jsonError(req, 'Plan invalido.', 400, code, requestId);
    case 'INVALID_PRICE':
      return jsonError(req, 'El importe debe ser un valor ARS positivo.', 400, code, requestId);
    case 'INVALID_REASON':
      return jsonError(req, 'El motivo debe tener entre 10 y 500 caracteres.', 400, code, requestId);
    case 'INVALID_EXPECTED_CATALOG':
    case 'INVALID_BATCH_ID':
    case 'INVALID_ITEM_IDS':
      return jsonError(req, 'Datos de confirmacion invalidos.', 400, code, requestId);
    case 'INVALID_PASSWORD':
    case 'PASSWORD_CONFIRMATION_FAILED':
      return jsonError(req, 'No se pudo confirmar la contrasena.', 400, code, requestId);
    case 'CATALOG_CONFLICT':
    case 'UNFINISHED_BATCH_EXISTS':
    case 'STALE_BATCH':
    case 'PRICE_UNCHANGED':
      return jsonError(req, 'El catalogo cambio o tiene un lote sin resolver. Actualiza antes de continuar.', 409, code, requestId);
    case 'BATCH_NOT_FOUND':
      return jsonError(req, 'Lote no encontrado.', 404, code, requestId);
    default:
      console.error(`[platform-admin-price-change] ${requestId}: ${code}`);
      return jsonError(req, 'No se pudo completar la operacion de precios.', 500, 'PRICE_CHANGE_FAILED', requestId);
  }
}

serve(async (req: Request): Promise<Response> => {
  const requestId = getRequestId(req);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: platformAdminCorsHeaders(req) });
  }
  if (req.method !== 'POST') {
    return jsonError(req, 'Metodo no permitido.', 405, 'METHOD_NOT_ALLOWED', requestId);
  }

  const auth = await getPlatformAdminContext(req, requestId);
  if (auth.error) return auth.error;

  let body: PriceBody;
  try {
    body = await req.json() as PriceBody;
  } catch {
    return jsonError(req, 'JSON invalido.', 400, 'INVALID_JSON', requestId);
  }
  if (typeof body.action !== 'string' || !ACTIONS.includes(body.action as PriceAction)) {
    return jsonError(req, 'Accion invalida.', 400, 'INVALID_ACTION', requestId);
  }

  if (body.action !== 'preview' && !mutationsEnabled()) {
    return jsonError(
      req,
      'Las mutaciones de precios estan temporalmente deshabilitadas.',
      503,
      'MUTATIONS_DISABLED',
      requestId,
    );
  }

  try {
    let data: unknown;
    switch (body.action as PriceAction) {
      case 'preview':
        data = await preview(auth.supabaseAdmin!, body);
        break;
      case 'apply':
        data = await applyPrice(auth.supabaseAdmin!, auth.context!, body, requestId);
        break;
      case 'process':
        if (!isUuid(body.batchId)) throw new Error('INVALID_BATCH_ID');
        data = await processBatch(auth.supabaseAdmin!, auth.context!, body.batchId, requestId);
        break;
      case 'retry':
        data = await retryBatch(auth.supabaseAdmin!, auth.context!, body, requestId);
        break;
    }

    return jsonResponse(
      req,
      { ...(isRecord(data) ? data : { data }), requestId },
      200,
      requestId,
    );
  } catch (error) {
    return mutationErrorResponse(req, error, requestId);
  }
});
