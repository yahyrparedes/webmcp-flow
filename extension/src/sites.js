/*
 * WebMCP Flow · sitios donde se activa la extensión.
 * Por defecto solo en localhost (donde se desarrollan las tools). En cualquier otro sitio, la persona lo activa
 * desde el ícono de la extensión y Chrome le pide permiso solo para ese dominio.
 * Los scripts se registran con chrome.scripting (no van fijos en el manifest), así Chrome no avisa de
 * "leer y cambiar tus datos en todos los sitios".
 */

export const DEFAULT_SITES = ['http://localhost/*', 'http://127.0.0.1/*', 'http://*.localhost/*'];
const SCRIPT_IDS = { bridge: 'wmf-bridge', ui: 'wmf-ui' };

/** Patrón de permiso para la URL de una pestaña (sin puerto: vale para todos los puertos de ese host). */
export function siteFor(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return null;
  }
}

export const siteLabel = (pattern) => pattern.replace(/^https?:\/\//, '').replace(/\/\*$/, '');

export async function getSites() {
  const { sites } = await chrome.storage.local.get('sites');
  return Array.isArray(sites) ? sites : [];
}

/** ¿La extensión está activa en esta URL? */
export async function isActive(url) {
  const site = siteFor(url);
  if (!site) return false;
  if (matchesDefault(url)) return true;
  return (await getSites()).includes(site) && (await chrome.permissions.contains({ origins: [site] }));
}

function matchesDefault(url) {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.localhost'));
  } catch {
    return false;
  }
}

/** Registra los scripts para localhost + los sitios activados que siguen teniendo permiso. */
export async function syncScripts() {
  const granted = [];
  for (const s of await getSites()) if (await chrome.permissions.contains({ origins: [s] })) granted.push(s);
  const matches = [...new Set([...DEFAULT_SITES, ...granted])];
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: Object.values(SCRIPT_IDS) });
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: existing.map((s) => s.id) });
  await chrome.scripting.registerContentScripts([
    { id: SCRIPT_IDS.bridge, matches, js: ['src/bridge.js'], runAt: 'document_start', world: 'MAIN', allFrames: false, persistAcrossSessions: true },
    { id: SCRIPT_IDS.ui, matches, js: ['src/content.js'], runAt: 'document_start', allFrames: false, persistAcrossSessions: true },
  ]);
  return matches;
}

/** Guarda el sitio (el permiso ya lo pidió la página que tiene el clic de la persona) y vuelve a registrar. */
export async function addSite(site) {
  const sites = await getSites();
  if (!sites.includes(site)) await chrome.storage.local.set({ sites: [...sites, site] });
  return syncScripts();
}

/** Quita el sitio y su permiso, salvo que el permiso también lo use el servidor del modelo. */
export async function removeSite(site, keepOrigins = []) {
  await chrome.storage.local.set({ sites: (await getSites()).filter((s) => s !== site) });
  await syncScripts();
  if (!keepOrigins.includes(site) && !DEFAULT_SITES.includes(site)) await chrome.permissions.remove({ origins: [site] }).catch(() => {});
}
