/* Local-only visual/interaction QA. Every remote request is intercepted or aborted.
 * PARTNER_PLAYWRIGHT_PATH optionally locates the bundled runtime's playwright.
 * PARTNER_BROWSER_PATH optionally locates a headless installed Chromium browser.
 */
const { chromium } = require(process.env.PARTNER_PLAYWRIGHT_PATH || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const output = path.resolve('.impeccable/review/partners');
fs.mkdirSync(output, { recursive: true });
const now = new Date().toISOString();
const userId = '11111111-1111-4111-8111-111111111111';
const payoutId = '22222222-2222-4222-8222-222222222222';
const results = [];
async function scenario(browser, name, viewport, role) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  const errors = [];
  const user = {
    id: userId,
    email: 'synthetic@example.invalid',
    email_confirmed_at: now,
    aud: 'authenticated',
    role: 'authenticated',
    created_at: now,
    updated_at: now,
    app_metadata:
      role === 'admin' ? { platform_role: 'platform_admin' } : { account_kind: 'partner' },
    user_metadata: { full_name: 'Aliado de prueba' },
    identities: [],
  };
  if (role)
    await context.addInitScript(
      ({ user, role }) => {
        const payload = {
          sub: user.id,
          aud: 'authenticated',
          role: 'authenticated',
          exp: Math.floor(Date.now() / 1000) + 3600,
          app_metadata: user.app_metadata,
        };
        const enc = (data) =>
          btoa(JSON.stringify(data)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
        const session = {
          access_token: `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}.synthetic`,
          refresh_token: 'synthetic-refresh',
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: payload.exp,
          user,
        };
        if (role === 'admin')
          sessionStorage.setItem('vittro-platform-admin-auth', JSON.stringify(session));
        else localStorage.setItem('sb-azqpyfoobpovqosbayvz-auth-token', JSON.stringify(session));
      },
      { user, role },
    );
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return route.continue();
    if (!url.hostname.endsWith('.supabase.co')) return route.abort();
    const json = (body) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(body),
      });
    if (route.request().method() === 'OPTIONS')
      return route.fulfill({
        status: 204,
        headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' },
      });
    if (url.pathname.endsWith('/auth/v1/user')) return json(user);
    if (url.pathname.endsWith('/functions/v1/partner-program')) {
      const { action } = route.request().postDataJSON();
      if (action === 'status')
        return json({ enabled: true, instagramEnabled: false, termsVersion: '2026-10-14-v2' });
      if (action === 'summary')
        return json({
          summary: {
            id: userId,
            name: 'Aliado de prueba',
            code: 'BARBERCREADOR12345678',
            tier: { percent: 20, source: 'results', qualifiedOrganizations: 5, nextGoal: 20 },
            registrations: 17,
            pendingCents: 9999999900,
            availableCents: 123456789000,
            paidCents: 540000,
            adjustmentsCents: -270000,
            instagram: { connected: false, username: null, followers: null, verifiedAt: null },
            payout: { configured: false, verified: false, lastFour: null },
            commissions: [
              {
                id: payoutId,
                amountCents: 540000,
                status: 'available',
                createdAt: now,
                availableAt: now,
              },
            ],
          },
        });
      if (action === 'admin_summary')
        return json({
          partners: [
            {
              id: userId,
              name: 'Aliado de prueba',
              code: 'CREADOR20',
              percent: 20,
              qualifiedOrganizations: 5,
              registrations: 17,
              availableCents: 9999999900,
              payoutVerified: false,
              suspended: false,
              revision: 'r1',
            },
          ],
          payouts: [
            {
              id: payoutId,
              partnerId: userId,
              name: 'Aliado de prueba',
              amountCents: 9999999900,
              holder: 'Titular sintético',
              taxId: '20123456786',
              account: '0720016920000000010006',
              verified: true,
              status: 'review',
              revision: 'r1',
            },
          ],
          incidents: [],
          totalPartners: 1,
          page: 1,
          pageSize: 25,
        });
      if (action === 'admin_payout_details')
        return json({
          holder: 'Titular sintético',
          taxId: '20123456786',
          account: '0720016920000000010006',
          revision: 'r1',
          verified: false,
        });
      // No monetary mutation is exercised in the visual harness.
      return route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Operación deshabilitada en QA sintético.' }),
      });
    }
    return json([]);
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(
    `http://127.0.0.1:8080/${role === 'admin' ? 'admin/aliados' : role ? 'aliados/panel' : 'aliados'}`,
  );
  await page
    .getByRole('heading', {
      name:
        role === 'admin'
          ? 'Aliados'
          : role
            ? 'Mi código de referidos'
            : 'Generá ingresos con tu código de referidos.',
      exact: true,
    })
    .waitFor();
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  assert.equal(overflow, false, `${name} overflows viewport`);
  if (!role) {
    assert.equal(await page.locator('#condiciones').evaluate(node => node.open),false);
    await page.getByRole('button',{name:/Nivel 2/}).press('Enter');
    assert.equal(await page.getByRole('button',{name:/Nivel 2/}).getAttribute('aria-pressed'),'true');
    await page.locator('summary').press('Enter');
    await page.waitForFunction(()=>document.querySelector('#condiciones').open);
    await page.screenshot({path:path.join(output,`${name}-level-conditions.png`),fullPage:true});
    await page.goto('http://127.0.0.1:8080/aliados#condiciones');
    await page.waitForFunction(()=>document.querySelector('#condiciones')?.open);
  }
  if (role === 'partner') {
    assert.equal(await page.getByRole('button', { name: /Instagram/ }).count(), 0);
    await page.getByRole('heading',{name:'Tu nivel por referidos'}).waitFor();
    await page.getByText('Te faltan 15 barberías calificadas para el nivel 3 y una comisión del 30%.',{exact:true}).waitFor();
    await page.getByRole('button', { name: 'Datos de cobro' }).click();
    await page.getByRole('dialog').waitFor();
    await page.getByRole('button', { name: 'Guardar datos' }).click();
    await page.getByText('Ingresá el titular.').waitFor();
    await page.screenshot({ path: path.join(output, `${name}-payout.png`), fullPage: true });
    const width = await page
      .getByRole('dialog')
      .evaluate((node) => node.getBoundingClientRect().width);
    assert.ok(width <= viewport.width, 'Drawer exceeds screen');
  }
  if (role === 'admin') {
    await page.getByRole('button', { name: 'Convenio', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await page.screenshot({ path: path.join(output, `${name}-agreement.png`), fullPage: true });
  }
  assert.deepEqual(errors, [], `${name} browser errors`);
  results.push({ scenario: name, viewport, overflow, errors, synthetic: true });
  await context.close();
}
async function emailScenario(browser,width) {
  const context=await browser.newContext({viewport:{width,height:880}});
  await context.route('**/*',route=>route.request().url().endsWith('/MagotipoAzul.png')
    ? route.fulfill({contentType:'image/png',body:fs.readFileSync('public/MagotipoAzul.png')}) : route.abort());
  const page=await context.newPage();
  const html=fs.readFileSync('supabase/templates/magic-link.html','utf8');
  assert.equal((html.match(/\{\{ \.ConfirmationURL \}\}/g)||[]).length,2);
  const preview=html.replaceAll('{{ .ConfirmationURL }}','https://preview.invalid/continue');
  fs.writeFileSync(path.join(output,'email-preview.html'),preview);
  await page.setContent(preview,{waitUntil:'load'});
  await page.getByRole('heading',{name:'Tu acceso a Vittro'}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Continuar en Vittro'}).getAttribute('href'),'https://preview.invalid/continue');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:path.join(output,`email-${width}.png`),fullPage:true});
  results.push({scenario:`email-${width}`,viewport:{width,height:880},overflow:false,synthetic:true});
  await context.close();
}
(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PARTNER_BROWSER_PATH
      ? { executablePath: process.env.PARTNER_BROWSER_PATH }
      : {}),
  });
  try {
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
      [768, 1024],
    ]) {
      await scenario(browser, `landing-${width}`, { width, height }, null);
      await scenario(browser, `panel-${width}`, { width, height }, 'partner');
      await scenario(browser, `admin-${width}`, { width, height }, 'admin');
    }
    await emailScenario(browser,680);
    await emailScenario(browser,390);
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ scenarios: results.length, passed: true, output }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
