// Graba docs/assets/demo-frames/*.png del flujo de compra en la tienda de ejemplo (modelo simulado y lento,
// para que se vea el streaming). Luego: python3 scripts/make-gif.py
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { serve } from './serve.mjs';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'docs/assets/demo-frames');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const say = (text) => ({ text });
const call = (name, args, text) => ({ text, calls: [[name, args]] });
const SCRIPT = [
  call('search_products', { query: 'latte' }, 'Busco el latte en el menú.'),
  call('navigate_to', { page: 'producto', slug: 'latte' }, 'Lo abro para personalizarlo a la vista.'),
  call('customize_current_product', { size: 'Grande', options: [{ option: 'avena' }, { option: 'espresso' }, { option: 'vainilla' }] }, 'Grande, con avena y vainilla.'),
  call('add_current_product_to_cart', {}),
  call('checkout', {}, 'Listo. Te llevo a pagar: confirma el pago en la página.'),
  say('¡Pedido pagado! Tu **Latte Grande** con avena y vainilla llega en unos 30 minutos.'),
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const llm = http.createServer((req, res) => {
  if (req.url.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'demo' }] }));
  let body = ''; req.on('data', (d) => (body += d)); req.on('end', async () => {
    const b = JSON.parse(body);
    const step = b.messages.slice(b.messages.findLastIndex((m) => m.role === 'user')).filter((m) => m.role === 'assistant').length;
    const s = SCRIPT[step] ?? say('');
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    await sleep(700);
    for (const w of (s.text ?? '').split(/(?<= )/)) { send({ choices: [{ delta: { content: w } }] }); await sleep(60); }
    (s.calls ?? []).forEach(([name, args], i) => send({ choices: [{ delta: { tool_calls: [{ index: i, id: `c${step}${i}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] }));
    send({ choices: [{ delta: {}, finish_reason: s.calls ? 'tool_calls' : 'stop' }] });
    res.end('data: [DONE]\n\n');
  });
}).listen(1250);
const site = serve(path.join(root, 'docs'), 5181);

const ext = path.join(root, 'extension');
const ctx = await chromium.launchPersistentContext(`/tmp/wmf-rec-${Date.now()}`, {
  headless: true, locale: 'es', ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chromium' }),
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--headless=new', '--lang=es'],
  env: { ...process.env, LANGUAGE: 'es' },
});
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const id = new URL(sw.url()).host;
const opt = await ctx.newPage();
await opt.goto(`chrome-extension://${id}/options/options.html`);
await opt.evaluate(() => chrome.storage.local.set({ settings: { provider: 'lmstudio', assistantName: 'Flow', position: 'left', profiles: { lmstudio: { baseUrl: 'http://localhost:1250/v1' } } } }));
await opt.waitForTimeout(500);
await opt.close();

const page = await ctx.newPage();
await page.setViewportSize({ width: 1440, height: 810 });
await page.goto('http://localhost:5181/demo/');
await page.waitForTimeout(800);
let n = 0;
let recording = true;
const snap = async () => { await page.screenshot({ path: path.join(out, `${String(n++).padStart(4, '0')}.png`) }); };
const loop = (async () => { while (recording) { await snap(); await sleep(180); } })();
await sleep(600);
await page.mouse.click(47, 763); await sleep(700);
await page.keyboard.type('Quiero un latte grande con avena y vainilla, y pagarlo', { delay: 35 });
await sleep(400);
await page.keyboard.press('Enter');
const btn = page.getByRole('button', { name: /Confirmar y pagar/ });
await btn.waitFor({ timeout: 30000 });
await sleep(2600);
await page.mouse.move(400, 300); await btn.hover(); await sleep(500);
await btn.click();
await sleep(500);
await page.waitForFunction(() => location.hash.startsWith('#/order'), null, { timeout: 10000 });
await sleep(1800);
await sleep(4500);
recording = false;
await loop;
console.log(`${n} capturas en ${path.relative(root, out)}`);
await ctx.close(); llm.close(); site.close();
