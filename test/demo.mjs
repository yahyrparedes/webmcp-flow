import { chromium } from 'playwright';
// Flujo completo de compra con un modelo simulado (un dialecto por proveedor):
// búsqueda → navigate_to producto → tools contextuales → personalizar → carrito → checkout con clic humano
// en "Confirmar y pagar" → llamadas en paralelo + error de tool.
//   node test/demo.mjs <lmstudio|gemini|groq|anthropic>
// Por defecto usa la tienda de ejemplo docs/demo (Café Juanito). DEMO_URL=http://localhost:5173/ la cambia por
// otra web con el mismo contrato de tools (p. ej. la demo mcp-web).
import path from 'node:path';
import { start, log, problems } from './mock-dialects.mjs';
import { serve } from '../scripts/serve.mjs';
const here = import.meta.dirname;
const ext = path.resolve(here, '../extension');
const shop = process.env.DEMO_URL ? null : serve(path.resolve(here, '../docs'), 5180);
const demoUrl = process.env.DEMO_URL || 'http://localhost:5180/demo/';
const dialect = process.argv[2] || 'lmstudio';
const port = { lmstudio: 1236, gemini: 1237, groq: 1238, anthropic: 1239 }[dialect];
const script = [
  [ // turno 0: pedido completo
    { text: 'Busco el latte.', calls: [['search_products', { query: 'latte' }]], needs: ['search_products', 'navigate_to'] },
    { calls: [['navigate_to', { page: 'producto', slug: 'latte' }]] },
    { calls: [['customize_current_product', { size: 'Grande', options: [{ option: 'avena' }, { option: 'espresso' }] }]], needs: ['customize_current_product', 'add_current_product_to_cart'] },
    { calls: [['add_current_product_to_cart', {}]] },
    { text: 'Te llevo a pagar.', calls: [['checkout', {}]] },
    { text: 'Listo, pedido pagado.', check: (b) => (/pagado/.test(b.messages.at(-1).content) ? null : 'checkout no devolvió pagado: ' + b.messages.at(-1).content.slice(0, 200)) },
  ],
  [ // turno 1: llamadas en paralelo + error de tool
    { calls: [['view_cart', {}], ['get_delivery_info', {}], ['get_order_status', {}]] },
    { calls: [['add_to_cart', { slug: 'no-existe' }]], check: (b) => (b.messages.filter((m) => m.role === 'tool').slice(-3).length === 3 ? null : 'faltan respuestas paralelas') },
    { text: 'Ese producto no existe.', check: (b) => (/error/.test(b.messages.at(-1).content) ? null : 'el error no llegó al modelo') },
  ],
];
const srv = start(port, dialect, script);
const ctx = await chromium.launchPersistentContext('/tmp/wmf-demo-' + Date.now(), {
  headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chromium' }),
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--headless=new'],
});
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const errors = [];
const id = new URL(sw.url()).host;
const ext_page = await ctx.newPage();
await ext_page.goto(`chrome-extension://${id}/options/options.html`);
await ext_page.evaluate(async ([dialect, port]) => {
  // gemini y lmstudio usan el formato de ajustes de la v0.1 (campos sueltos) para probar la migración;
  // groq y anthropic, el formato nuevo con perfiles por proveedor.
  const base = (p) => `http://localhost:${port}${p}`;
  const settings = {
    gemini: { provider: 'gemini', apiKey: 'AIzaFAKEKEY123', model: 'gemini-3.8-flash', baseUrl: base('/v1beta/openai'), assistantName: 'Flow' },
    lmstudio: { provider: 'lmstudio', apiKey: '', model: '', baseUrl: base('/v1'), assistantName: 'Flow' },
    groq: { provider: 'groq', assistantName: 'Flow', profiles: { groq: { apiKey: 'gsk_FAKE', baseUrl: base('/openai/v1') }, gemini: { apiKey: 'AIzaOTRA' } } },
    anthropic: { provider: 'anthropic', assistantName: 'Flow', profiles: { anthropic: { apiKey: 'sk-ant-FAKE', baseUrl: base('/v1') } } },
  }[dialect];
  await chrome.storage.local.set({ settings });
}, [dialect, port]);
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('page: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`console.${m.type()}: ${m.text()}`); });
await page.setViewportSize({ width: 1280, height: 800 });
await page.goto(demoUrl);
await page.waitForTimeout(1500);
const st = async () => ext_page.evaluate(async () => Object.values(await chrome.storage.session.get()).find((x) => x.ui) ?? null);
const waitIdle = async (ms = 30000) => { const t = Date.now(); await page.waitForTimeout(800); while (Date.now() - t < ms) { const s = await st(); if (s && !s.busy) return s; await page.waitForTimeout(300); } return st(); };
await page.mouse.click(47, 753); await page.waitForTimeout(400);
await page.keyboard.type('Quiero un latte grande con avena y pagarlo'); await page.keyboard.press('Enter');
// paso humano: confirmar pago
const btn = page.getByRole('button', { name: /Confirmar y pagar/ });
await btn.first().waitFor({ timeout: 25000 }).then(async () => { await page.waitForTimeout(500); await page.waitForTimeout(1200); await page.screenshot({ path: path.join(here, `shot-demo-${dialect}-checkout.png`) }); await btn.first().click(); }).catch((e) => problems.push('no apareció Confirmar y pagar: ' + e.message.split('\n')[0]));
let s = await waitIdle();
await page.screenshot({ path: path.join(here, `shot-demo-${dialect}-1.png`) });
console.log('URL tras turno 1:', page.url());
const s0 = await st(); console.log('chat abierto tras navegar:', s0.open); if (!s0.open) { await page.mouse.click(47, 753); } else { await page.mouse.click(186, 684); }
await page.waitForTimeout(300);
await page.keyboard.type('Revisa mi carrito y la entrega'); await page.keyboard.press('Enter');
s = await waitIdle();
await page.screenshot({ path: path.join(here, `shot-demo-${dialect}-2.png`) });
console.log('UI:', s.ui.map((i) => `${i.type}${i.name ? ':' + i.name : ''}${i.status ? '[' + i.status + '] ' + JSON.stringify(i.input) + ' => ' + String(i.output).slice(0,160) : ''}${i.text ? ' «' + i.text.slice(0, 80) + '»' : ''}`).join('\n    '));
console.log('requests:', log.length, '| stream_options:', JSON.stringify(log[0]?.stream_options), '| usage en log:', s.log?.filter((e) => e.kind === 'llm').map((e) => e.response?.usage?.total_tokens ?? '-').join(','));
console.log('tools 1ra req:', log[0]?.tools?.length, log[0]?.tools?.map((t) => t.function?.name ?? t.name).join(','));
console.log('PROBLEMAS:', problems);
console.log('ERRORES:', errors.filter((e) => !/Download the React DevTools/.test(e)));
await ctx.close(); srv.close(); shop?.close();
if (problems.length || !s.ui.some((i) => i.name === 'checkout' && i.status === 'ok')) { console.error(`FALLÓ demo (${dialect})`); process.exit(1); }
console.log(`OK demo (${dialect})`);
