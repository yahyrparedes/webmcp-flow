import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { start, requests } from './mock-llm.mjs';
// Prueba rápida: sitio "Autos Juanito" + modelo simulado. Recorre búsqueda → ficha → tool contextual → favoritos.
const here = import.meta.dirname;
const ext = path.resolve(here, '../extension');
const llm = start(1235);
const site = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end(fs.readFileSync(path.join(here, 'site.html'))); }).listen(4000);
const ctx = await chromium.launchPersistentContext('/tmp/wmf-profile-' + Date.now(), {
  headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chromium' }),
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--headless=new'],
});
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const id = new URL(sw.url()).host;
const errors = [];
const opt = await ctx.newPage();
opt.on('pageerror', (e) => errors.push('options: ' + e.message));
await opt.goto(`chrome-extension://${id}/options/options.html`);
await opt.check('input[value=lmstudio]');
await opt.fill('input[name=assistantName]', 'Juanito Bot');
await opt.fill('input[name=baseUrl]', 'http://localhost:1235/v1');
await opt.fill('input[name=model]', 'mock-model');
await opt.click('#test'); await opt.waitForTimeout(500);
console.log('test conexión:', await opt.textContent('#testResult'));
await opt.click('button[type=submit]'); await opt.waitForTimeout(300);
await opt.screenshot({ path: path.join(here, 'shot-options.png'), fullPage: true });

const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('page: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.setViewportSize({ width: 1280, height: 800 });
await page.goto('http://localhost:4000/');
await page.waitForTimeout(800);
// El shadow root es cerrado: interactuamos por coordenadas/teclado.
await page.mouse.click(47, 800 - 47);
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(here, 'shot-open.png') });
await page.keyboard.type('Agrega a favoritos el sedán más barato');
await page.keyboard.press('Enter');
await page.waitForFunction(() => document.getElementById('favs').textContent === 'Favoritos: 1', null, { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1200);
const favText = await page.textContent('#favs');
console.log('favs:', favText);
await page.screenshot({ path: path.join(here, 'shot-chat.png') });
// abrir consola: botón ">_" del header del panel
await page.mouse.click(20 + 380 - 10 - 30*3 - 15, 800 - 86 - 600 + 25);
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(here, 'shot-console.png') });
console.log('requests al modelo:', requests.length, '| tools en 1ra:', requests[0]?.tools?.map(t=>t.function.name).join(','));
console.log('schema limpio:', JSON.stringify(requests[0]?.tools?.[0]?.function?.parameters));
console.log('último:', JSON.stringify(requests.at(-1)?.messages?.slice(-2)));
// persistencia tras recarga
await page.reload(); await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(here, 'shot-reload.png') });
await page.mouse.click(600, 179); await page.waitForTimeout(300); await page.screenshot({ path: path.join(here, 'shot-expand.png') });
console.log('errores:', errors);
await ctx.close(); llm.close(); site.close();
const favs = favText === 'Favoritos: 1';
if (errors.length || !favs) { console.error('FALLÓ la prueba rápida'); process.exit(1); }
console.log('OK prueba rápida');
