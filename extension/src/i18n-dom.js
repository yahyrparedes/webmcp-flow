// Traduce las páginas de la extensión (ajustes, popup): data-i18n="clave" (texto), data-i18n-placeholder, data-i18n-title, data-i18n-aria.
export const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String)) || key;
export function translatePage(root = document) {
  document.documentElement.lang = chrome.i18n.getUILanguage().split('-')[0];
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
}
