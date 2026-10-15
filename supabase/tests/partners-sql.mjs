// Execute real migrations against isolated PostgreSQL/WASM, never production.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(resolve('node_modules/.admin-sql-test/node_modules/@electric-sql/pglite/dist/index.js')).href);
const db = await PGlite.create();
const read = file => readFile(file,'utf8').then(value=>value.replace(/\r/g,''));
const foundation = await read('supabase/migrations/20260624120000_subscription_billing_foundation.sql');
const incumbent = await read('supabase/migrations/20260904153000_platform_admin_center.sql');
const table = name => foundation.match(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${name} \\([\\s\\S]*?\\n\\);`))[0];
const func = name => incumbent.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$function\\$;`))[0];
let passed=0;
async function test(name, work){ await work(); console.log(`ok ${++passed} - ${name}`); }
const scalar = async (sql,args=[]) => (await db.query(sql,args)).rows[0];
async function user(kind='partner', meta={}) {
  const id=randomUUID();
  await db.query(`INSERT INTO auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
    VALUES($1,$2,now(),$3,$4)`,[id,`${id}@synthetic.invalid`,JSON.stringify(kind==='partner'?{account_kind:'partner'}:kind==='admin'?{platform_role:'platform_admin'}:{}),
    JSON.stringify({full_name:'Fixture User',country:'AR',business_name:'Fixture Barber',...meta})]);
  return id;
}
async function command(action,actor=null,input={}) {
  return db.transaction(async tx=>{
    await tx.exec('SET LOCAL ROLE service_role');
    return (await tx.query('SELECT partner_program_command(1,$1,$2,$3) AS result',[action,actor,JSON.stringify(input)])).rows[0].result;
  });
}
const mutate = (action, actor, input) => command(action,actor,{requestId:randomUUID(),reason:'Motivo de prueba sintético',...input});
async function enroll(actor,code){ return command('enroll',actor,{code,country:'AR',termsVersion:'2026-10-14-v2'}); }
const denied = (promise,code) => assert.rejects(promise,error=>error.message.includes(code));
async function quoteFor(actor,plan='basico'){
  const {organization_id:organizationId}=await scalar('SELECT organization_id FROM profiles WHERE id=$1',[actor]);
  await db.query(`INSERT INTO organization_subscriptions(organization_id) VALUES($1) ON CONFLICT DO NOTHING`,[organizationId]);
  const row=await scalar(`SELECT code,amount_ars,price_version,updated_at::text AS stamp FROM subscription_plans WHERE code=$1`,[plan]);
  const quote=(await command('prepare_checkout',actor,{organizationId,planCode:plan,catalogAmountArs:row.amount_ars,priceVersion:row.price_version,planUpdatedAt:row.stamp})).quote;
  return {quote,organizationId,plan:row};
}
async function finalize(input,nonce=randomUUID()){
  const sub=await scalar('SELECT id,updated_at::text AS stamp FROM organization_subscriptions WHERE organization_id=$1',[input.organizationId]);
  const preapproval=`mp-${nonce}`; const reference=`sub_${input.organizationId}_${input.plan.code}_${nonce}`;
  const values=[input.organizationId,input.plan.code,input.quote.amountArs,input.plan.price_version,input.plan.stamp,sub.id,sub.stamp,
    preapproval,reference,'https://provider.invalid/checkout','fixture@example.invalid','pending',{pending_partner_quote_id:input.quote.id,
      pending_mercadopago_preapproval_id:preapproval,pending_mercadopago_external_reference:reference},false,input.quote.id,input.plan.amount_ars];
  const result=await db.transaction(async tx=>{await tx.exec('SET LOCAL ROLE service_role');return (await tx.query(`SELECT partner_finalize_checkout(
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) AS result`,values)).rows[0].result;});
  return {...input,preapproval,reference,subscriptionId:result.id,result};
}
async function payment(bound,paidAt='2026-07-01T12:00:00Z',amount=bound.quote.amountArs){
  const id=randomUUID(); const eventId=randomUUID(); const providerId=`p-${id}`;
  await db.query(`UPDATE organization_subscriptions SET status='active',provider='mercadopago',current_plan_code=$2,billing_plan_code=$2,
    mercadopago_preapproval_id=$3,mercadopago_external_reference=$4,last_payment_at=$5,metadata=metadata||$6::jsonb WHERE id=$1`,
    [bound.subscriptionId,bound.plan.code,bound.preapproval,bound.reference,paidAt,JSON.stringify({last_confirmed_mercadopago_preapproval_id:bound.preapproval,
      last_confirmed_mercadopago_external_reference:bound.reference})]);
  await db.query(`INSERT INTO subscription_payments(id,organization_id,subscription_id,plan_code,amount_ars,status,
    mercadopago_payment_id,mercadopago_authorized_payment_id,mercadopago_preapproval_id,period_start,period_end,due_at,paid_at,raw_payload)
    VALUES($1,$2,$3,$4,$5,'approved',$6,$7,$8,$9,$9::timestamptz+interval '1 month',$9,$9,$10)`,
    [id,bound.organizationId,bound.subscriptionId,bound.plan.code,amount,providerId,`ap-${id}`,bound.preapproval,paidAt,JSON.stringify({external_reference:bound.reference})]);
  await db.query(`INSERT INTO mercadopago_subscription_events(id,organization_id,subscription_id,payment_id,processed_at)
    VALUES($1,$2,$3,$4,now())`,[eventId,bound.organizationId,bound.subscriptionId,id]);
  return {id,eventId,providerId};
}
function effect(context){
  const first=context.firstPayment;
  const net=first?.status==='approved'?first.amountCents-first.refundedCents:0;
  const amount=Math.round(net*context.percent/100);
  return {firstPaymentId:first?.id??null,amountCents:amount,qualified:new Set(context.validPaidCycleIds).size>=2,
    adjustmentDeltaCents:Math.min(0,amount-context.commissionPaidCents)-context.adjustmentsRecordedCents};
}
async function observe(p){const {context}=await command('billing_context',null,{eventId:p.eventId});
  assert(context?.firstPayment); await command('apply_billing',null,{eventId:p.eventId,revision:context.revision,effect:effect(context)}); return context;}

