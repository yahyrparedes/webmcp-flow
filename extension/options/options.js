import { DEFAULT_SETTINGS, PROVIDERS, profileOf, resolveConfig } from '../src/llm.js';
import { getSites, removeSite, siteFor, siteLabel } from '../src/sites.js';
import { t, translatePage } from '../src/i18n-dom.js';

translatePage();

const form = document.getElementById('form');
const $ = (n) => form.elements[n];
const testResult = document.getElementById('testResult');
const saved = document.getElementById('saved');

// Textos de ayuda por proveedor (claves de _locales).
const cap = (p) => p[0].toUpperCase() + p.slice(1);
const HELP = Object.fromEntries(Object.keys(PROVIDERS).map((p) => [p, { url: t(`helpUrl${cap(p)}`), model: t(`helpModel${cap(p)}`) }]));

const { settings } = await chrome.storage.local.get('settings');
const s = { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
// Perfiles por proveedor (key, modelo, URL); se migran los ajustes sueltos de la v0.1.
const profiles = {};
for (const p of Object.keys(PROVIDERS)) profiles[p] = { apiKey: '', model: '', baseUrl: '', ...profileOf(s, p) };

for (const k of ['assistantName', 'style', 'position', 'temperature']) $(k).value = s[k] ?? '';
let current = s.provider in PROVIDERS ? s.provider : 'gemini';
form.querySelector(`input[name=provider][value="${current}"]`).checked = true;
showProvider(current);

form.addEventListener('change', (e) => {
  if (e.target.name !== 'provider') return;
  keepFields();
  current = e.target.value;
  showProvider(current);
  testResult.textContent = '';
});

function keepFields() {
  profiles[current] = { apiKey: $('apiKey').value.trim(), model: $('model').value.trim(), baseUrl: $('baseUrl').value.trim() };
}

function showProvider(p) {
  const def = PROVIDERS[p];
  const prof = profiles[p];
  $('apiKey').value = prof.apiKey ?? '';
  $('model').value = prof.model || def.model;
  $('baseUrl').value = prof.baseUrl || def.baseUrl;
  $('apiKey').placeholder = def.keyHint ?? '';
  $('model').placeholder = def.model || (p === 'lmstudio' ? t('phModelLoaded') : t('phModelName'));
  $('baseUrl').placeholder = def.baseUrl || 'https://api.ejemplo.com/v1';
  form.querySelector('[data-key]').hidden = p === 'lmstudio';
  document.getElementById('keyName').textContent = p === 'custom' ? t('optKeyOwn') : def.label;
  const where = document.getElementById('keyWhere');
  where.innerHTML = def.keyUrl ? t('optKeyWhere', `<a href="${def.keyUrl}" target="_blank" rel="noopener">${new URL(def.keyUrl).host}</a>`) : '';
  document.getElementById('urlHint').textContent = HELP[p].url;
  document.getElementById('modelHint').textContent = HELP[p].model;
  document.getElementById('models').innerHTML = '';
  queueMicrotask(updatePermNotice); // después de que el módulo termine de cargar
}

function read() {
  keepFields();
  const out = {
    assistantName: $('assistantName').value.trim() || DEFAULT_SETTINGS.assistantName,
    style: $('style').value.trim(),
    position: $('position').value,
    provider: current,
    temperature: Number($('temperature').value) || 0,
    profiles: {},
  };
  // Solo se guarda lo que difiere del valor por defecto (así, si cambia un default, se aplica solo).
  for (const [p, prof] of Object.entries(profiles)) {
    const def = PROVIDERS[p];
    const keep = {};
    if (prof.apiKey) keep.apiKey = prof.apiKey;
    if (prof.model && prof.model !== def.model) keep.model = prof.model;
    if (prof.baseUrl && prof.baseUrl.replace(/\/+$/, '') !== def.baseUrl) keep.baseUrl = prof.baseUrl.replace(/\/+$/, '');
    if (Object.keys(keep).length) out.profiles[p] = keep;
  }
  return out;
}

// Permiso de red para servidores que no están en el manifest (proveedor "Otro" o LM Studio en otra máquina).
const BUILTIN = /^(https:\/\/(generativelanguage\.googleapis\.com|api\.anthropic\.com|api\.groq\.com|openrouter\.ai)|http:\/\/(localhost|127\.0\.0\.1))(:\d+)?\//;
function originPattern() {
  const url = $('baseUrl').value.trim() || PROVIDERS[current].baseUrl;
  try {
    const u = new URL(url);
    if (BUILTIN.test(`${u.protocol}//${u.host}/`)) return null;
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return null;
  }
}
// Aviso previo: qué dominio pedirá Chrome al guardar (así el diálogo no sorprende).
function updatePermNotice() {
  const origin = originPattern();
  const el = document.getElementById('permNotice');
  el.hidden = !origin;
  if (origin) el.textContent = t('optPermNotice', siteLabel(origin));
}
$('baseUrl').addEventListener('input', updatePermNotice);

// Debe llamarse dentro del clic (gesto de la persona), antes de cualquier await.
function askPermission() {
  const origin = originPattern();
  return origin ? chrome.permissions.request({ origins: [origin] }) : Promise.resolve(true);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const granted = await askPermission().catch(() => false);
  await chrome.storage.local.set({ settings: read() });
  saved.textContent = granted ? t('optSaved') : t('optSavedNoPerm');
  saved.className = granted ? 'note ok' : 'note err';
  setTimeout(() => { saved.textContent = ''; }, 4000);
});

document.getElementById('test').addEventListener('click', async () => {
  const perm = askPermission();
  testResult.textContent = t('optTesting');
  testResult.className = 'note';
  if (!(await perm.catch(() => false))) {
    testResult.textContent = t('optNoPerm');
    testResult.className = 'note err';
    return;
  }
  const all = read();
  const r = await chrome.runtime.sendMessage({ type: 'test-connection', settings: { ...all, ...all.profiles[current], ...profiles[current] } });
  if (r?.ok) {
    const models = (r.models ?? []).filter((m) => current !== 'gemini' || /gemini/.test(m));
    testResult.textContent = t('optConnected', models.length);
    testResult.className = 'note ok';
    document.getElementById('models').innerHTML = models.map((m) => `<option value="${m.replace(/"/g, '')}">`).join('');
  } else {
    testResult.textContent = t('optConnectFail', r?.error ?? t('optNoAnswer'));
    testResult.className = 'note err';
  }
});

// ---------------------------------------------------------------- sitios activos
async function renderSites() {
  const list = document.getElementById('sites');
  const extra = await getSites();
  const fixed = ['localhost', '127.0.0.1', '*.localhost'];
  const items = fixed.map((h) => `<li><code>${h}</code><small>${t('optAlways')}</small></li>`);
  for (const s of extra) items.push(`<li><code>${siteLabel(s).replace(/</g, '&lt;')}</code><button type="button" data-remove="${s.replace(/"/g, '')}">${t('optRemove')}</button></li>`);
  list.innerHTML = items.join('');
}
document.getElementById('sites').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-remove]');
  if (!b) return;
  // No quitamos el permiso si también lo usa el servidor del modelo (proveedor "Otro" o LM Studio en la red).
  const cfg = resolveConfig(read());
  await removeSite(b.dataset.remove, [siteFor(`${cfg.baseUrl}/`)].filter(Boolean));
  renderSites();
});
chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.sites) renderSites(); });
renderSites();

