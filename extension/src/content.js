/*
 * WebMCP Flow · content script (mundo aislado).
 * Dibuja el chat flotante y la consola dentro de un Shadow DOM cerrado (no choca con los estilos del sitio)
 * y hace de puente entre el service worker (agente) y el script de la página (tools).
 * Nunca ve la API key: los ajustes se editan en la página de opciones de la extensión.
 */
(() => {
  if (window.top !== window || window.__webmcpFlowUi) return;
  window.__webmcpFlowUi = true;
  const TAG = '__webmcpFlow';
  const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String)) || key;

  // ------------------------------------------------------------------ estado local
  let port = null;
  let state = { ui: [], busy: false, planning: null, open: false, consoleOpen: false, page: {} };
  let log = [];
  let settings = null;
  let toolList = [];
  let mode = null;
  let consoleFilter = 'all';
  const expanded = new Set();

  // ------------------------------------------------------------------ puerto con el agente
  function connect() {
    try {
      port = chrome.runtime.connect({ name: 'webmcp-flow' });
    } catch {
      return; // la extensión se recargó: esta pestaña necesita recargarse
    }
    port.onMessage.addListener(onAgentMessage);
    port.onDisconnect.addListener(() => {
      port = null;
      setTimeout(connect, 600); // el service worker se durmió o reinició
    });
    send({ type: 'hello', url: location.href, title: document.title });
  }
  const send = (msg) => { try { port?.postMessage(msg); } catch { /* reconectando */ } };

  function onAgentMessage(msg) {
    switch (msg.type) {
      case 'state':
        state = msg.state;
        if (msg.log) log = msg.log;
        render();
        break;
      case 'log': {
        const i = log.findIndex((e) => e.id === msg.entry.id);
        if (i >= 0) log[i] = msg.entry;
        else log.push(msg.entry);
        if (log.length > 80) log.splice(0, log.length - 80);
        renderConsole();
        break;
      }
      case 'settings':
        settings = msg.settings;
        render();
        break;
      case 'toggle':
        setOpen(!state.open);
        break;
      case 'bridge-req':
        window.postMessage({ [TAG]: 'req', id: msg.id, op: msg.op, name: msg.name, input: msg.input }, '*');
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------------ puente con la página
  window.addEventListener('message', (ev) => {
    if (ev.source !== window || !ev.data?.[TAG]) return;
    const d = ev.data;
    if (d[TAG] === 'res') {
      if (String(d.id).startsWith('ui:')) return localReply(d);
      send({ type: 'bridge-res', id: d.id, ok: d.ok, result: d.result, error: d.error });
      if (d.ok && d.result?.tools) { toolList = d.result.tools; mode = d.result.mode; renderHeader(); }
    } else if (d[TAG] === 'tools-changed') {
      refreshTools();
    }
  });

  // Consultas propias de la UI (contador de tools), sin pasar por el agente.
  const localWaiters = new Map();
  let localSeq = 0;
  function localReply(d) {
    const w = localWaiters.get(d.id);
    if (w) { localWaiters.delete(d.id); w(d); }
  }
  function refreshTools() {
    const id = `ui:${localSeq++}`;
    localWaiters.set(id, (d) => {
      if (d.ok) { toolList = d.result.tools; mode = d.result.mode; renderHeader(); }
    });
    window.postMessage({ [TAG]: 'req', id, op: 'list' }, '*');
  }

  // Cambios de URL en SPAs.
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl || document.title !== state.page?.title) {
      lastUrl = location.href;
      send({ type: 'page', url: location.href, title: document.title });
    }
  }, 1000);
  // Mantiene despierto al service worker mientras el agente trabaja.
  setInterval(() => { if (state.busy) send({ type: 'ping' }); }, 20_000);

  // ------------------------------------------------------------------ UI
  const host = document.createElement('webmcp-flow');
  host.style.cssText = 'position: fixed; z-index: 2147483646; inset: auto; display: block;';
  const root = host.attachShadow({ mode: 'closed' });

  const css = new CSSStyleSheet();
  fetch(chrome.runtime.getURL('src/ui.css')).then((r) => r.text()).then((t) => css.replaceSync(t)).catch(() => {});
  root.adoptedStyleSheets = [css];

  root.innerHTML = `
    <button class="fab" part="fab" aria-label="${t('fabOpen')}">
      <span class="fab-icon">⚡</span><span class="fab-badge" hidden></span>
    </button>
    <section class="console" hidden aria-label="${t('consoleLabel')}">
      <header>
        <strong>&gt;_ ${t('consoleTitle')}</strong>
        <span class="console-filters">
          <button data-filter="all" class="on">${t('filterAll')}</button><button data-filter="llm">${t('filterLlm')}</button><button data-filter="tool">${t('filterTools')}</button>
        </span>
        <span class="spacer"></span>
        <button class="icon" data-act="export-log" title="${t('exportTrace')}">⤓</button>
        <button class="icon" data-act="clear-log" title="${t('clear')}">⌫</button>
        <button class="icon" data-act="console" title="${t('closeConsole')}">✕</button>
      </header>
      <div class="console-body" role="log"></div>
      <footer>${t('consoleFooter')}</footer>
    </section>
    <div class="waitbar" hidden role="status">
      <span class="spin"></span>
      <span class="wait-text"></span>
      <button data-act="peek" class="wait-btn">${t('seeChat')}</button>
    </div>
    <section class="panel" hidden aria-label="${t('chatLabel')}">
      <header>
        <div class="title">
          <strong class="name">Flow</strong>
          <span class="sub"></span>
        </div>
        <button class="icon" data-act="console" title="${t('debugConsole')}">&gt;_</button>
        <button class="icon" data-act="options" title="${t('settings')}">⚙</button>
        <button class="icon" data-act="reset" title="${t('newChat')}">↺</button>
        <button class="icon" data-act="close" title="${t('close')}">✕</button>
      </header>
      <div class="messages" role="log" aria-live="polite"></div>
      <form class="composer">
        <textarea rows="1" placeholder="${t('placeholder')}" aria-label="${t('messageLabel')}"></textarea>
        <button type="submit" class="send" title="${t('send')}">➤</button>
      </form>
    </section>`;

  const $ = (s) => root.querySelector(s);
  const fab = $('.fab');
  const panel = $('.panel');
  const consoleEl = $('.console');
  const messagesEl = $('.messages');
  const consoleBody = $('.console-body');
  const textarea = $('textarea');
  const form = $('.composer');
  const sendBtn = $('.send');
  const waitbar = $('.waitbar');

  // Paso humano: si una tool sigue corriendo tras WAIT_AFTER_MS, lo más probable es que espere a la persona
  // (confirmar un pago, un diálogo…). El chat se recoge en una barra para no tapar la página; "Ver chat" lo despliega.
  const WAIT_AFTER_MS = 1200;
  let peekTool = null; // id de la tool en espera para la que la persona pidió ver el chat
  let waitTimer = null;
  function waitingTool() {
    return state.ui.find((i) => i.type === 'tool' && i.status === 'running' && Date.now() - (i.startedAt ?? Date.now()) >= WAIT_AFTER_MS) ?? null;
  }
  function scheduleWaitCheck() {
    clearTimeout(waitTimer);
    const running = state.ui.find((i) => i.type === 'tool' && i.status === 'running');
    if (!running || waitingTool()) return;
    waitTimer = setTimeout(render, Math.max(50, WAIT_AFTER_MS - (Date.now() - (running.startedAt ?? Date.now())) + 30));
  }

  fab.addEventListener('click', () => setOpen(!state.open));
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (b) {
      const act = b.dataset.act;
      if (act === 'close') setOpen(false);
      else if (act === 'options') send({ type: 'open-options' });
      else if (act === 'peek') { peekTool = waitingTool()?.id ?? null; render(); }
      else if (act === 'reset') { expanded.clear(); send({ type: 'reset' }); }
      else if (act === 'console') setConsole(!state.consoleOpen);
      else if (act === 'clear-log') { log = []; send({ type: 'clear-log' }); renderConsole(); }
      else if (act === 'export-log') exportTrace();
      return;
    }
    const f = e.target.closest('[data-filter]');
    if (f) {
      consoleFilter = f.dataset.filter;
      root.querySelectorAll('[data-filter]').forEach((x) => x.classList.toggle('on', x === f));
      renderConsole();
      return;
    }
    const row = e.target.closest('.row');
    if (row) {
      const id = row.dataset.id;
      if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
      renderConsole(false);
      return;
    }
    const ex = e.target.closest('[data-example]');
    if (ex) { textarea.value = ex.dataset.example; textarea.focus(); }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (state.busy) { send({ type: 'stop' }); return; }
    const text = textarea.value.trim();
    if (!text) return;
    textarea.value = '';
    autoSize();
    send({ type: 'send', text });
  });
  textarea.addEventListener('keydown', (e) => {
    e.stopPropagation(); // que los atajos del sitio no se disparen mientras se escribe
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });
  textarea.addEventListener('keyup', (e) => e.stopPropagation());
  textarea.addEventListener('keypress', (e) => e.stopPropagation());
  textarea.addEventListener('input', autoSize);
  function autoSize() { textarea.style.height = 'auto'; textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`; }

  function setOpen(v) {
    state.open = v;
    send({ type: 'ui', open: v });
    render();
    if (v) setTimeout(() => textarea.focus(), 30);
  }
  function setConsole(v) {
    state.consoleOpen = v;
    send({ type: 'ui', consoleOpen: v });
    render();
  }

  // Traza para adjuntar a un issue: la key ya viene enmascarada en cada entrada.
  function exportTrace() {
    const data = {
      tool: 'WebMCP Flow',
      version: chrome.runtime.getManifest().version,
      exportedAt: new Date().toISOString(),
      page: { url: location.href, title: document.title, mode, tools: toolList.map((x) => x.name) },
      provider: settings ? { provider: settings.provider, model: settings.model } : null,
      log,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `webmcp-flow-trace-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ------------------------------------------------------------------ render
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function md(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/^\s*[-*] (.+)$/gm, '• $1')
      .replace(/\n/g, '<br>');
  }
  const json = (v) => {
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v, null, 2); } catch { return String(v); }
  };
  const short = (v, n = 80) => {
    const s = typeof v === 'string' ? v : JSON.stringify(v ?? {});
    return s.length > n ? `${s.slice(0, n)}…` : s;
  };
  const humanTool = (name) => String(name).replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

  function render() {
    const side = settings?.position === 'right' ? 'right' : 'left';
    host.dataset.side = side;
    root.host.setAttribute('data-side', side);
    for (const el of [fab, panel, consoleEl]) el.dataset.side = side;
    fab.hidden = false;
    fab.classList.toggle('open', state.open);
    fab.setAttribute('aria-label', state.open ? t('fabClose') : t('fabOpen'));
    const waiting = state.open ? waitingTool() : null;
    const collapsed = Boolean(waiting && peekTool !== waiting.id);
    panel.hidden = !state.open || collapsed;
    consoleEl.hidden = !(state.open && state.consoleOpen) || collapsed;
    waitbar.hidden = !collapsed;
    waitbar.dataset.side = side;
    if (collapsed) $('.wait-text').textContent = t('waitingInPage', humanTool(waiting.name));
    scheduleWaitCheck();
    panel.classList.toggle('with-console', state.consoleOpen);
    renderHeader();
    if (state.open) renderMessages();
    if (state.open && state.consoleOpen) renderConsole();
  }

  function renderHeader() {
    const name = settings?.assistantName || 'Flow';
    $('.name').textContent = name;
    const n = toolList.length;
    const sub = $('.sub');
    sub.textContent = `${n === 1 ? t('toolsOne') : t('toolsMany', n)}${mode === 'shim' ? ` · ${t('modeShim')}` : mode === 'nativo' ? ` · ${t('modeNative')}` : ''}`;
    sub.title = toolList.map((t) => t.name).join('\n') || t('noToolsTitle');
    const badge = $('.fab-badge');
    badge.hidden = !n;
    badge.textContent = n;
  }

  function renderMessages() {
    const atBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 60;
    let html = '';
    if (settings?.missing?.length) {
      html += `<div class="setup">
        <strong>${esc(t('setupTitle'))}</strong>
        <p>${esc(t('setupText', settings.missing.join(', ')))}</p>
        <button data-act="options" class="primary">${esc(t('openSettings'))}</button>
      </div>`;
    }
    if (!state.ui.length) {
      const names = toolList.slice(0, 6).map((t) => `<code>${esc(t.name)}</code>`).join(' ');
      html += `<div class="hello">
        <p>${esc(t('hello', '\u0000')).replace('\u0000', `<strong>${esc(settings?.assistantName || 'Flow')}</strong>`)}</p>
        ${toolList.length ? `<p class="muted">${esc(t('toolsFound'))} ${names}${toolList.length > 6 ? ' …' : ''}</p>` : `<p class="muted">${esc(t('noToolsYet'))}</p>`}
        <p class="examples">
          <button data-example="${esc(t('exWhatQ'))}">${esc(t('exWhatBtn'))}</button>
          <button data-example="${esc(t('exFlowQ'))}">${esc(t('exFlowBtn'))}</button>
        </p>
      </div>`;
    }
    for (const item of state.ui) {
      if (item.type === 'user') html += `<div class="msg user">${md(item.text)}</div>`;
      else if (item.type === 'assistant') {
        if (!item.text && !item.streaming) continue;
        html += `<div class="msg bot">${md(item.text)}${item.streaming ? '<span class="caret"></span>' : ''}</div>`;
      } else if (item.type === 'tool') {
        const icon = item.status === 'running' ? '<span class="spin"></span>' : item.status === 'ok' ? '✓' : '✕';
        html += `<div class="tool ${item.status}" title="${esc(short(item.output, 400))}">
          <span class="ti">${icon}</span><span>${esc(humanTool(item.name))}</span><code>${esc(short(item.input, 60))}</code>
          ${item.status === 'running' ? `<em>${esc(t('running'))}</em>` : ''}
        </div>`;
      } else if (item.type === 'error') html += `<div class="msg error">${md(item.text)}</div>`;
      else if (item.type === 'notice') html += `<div class="msg notice">${md(item.text)}</div>`;
      else if (item.type === 'info') html += `<div class="msg info">${md(item.text)}</div>`;
    }
    const streaming = state.ui.some((i) => i.streaming);
    if (state.busy && !streaming && !state.ui.some((i) => i.status === 'running')) {
      html += `<div class="typing"><span class="dots"><i></i><i></i><i></i></span><em>${esc(state.planning ? t('preparing', humanTool(state.planning).toLowerCase()) : t('thinking'))}</em></div>`;
    }
    messagesEl.innerHTML = html;
    if (atBottom || state.busy) messagesEl.scrollTop = messagesEl.scrollHeight;
    sendBtn.textContent = state.busy ? '■' : '➤';
    sendBtn.title = state.busy ? t('stop') : t('send');
    sendBtn.classList.toggle('stop', state.busy);
    textarea.placeholder = state.busy ? t('working', settings?.assistantName || 'Flow') : t('placeholder');
  }

  function time(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }

  function renderConsole(stick = true) {
    if (consoleEl.hidden) return;
    const atBottom = consoleBody.scrollHeight - consoleBody.scrollTop - consoleBody.clientHeight < 40;
    const rows = log.filter((e) => consoleFilter === 'all' || e.kind === consoleFilter);
    if (!rows.length) {
      consoleBody.innerHTML = `<div class="empty">${esc(t('consoleEmpty'))}</div>`;
      return;
    }
    consoleBody.innerHTML = rows.map((e) => {
      const code = e.kind === 'llm' ? (e.httpStatus ?? (e.status === 'error' ? 'error' : '')) : e.status;
      const st = e.status === 'pending' ? '<span class="st pend">…</span>'
        : `<span class="st ${e.status === 'ok' ? 'ok' : 'err'}">${esc(code || e.status)}</span>`;
      const ms = e.ms != null ? `<span class="ms">${e.ms >= 1000 ? `${(e.ms / 1000).toFixed(1)}s` : `${e.ms}ms`}</span>` : '';
      let line;
      if (e.kind === 'llm') {
        const u = e.response?.usage;
        const tok = u ? `<span class="tok">${u.prompt_tokens ?? '?'}→${u.completion_tokens ?? '?'} tok</span>` : '';
        const what = e.response?.tool_calls?.length ? `→ ${e.response.tool_calls.map((c) => c.name).join(', ')}` : e.response?.text ? `→ ${t('toText')}` : '';
        line = `<span class="k llm">LLM</span><span class="m">POST</span><span class="u">${esc(shortUrl(e.url) || e.title)}</span><span class="d">${esc(e.model || '')} ${esc(what)}</span>${tok}`;
      } else {
        line = `<span class="k tool">TOOL</span><span class="u">${esc(e.name)}</span><span class="d">${esc(short(e.input, 70))}</span>`;
      }
      const open = expanded.has(e.id);
      let detail = '';
      if (open) {
        if (e.kind === 'llm') {
          detail = section('Endpoint', `${e.method ?? 'POST'} ${e.url ?? ''}\nHTTP ${e.httpStatus ?? '—'}`)
            + (e.headers ? section('Headers', json(e.headers)) : '')
            + (e.request ? section('Request', json(e.request)) : '')
            + (e.response ? section('Response', json(e.response)) : '')
            + (e.error ? section('Error', e.error) : '');
        } else {
          detail = section('Input', json(e.input)) + (e.output !== undefined ? section('Output', json(e.output)) : '') + (e.error ? section('Error', e.error) : '');
        }
      }
      return `<div class="entry ${e.status}${open ? ' open' : ''}">
        <div class="row" data-id="${esc(e.id)}"><span class="caret2">${open ? '▾' : '▸'}</span><span class="t">${time(e.at)}</span>${line}<span class="spacer"></span>${ms}${st}</div>
        ${detail}
      </div>`;
    }).join('');
    if (stick && atBottom) consoleBody.scrollTop = consoleBody.scrollHeight;
  }
  const section = (title, body) => `<div class="sec"><div class="sec-t">${esc(title)}</div><pre>${esc(body)}</pre></div>`;
  function shortUrl(u) {
    try { const x = new URL(u); return `${x.host}${x.pathname}`; } catch { return u; }
  }

  // ------------------------------------------------------------------ arranque
  const mount = () => {
    (document.body || document.documentElement).appendChild(host);
    render();
    refreshTools();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
  connect();
})();
