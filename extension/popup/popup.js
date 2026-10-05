import { isActive, removeSite, siteFor, siteLabel, DEFAULT_SITES } from '../src/sites.js';
import { resolveConfig, DEFAULT_SETTINGS } from '../src/llm.js';
import { t, translatePage } from '../src/i18n-dom.js';

translatePage();

const $ = (id) => document.getElementById(id);
// La URL de la pestaña la da activeTab al pulsar el ícono.
// ?tab=<id>&url=<url> permite abrir el popup como página en las pruebas.
const params = new URLSearchParams(location.search);
const forced = Number(params.get('tab'));
const [tab] = forced ? [await chrome.tabs.get(forced)] : await chrome.tabs.query({ active: true, currentWindow: true });
if (tab && !tab.url && forced) tab.url = params.get('url');
const site = tab?.url ? siteFor(tab.url) : null;

$('options').addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });

if (!site) {
  $('unsupported').hidden = false;
} else {
  $('site').textContent = siteLabel(site);
  const active = await isActive(tab.url);
  $('on').hidden = !active;
  $('offState').hidden = active;
  $('off').hidden = DEFAULT_SITES.includes(site); // localhost siempre está activo
}

$('open').addEventListener('click', async () => {
  const r = await chrome.runtime.sendMessage({ type: 'toggle-chat', tabId: tab.id });
  if (r?.ok) window.close();
  else $('onText').textContent = t('popReload');
});

$('enable').addEventListener('click', async () => {
  // El servicio termina el trabajo si el popup se cierra mientras Chrome muestra el permiso.
  chrome.runtime.sendMessage({ type: 'site-pending', site, tabId: tab.id });
  let granted = false;
  try { granted = await chrome.permissions.request({ origins: [site] }); } catch { granted = false; }
  if (!granted) { $('offText').textContent = t('popDenied'); return; }
  await chrome.runtime.sendMessage({ type: 'site-added', site, tabId: tab.id });
  window.close();
});

$('off').addEventListener('click', async () => {
  const { settings } = await chrome.storage.local.get('settings');
  const cfg = resolveConfig({ ...DEFAULT_SETTINGS, ...(settings ?? {}) });
  await removeSite(site, [siteFor(`${cfg.baseUrl}/`)].filter(Boolean));
  await chrome.tabs.reload(tab.id);
  window.close();
});
