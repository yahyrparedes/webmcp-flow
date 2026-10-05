/*
 * WebMCP Flow · puente en el contexto de la página (MAIN world, document_start).
 *
 * Objetivo: saber qué tools WebMCP registra la página y poder ejecutarlas.
 *  - Si el navegador ya trae WebMCP (document.modelContext / navigator.modelContext),
 *    envolvemos registerTool / unregisterTool / provideContext / clearContext para anotar cada tool.
 *  - Si no lo trae, instalamos un "shim" mínimo con la misma forma, para que la página registre
 *    sus tools igual y se puedan probar sin activar flags de Chrome.
 *  - Si existe navigator.modelContextTesting (API de pruebas de Chrome), la usamos como respaldo
 *    para listar/ejecutar tools que se registraron antes de que llegáramos.
 *
 * Se comunica con el content script de la extensión por window.postMessage.
 */
(() => {
  if (window.__webmcpFlowBridge) return;
  const TAG = '__webmcpFlow';
  const tools = new Map(); // name -> { name, description, inputSchema, annotations, execute }

  let notifyTimer = null;
  const notify = () => {
    clearTimeout(notifyTimer);
    notifyTimer = setTimeout(() => window.postMessage({ [TAG]: 'tools-changed', count: tools.size }, '*'), 60);
  };

  function record(tool, opts) {
    if (!tool || typeof tool.name !== 'string') return;
    tools.set(tool.name, tool);
    opts?.signal?.addEventListener?.('abort', () => {
      if (tools.get(tool.name) === tool) {
        tools.delete(tool.name);
        notify();
      }
    }, { once: true });
    notify();
  }
  function forget(name) {
    if (tools.delete(name)) notify();
  }

  function wrap(api) {
    if (!api || api.__webmcpFlowWrapped) return api;
    const orig = {
      registerTool: api.registerTool?.bind(api),
      unregisterTool: api.unregisterTool?.bind(api),
      provideContext: api.provideContext?.bind(api),
      clearContext: api.clearContext?.bind(api),
    };
    const patch = (key, fn) => {
      try { api[key] = fn; } catch { /* no se pudo envolver: queda el respaldo de modelContextTesting */ }
    };
    if (orig.registerTool) patch('registerTool', (tool, opts) => { record(tool, opts); return orig.registerTool(tool, opts); });
    if (orig.unregisterTool) patch('unregisterTool', (name) => { forget(name); return orig.unregisterTool(name); });
    if (orig.provideContext) {
      patch('provideContext', (ctx) => {
        tools.clear();
        (ctx?.tools ?? []).forEach((t) => record(t));
        notify();
        return orig.provideContext(ctx);
      });
    }
    if (orig.clearContext) patch('clearContext', () => { tools.clear(); notify(); return orig.clearContext(); });
    try { Object.defineProperty(api, '__webmcpFlowWrapped', { value: true }); } catch { /* ignorar */ }
    return api;
  }

  // Shim con la forma del estándar, solo si el navegador no trae WebMCP.
  function makeShim() {
    return {
      __webmcpFlowShim: true,
      registerTool(tool, opts) { record(tool, opts); },
      unregisterTool(name) { forget(name); },
      provideContext(ctx) { tools.clear(); (ctx?.tools ?? []).forEach((t) => record(t)); notify(); },
      clearContext() { tools.clear(); notify(); },
    };
  }

  const nativeDoc = 'modelContext' in document ? document.modelContext : undefined;
  const nativeNav = 'modelContext' in navigator ? navigator.modelContext : undefined;
  let mode;
  if (nativeDoc || nativeNav) {
    wrap(nativeDoc);
    wrap(nativeNav);
    mode = 'nativo';
  } else {
    const shim = makeShim();
    for (const target of [document, navigator]) {
      try { Object.defineProperty(target, 'modelContext', { value: shim, configurable: true }); } catch { /* ignorar */ }
    }
    mode = 'shim';
  }

  const testing = () => navigator.modelContextTesting;

  async function listTools() {
    const list = [...tools.values()].map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
      annotations: t.annotations ?? {},
    }));
    if (list.length) return list;
    // Respaldo: API de pruebas de Chrome (los nombres variaron entre versiones).
    const mt = testing();
    const fn = mt?.listTools ?? mt?.getTools;
    if (!fn) return [];
    const raw = await fn.call(mt);
    return (raw ?? []).map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: typeof t.inputSchema === 'string' ? safeJson(t.inputSchema) : (t.inputSchema ?? {}),
      annotations: t.annotations ?? {},
      viaTesting: true,
    }));
  }

  async function callTool(name, input) {
    const t = tools.get(name);
    if (t?.execute) {
      // El agente "cliente" mínimo: algunos borradores pasan un segundo argumento con requestUserInteraction.
      const client = { requestUserInteraction: async (cb) => cb() };
      return normalize(await t.execute(input ?? {}, client));
    }
    const mt = testing();
    if (mt?.executeTool) return normalize(await mt.executeTool(name, JSON.stringify(input ?? {})));
    throw new Error(`La tool "${name}" no está disponible en esta página.`);
  }

  // Resultado listo para mostrar y enviar al modelo (texto). Soporta el formato MCP { content: [{type:'text', text}] }.
  function normalize(result) {
    if (result == null) return '';
    if (typeof result === 'string') return result;
    if (Array.isArray(result?.content)) {
      return result.content.map((c) => (c?.type === 'text' ? c.text : JSON.stringify(c))).join('\n');
    }
    try { return JSON.stringify(result); } catch { return String(result); }
  }
  function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }

  window.addEventListener('message', async (ev) => {
    if (ev.source !== window || ev.data?.[TAG] !== 'req') return;
    const { id, op, name, input } = ev.data;
    try {
      let result;
      if (op === 'list') result = { tools: await listTools(), mode, testingApi: Boolean(testing()) };
      else if (op === 'call') result = await callTool(name, input);
      else throw new Error(`Operación desconocida: ${op}`);
      window.postMessage({ [TAG]: 'res', id, ok: true, result }, '*');
    } catch (e) {
      window.postMessage({ [TAG]: 'res', id, ok: false, error: e?.message ?? String(e) }, '*');
    }
  });

  Object.defineProperty(window, '__webmcpFlowBridge', { value: { mode }, configurable: false });
})();