try {
  await db.exec(`SET TIME ZONE 'UTC'; CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA storage;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text UNIQUE,email_confirmed_at timestamptz,banned_until timestamptz,
      raw_app_meta_data jsonb DEFAULT '{}'::jsonb,raw_user_meta_data jsonb DEFAULT '{}'::jsonb);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('test.actor',true),'')::uuid$$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$SELECT coalesce(nullif(current_setting('test.claims',true),'')::jsonb,'{}'::jsonb)$$;
    CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,owner_id text);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE TABLE organizations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text,slug text,plan text,timezone text,
      plan_expires_at timestamptz,last_payment_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE TABLE sucursales(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES organizations(id),nombre text,timezone text);
    CREATE TABLE profiles(id uuid PRIMARY KEY REFERENCES auth.users(id),email text NOT NULL,full_name text,organization_id uuid REFERENCES organizations(id),default_sucursal_id uuid,barbero_id uuid);
    CREATE TABLE user_roles(user_id uuid REFERENCES auth.users(id),role text);
    CREATE TABLE user_sucursales(user_id uuid,sucursal_id uuid,organization_id uuid);
    CREATE TABLE barberos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,nombre text,apellido text,sucursal_id uuid,
      comision numeric,tipo_compensacion text,rol_equipo text,roles_equipo text[],fecha_cobro_dia integer,activo boolean);
    ${table('subscription_plans')} ${table('organization_subscriptions')} ${table('subscription_payments')} ${table('mercadopago_subscription_events')}
    ALTER TABLE subscription_plans ADD price_version integer NOT NULL DEFAULT 1;
    ALTER TABLE organization_subscriptions ADD billing_amount_ars numeric(12,2),ADD billing_price_version integer,
      ADD pending_checkout_amount_ars numeric(12,2),ADD pending_checkout_price_version integer;
    ${func('handle_new_user')} ${func('subscription_finalize_checkout')}
    CREATE TRIGGER new_user AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();
    GRANT USAGE ON SCHEMA public,auth,storage TO anon,authenticated,service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public,auth,storage TO service_role;
    REVOKE UPDATE ON auth.users FROM service_role;
    INSERT INTO subscription_plans(code,name,amount_ars,sort_order) VALUES('basico','Basico',30000,1),('premium','Premium',50000,2);
  `);
  for (const file of ['20261014130000_partner_program.sql','20261014130100_partner_auth.sql','20261014130200_partner_checkout_storage.sql','20261014130300_partner_auth_lock.sql','20261014130400_partner_identity_intent.sql','20261014230000_partner_referral_levels.sql']) {
    await db.transaction(tx=>read(`supabase/migrations/${file}`).then(sql=>tx.exec(sql)));
  }
  await test('new functions are invoker and all 20 tables have RLS',async()=>{
    assert.equal((await scalar(`SELECT count(*)::int n FROM pg_proc WHERE proname LIKE 'partner_%' AND prosecdef`)).n,0);
    assert.equal((await scalar(`SELECT count(*)::int n FROM pg_class WHERE relname IN ('partners','partner_program_config','partner_agreements',
      'partner_instagram_accounts','partner_instagram_credentials','partner_oauth_states','partner_payout_accounts','partner_referrals',
      'partner_checkout_quotes','partner_payment_receipts','partner_commissions','partner_adjustments','partner_payout_batches',
      'partner_payout_items','partner_payout_entries','partner_incidents','partner_jobs','partner_public_limits','partner_operations','partner_identity_intents') AND relrowsecurity`)).n,20);
  });
  await test('anon and tenant roles cannot execute any privileged partner helper',async()=>{
    for(const role of ['anon','authenticated']) await db.transaction(async tx=>{
      await tx.exec(`SET LOCAL ROLE ${role}`);
      await assert.rejects(tx.query(`SELECT partner_program_command(1,'readiness',null,'{}')`),/permission denied/);
    });
  });
  await test('default readiness is closed',async()=>assert.equal((await command('readiness')).ready,false));
  await db.exec('UPDATE partner_program_config SET enrollment_enabled=true,billing_ready=true');
  const admin=await user('admin'); const creator=await user(); const second=await user();
  const partner=await enroll(creator,'CREADOR1'); const other=await enroll(second,'CREADOR2');
  await test('external Auth identities have profile but no organization, owner role or trial',async()=>{
    assert.equal((await scalar('SELECT organization_id FROM profiles WHERE id=$1',[creator])).organization_id,null);
    assert.equal((await scalar('SELECT count(*)::int n FROM user_roles WHERE user_id=$1',[creator])).n,0);
    assert.equal((await scalar('SELECT count(*)::int n FROM organizations')).n,0);
  });
  await test('one-use identity intent survives GoTrue INSERT-before-app-metadata order without provisioning a tenant',async()=>{
    const id=randomUUID();const email=`${id}@synthetic.invalid`;
    const nonce=await db.transaction(async tx=>{await tx.exec('SET LOCAL ROLE service_role');return (await tx.query(
      'SELECT partner_begin_identity($1) AS nonce',[email])).rows[0].nonce;});
    await db.query(`INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) VALUES($1,$2,'{"provider":"email"}',$3)`,
      [id,email,JSON.stringify({full_name:'Native Order Fixture',partner_signup_nonce:nonce})]);
    await db.query(`UPDATE auth.users SET raw_app_meta_data=raw_app_meta_data||'{"account_kind":"partner"}',email_confirmed_at=now() WHERE id=$1`,[id]);
    const profile=await scalar('SELECT organization_id,default_sucursal_id FROM profiles WHERE id=$1',[id]);
    assert.equal(profile.organization_id,null); assert.equal(profile.default_sucursal_id,null);
    assert.equal((await scalar('SELECT count(*)::int n FROM organizations')).n,0);
    assert.equal((await scalar('SELECT count(*)::int n FROM partner_identity_intents WHERE nonce=$1',[nonce])).n,0);
    await denied(user('owner',{partner_signup_nonce:nonce}),'INVALID_PARTNER_IDENTITY_INTENT');
    await denied(user('owner',{partner_signup_nonce:randomUUID()}),'INVALID_PARTNER_IDENTITY_INTENT');
    await db.transaction(async tx=>{await tx.exec('SET LOCAL ROLE authenticated');await assert.rejects(
      tx.query('SELECT partner_begin_identity($1)',[email]),/permission denied/);});
  });
  await test('code uniqueness and actor identity are enforced',async()=>{
    await denied(enroll(second,'CREADOR1'),'ALREADY_ENROLLED');
    await denied(enroll(await user(),'creador1'),'CODE_TAKEN');
    const invalid=await user(); await db.query('UPDATE auth.users SET email_confirmed_at=null WHERE id=$1',[invalid]);
    await denied(enroll(invalid,'INVALID1'),'UNAUTHORIZED');
  });
  const owner=await user('owner',{referral_code:'creador1'}); const ownerTwo=await user('owner',{referral_code:'CREADOR2'});
  await test('native signup attaches exactly one referral to the initial branch',async()=>{
    const {rows}=await db.query('SELECT r.*,p.default_sucursal_id FROM partner_referrals r JOIN profiles p ON p.organization_id=r.organization_id WHERE p.id=$1',[owner]);
    assert.equal(rows.length,1);assert.equal(rows[0].partner_id,partner.id);assert.equal(rows[0].sucursal_id,rows[0].default_sucursal_id);
    assert.equal((await scalar('SELECT count(*)::int n FROM user_roles WHERE user_id=$1 AND role=$2',[owner,'owner'])).n,1);
  });
  await test('an invalid code rolls back the entire signup transaction',async()=>{
    const before=(await scalar('SELECT count(*)::int n FROM auth.users')).n;
    await denied(user('owner',{referral_code:'MISSING'}),'INVALID_REFERRAL');
    assert.equal((await scalar('SELECT count(*)::int n FROM auth.users')).n,before);
    await denied(user('owner',{referral_code:'CREADOR1',country:'MX'}),'INVALID_REFERRAL');
  });
  await test('only owner clients can enroll and no retroactive attribution action exists',async()=>{
    assert((await enroll(owner,'CLIENTE1')).id);
    const barber=await user('owner'); await db.query('UPDATE user_roles SET role=$2 WHERE user_id=$1',[barber,'barber']);
    await denied(enroll(barber,'BARBER1'),'NOT_OWNER');
    await denied(command('attach_referral',owner,{code:'CREADOR1'}),'INVALID_ACTION');
  });
  await test('summary keeps identities, bank details and tenant data out of the other actor scope',async()=>{
    const a=(await command('summary',creator)).summary; const b=(await command('summary',second)).summary;
    assert.equal(a.registrations,1);assert.equal(b.registrations,1);assert.notEqual(a.id,b.id);
    assert(!JSON.stringify(a).includes(owner));assert(!JSON.stringify(a).includes('organization'));
    await denied(command('admin_summary',creator),'FORBIDDEN');
  });
  const firstQuote=await quoteFor(owner); const secondQuote=await quoteFor(ownerTwo);
  await test('intro quote applies ten percent after exact catalog and ownership checks',async()=>{
    assert.equal(firstQuote.quote.amountArs,27000);assert.equal(firstQuote.quote.percent,10);
    await denied(command('prepare_checkout',second,{organizationId:firstQuote.organizationId,planCode:'basico'}),'FORBIDDEN');
    const stale={...firstQuote.plan,amount_ars:1};
    await denied(command('prepare_checkout',owner,{organizationId:firstQuote.organizationId,planCode:'basico',catalogAmountArs:stale.amount_ars,
      priceVersion:stale.price_version,planUpdatedAt:stale.stamp}),'REVISION_CONFLICT');
  });
  const bound=await finalize(firstQuote); await finalize(secondQuote);
  await test('finalize preserves catalog price while binding an immutable discounted intent',async()=>{
    assert.equal(Number(bound.result.pending_checkout_amount_ars),27000);
    assert.equal(Number((await scalar(`SELECT amount_ars FROM subscription_plans WHERE code='basico'`)).amount_ars),30000);
    const q=await scalar('SELECT status,preapproval_id FROM partner_checkout_quotes WHERE id=$1',[firstQuote.quote.id]);
    assert.equal(q.status,'bound');assert.equal(q.preapproval_id,bound.preapproval);
  });
  await test('a stale catalog snapshot cannot be finalized',async()=>{
    const local=await quoteFor(await user('owner',{referral_code:'CREADOR1'}));
    await db.exec(`UPDATE subscription_plans SET updated_at=now()+interval '1 second' WHERE code='basico'`);
    await denied(finalize(local),'CATALOG_CONFLICT');
    await db.exec(`UPDATE subscription_plans SET updated_at=now()-interval '1 second' WHERE code='basico'`);
  });
  const paid=await payment(bound); await observe(paid);
  await test('registration and checkout alone create no commissions; a confirmed payment creates one',async()=>{
    assert.equal((await scalar('SELECT count(*)::int n FROM partner_commissions')).n,1);
    const row=await scalar('SELECT amount_cents,status,available_at FROM partner_commissions WHERE first_payment_id=$1',[paid.id]);
    assert.equal(Number(row.amount_cents),270000);assert.equal(row.status,'available');
  });
  await test('duplicates and stale revisions cannot duplicate or forge commission values',async()=>{
    await observe(paid);await observe(paid);
    assert.equal((await scalar('SELECT count(*)::int n FROM partner_commissions')).n,1);
    const {context}=await command('billing_context',null,{eventId:paid.eventId});
    await denied(command('apply_billing',null,{eventId:paid.eventId,revision:context.revision,effect:{...effect(context),amountCents:999999}}),'INVALID_EFFECT');
    await denied(command('apply_billing',null,{eventId:paid.eventId,revision:'stale',effect:effect(context)}),'REVISION_CONFLICT');
  });
  await test('qualifying cycles are distinct and refunds remove that progress',async()=>{
    const retry=await payment(bound,'2026-07-15T12:00:00Z',30000);await observe(retry);
    assert.equal((await scalar('SELECT qualified FROM partner_referrals WHERE organization_id=$1',[bound.organizationId])).qualified,false);
    const renewal=await payment(bound,'2026-08-01T12:00:00Z',30000);await observe(renewal);
    assert.equal((await scalar('SELECT qualified FROM partner_referrals WHERE organization_id=$1',[bound.organizationId])).qualified,true);
    await command('sync_payment',null,{paymentId:renewal.id,providerPaymentId:renewal.providerId,status:'refunded',refundedCents:3000000});
    const {context}=await command('billing_context',null,{paymentId:renewal.id});
    await command('apply_billing',null,{paymentId:renewal.id,revision:context.revision,effect:effect(context)});
    assert.equal((await scalar('SELECT qualified FROM partner_referrals WHERE organization_id=$1',[bound.organizationId])).qualified,false);
  });
  const bank={holder:'Fixture Holder',taxId:'20123456786',account:'2850590940090418135201'};
  await test('bank checksum validation and first account verification are independent',async()=>{
    assert.equal((await scalar('SELECT partner_check_payout($1,$2,$3) ok',Object.values(bank))).ok,true);
    await command('save_payout',creator,bank);assert.equal((await command('summary',creator)).summary.payout.verified,false);
    const details=await command('admin_payout_details',admin,{partnerId:partner.id});
    const result=await mutate('admin_verify_payout',admin,{partnerId:partner.id,revision:details.revision});assert.equal(result.verified,true);
  });
  await test('payout preparation cannot allocate a commission twice',async()=>{
    const first=await mutate('admin_prepare_payouts',admin,{}); const second=await mutate('admin_prepare_payouts',admin,{});
    assert.equal(first.items,1);assert.equal(second.items,0);assert.equal((await scalar('SELECT count(*)::int n FROM partner_payout_entries')).n,1);
  });
  await test('mark paid requires a receipt and is idempotent under its operation key',async()=>{
    const row=await scalar('SELECT * FROM partner_payout_items WHERE partner_id=$1',[partner.id]);
    const requestId=randomUUID();const receiptPath=`partner-payouts/${row.id}/${requestId}.pdf`;
    const input={payoutId:row.id,revision:String(row.revision),reference:'SYNTHETIC-TRANSFER',receiptPath,requestId,reason:'Transferencia sintética para prueba'};
    const failed=await mutate('admin_mark_paid',admin,input);assert.equal(failed.code,'INVALID_RECEIPT');
    input.requestId=randomUUID();input.receiptPath=`partner-payouts/${row.id}/${input.requestId}.pdf`;
    await db.query('INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES($1,$2,$3)',['partner-payout-receipts',input.receiptPath,admin]);
    assert.equal((await mutate('admin_mark_paid',admin,input)).paid,true);
    assert.equal((await mutate('admin_mark_paid',admin,input)).paid,true);
    assert.equal((await scalar('SELECT count(*)::int n FROM partner_payout_items WHERE status=$1',['paid'])).n,1);
  });
  await test('partial then full refunds after payout produce only incremental adjustments',async()=>{
    await command('sync_payment',null,{paymentId:paid.id,providerPaymentId:paid.providerId,status:'approved',refundedCents:1350000});
    let {context}=await command('billing_context',null,{paymentId:paid.id});
    await command('apply_billing',null,{paymentId:paid.id,revision:context.revision,effect:effect(context)});
    ({context}=await command('billing_context',null,{paymentId:paid.id}));
    await command('apply_billing',null,{paymentId:paid.id,revision:context.revision,effect:effect(context)});
    assert.equal(Number((await scalar('SELECT sum(delta_cents) amount FROM partner_adjustments')).amount),-135000);
    await command('sync_payment',null,{paymentId:paid.id,providerPaymentId:paid.providerId,status:'charged_back',refundedCents:2700000});
    ({context}=await command('billing_context',null,{paymentId:paid.id}));
    await command('apply_billing',null,{paymentId:paid.id,revision:context.revision,effect:effect(context)});
    assert.equal(Number((await scalar('SELECT sum(delta_cents) amount FROM partner_adjustments')).amount),-270000);
    assert.equal((await scalar('SELECT intro_consumed FROM partner_referrals WHERE organization_id=$1',[bound.organizationId])).intro_consumed,true);
  });
  await test('worker leases are exclusive and retries preserve durable work',async()=>{
    const first=await command('claim_jobs',null,{limit:25});const second=await command('claim_jobs',null,{limit:25});
    assert(first.jobs.length>0);assert(!second.jobs.some(b=>first.jobs.some(a=>a.id===b.id)));
    const job=first.jobs[0];await denied(command('complete_job',null,{jobId:job.id,lease:randomUUID()}),'REVISION_CONFLICT');
    await command('retry_job',null,{jobId:job.id,lease:job.lease});
    assert.equal((await scalar('SELECT status FROM partner_jobs WHERE id=$1',[job.id])).status,'pending');
  });
  await test('retired Instagram cannot connect, verify, improve the rate or schedule refresh work',async()=>{
    const hash='a'.repeat(44);
    await denied(command('instagram_state',creator,{hash}),'INSTAGRAM_RETIRED');
    await denied(command('instagram_verified',creator,{accountId:'1789001',followers:50000}),'INSTAGRAM_RETIRED');
    await db.query(`INSERT INTO partner_instagram_accounts(partner_id,account_id,username,followers,verified_at)
      VALUES($1,'1789001','historical-fixture',50000,now())`,[partner.id]);
    assert.equal((await scalar('SELECT partner_rate($1) rate',[partner.id])).rate,10);
    assert.equal((await scalar('SELECT partner_tier_input($1) input',[partner.id])).input.instagram,undefined);
    await command('claim_jobs',null,{limit:25});
    assert.equal((await scalar("SELECT count(*)::int n FROM partner_jobs WHERE kind='instagram'")).n,0);
    await command('instagram_disconnect',creator,{});
    assert.equal((await scalar('SELECT count(*)::int n FROM partner_instagram_credentials WHERE partner_id=$1',[partner.id])).n,0);
    assert.equal((await scalar('SELECT partner_rate($1) rate',[partner.id])).rate,10);
  });
  await test('agreements honor revision, exclusivity and terminal operation fingerprints',async()=>{
    const {revision}=await scalar('SELECT revision FROM partners WHERE id=$1',[partner.id]);
    const input={partnerId:partner.id,revision:String(revision),percent:100,startsAt:'2026-01-01',endsAt:'2099-01-01',requestId:randomUUID(),reason:'Acuerdo sintético personalizado'};
    assert.equal((await mutate('admin_agreement',admin,input)).saved,true);
    assert.equal((await scalar('SELECT partner_rate($1) rate',[partner.id])).rate,100);
    assert.equal((await mutate('admin_agreement',admin,{...input,percent:90})).code,'REQUEST_CONFLICT');
  });
  await test('tenant users cannot read even their own raw financial platform tables',async()=>{
    for(const role of ['anon','authenticated']) await db.transaction(async tx=>{
      await tx.exec(`SET LOCAL ROLE ${role}`);await assert.rejects(tx.query('SELECT * FROM partners'),/permission denied/);
    });
  });
  await test('branch ownership is a composite FK and cannot be crossed by a privileged buggy caller',async()=>{
    const a=await scalar('SELECT organization_id,default_sucursal_id FROM profiles WHERE id=$1',[owner]);
    const b=await scalar('SELECT organization_id,default_sucursal_id FROM profiles WHERE id=$1',[ownerTwo]);
    await assert.rejects(db.query('UPDATE partner_referrals SET sucursal_id=$1 WHERE organization_id=$2',[b.default_sucursal_id,a.organization_id]),/foreign key/);
  });
  await test('a future provider timestamp queues a replay instead of losing the first commission',async()=>{
    const futureOwner=await user('owner',{referral_code:'CREADOR2'});
    const future=await finalize(await quoteFor(futureOwner));
    const pay=await payment(future,'2099-01-01T12:00:00Z');
    assert.equal((await command('billing_context',null,{eventId:pay.eventId})).context,null);
    assert.equal((await scalar('SELECT count(*)::int n FROM partner_jobs WHERE dedupe_key=$1',[`event:${pay.eventId}`])).n,1);
  });
  await test('permissive legacy Storage policies cannot expose or overwrite partner receipts',async()=>{
    await db.exec(`GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO anon,authenticated;
      CREATE POLICY legacy_all ON storage.objects FOR ALL TO anon,authenticated USING(true) WITH CHECK(true);`);
    await db.transaction(async tx=>{
      await tx.exec('SET LOCAL ROLE authenticated');
      assert.equal((await tx.query("SELECT count(*)::int n FROM storage.objects WHERE bucket_id='partner-payout-receipts'")).rows[0].n,0);
    });
    await db.transaction(async tx=>{
      await tx.exec(`SET LOCAL ROLE authenticated; SET LOCAL test.claims='{"app_metadata":{"platform_role":"platform_admin"}}';`);
      assert.equal((await tx.query("SELECT count(*)::int n FROM storage.objects WHERE bucket_id='partner-payout-receipts'")).rows[0].n,1);
      assert.equal((await tx.query("UPDATE storage.objects SET name='overwrite.pdf' WHERE bucket_id='partner-payout-receipts' RETURNING name")).rows.length,0);
    });
  });
  console.log(`${passed} SQL tests passed; no production connection used.`);
} finally { await db.close(); }
