/*
 * WebMCP Flow · cliente de modelos (con streaming).
 * Dos formatos cubren a todos los proveedores:
 *  - "openai": Gemini, Groq, OpenRouter, LM Studio y cualquier servidor compatible con OpenAI.
 *  - "anthropic": Claude (API de Messages).
 * La conversación se guarda siempre en formato OpenAI y se traduce al vuelo para Claude.
 * Corre en el service worker: la key nunca toca la página.
 */

const tr = (key, ...subs) => globalThis.chrome?.i18n?.getMessage(key, subs.map(String)) || key;

export const PROVIDERS = {
  gemini: {
    label: 'Gemini',
    format: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.8-flash',
    needsKey: true,
    keyHint: 'AIza…',
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  anthropic: {
    label: 'Claude',
    format: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-5-5',
    needsKey: true,
    keyHint: 'sk-ant-…',
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  groq: {
    label: 'Groq',
    format: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'openai/gpt-oss-120b',
    needsKey: true,
    keyHint: 'gsk_…',
    keyUrl: 'https://console.groq.com/keys',
  },
  openrouter: {
    label: 'OpenRouter',
    format: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-oss-120b',
    needsKey: true,
    keyHint: 'sk-or-…',
    keyUrl: 'https://openrouter.ai/settings/keys',
  },
  lmstudio: {
    label: 'LM Studio',
    format: 'openai',
    baseUrl: 'http://localhost:1234/v1',
    model: '',
    needsKey: false,
  },
  custom: {
    label: tr('customLabel'),
    format: 'openai',
    baseUrl: '',
    model: '',
    needsKey: false, // depende del servidor: la key es opcional
    keyHint: '(opcional)',
  },
};

// Cada proveedor guarda su propia key, modelo y URL en settings.profiles[proveedor].
const PROFILE_KEYS = ['apiKey', 'model', 'baseUrl'];

export const DEFAULT_SETTINGS = {
  assistantName: 'Flow',
  style: 'Cercano, claro y breve. Explica lo que haces antes de hacerlo.',
  provider: 'gemini',
  profiles: {},
  temperature: 0.3,
  position: 'left',
};

/** Perfil de un proveedor. Los campos sueltos (apiKey, model, baseUrl) tienen prioridad: vienen de "Probar conexión" o de ajustes de la v0.1. */
export function profileOf(s, provider = s.provider) {
  const saved = s.profiles?.[provider] ?? {};
  const loose = provider === s.provider ? Object.fromEntries(PROFILE_KEYS.filter((k) => s[k] !== undefined).map((k) => [k, s[k]])) : {};
  return { ...saved, ...loose };
}

export function resolveConfig(s) {
  const provider = s.provider in PROVIDERS ? s.provider : 'gemini';
  const p = PROVIDERS[provider];
  const prof = profileOf({ ...s, provider }, provider);
  return {
    provider,
    format: p.format,
    label: p.label,
    baseUrl: (prof.baseUrl || p.baseUrl).replace(/\/+$/, ''),
    model: prof.model || p.model,
    apiKey: prof.apiKey || '',
    needsKey: p.needsKey,
    temperature: Number.isFinite(+s.temperature) ? +s.temperature : 0.3,
  };
}

export function missingConfig(cfg) {
  const missing = [];
  if (!cfg.baseUrl) missing.push(tr('missingUrl'));
  if (cfg.needsKey && !cfg.apiKey) missing.push(tr('missingKey'));
  if (cfg.provider !== 'lmstudio' && !cfg.model) missing.push(tr('missingModel'));
  return missing;
}

// Los esquemas de las tools vienen de cualquier web: dejamos solo lo que los proveedores aceptan.
const SCHEMA_KEYS = new Set([
  'type', 'description', 'properties', 'required', 'items', 'enum', 'format', 'nullable',
  'minimum', 'maximum', 'minItems', 'maxItems', 'minLength', 'maxLength', 'anyOf', 'default', 'title',
]);
export function cleanSchema(schema, depth = 0) {
  if (!schema || typeof schema !== 'object' || depth > 12) return { type: 'object', properties: {} };
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (!SCHEMA_KEYS.has(k)) continue;
    if (k === 'properties' && v && typeof v === 'object') {
      out.properties = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, cleanSchema(pv, depth + 1)]));
    } else if (k === 'items') out.items = cleanSchema(v, depth + 1);
    else if (k === 'anyOf' && Array.isArray(v)) out.anyOf = v.map((x) => cleanSchema(x, depth + 1));
    else if (k === 'type' && Array.isArray(v)) out.type = v.find((t) => t !== 'null') ?? 'string';
    else out[k] = v;
  }
  if (depth === 0) {
    out.type = 'object';
    out.properties ??= {};
  }
  if (Array.isArray(out.required) && out.properties) out.required = out.required.filter((r) => r in out.properties);
  return out;
}

const mask = (key) => (key ? `${key.slice(0, 4)}…${key.slice(-2)}` : '(sin key)');

/**
 * Llama al modelo en streaming.
 * emit({type:'text', delta}) mientras escribe, emit({type:'tool', name}) cuando empieza una tool.
 * Devuelve { text, toolCalls: [{id, name, args}], debug } con lo necesario para la consola.
 */
export async function streamChat(cfg, { messages, tools, signal }, emit) {
  const req = cfg.format === 'anthropic' ? anthropicRequest(cfg, messages, tools) : openaiRequest(cfg, messages, tools);
  const debug = { method: 'POST', url: req.url, headers: req.debugHeaders, request: req.body };

  let res;
  try {
    res = await fetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    const hint = cfg.provider === 'lmstudio'
      ? tr('lmstudioDown', cfg.baseUrl)
      : tr('cantConnect', cfg.label, cfg.baseUrl, e.message);
    throw Object.assign(new Error(hint), { debug });
  }
  debug.httpStatus = res.status;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    debug.response = tryJson(text);
    let msg = text.slice(0, 400);
    try { const j = JSON.parse(text); msg = j?.error?.message ?? j?.[0]?.error?.message ?? msg; } catch { /* texto plano */ }
    const pref = res.status === 401 || res.status === 403 ? tr('badKey')
      : res.status === 429 ? tr('rateLimit')
      : res.status === 404 ? tr('checkUrlModel') : '';
    throw Object.assign(new Error(`${tr('httpError', cfg.label, res.status)} ${pref}${msg}`), { debug });
  }

  const out = { text: '', calls: [], usage: null, finish: null };
  const think = thinkFilter((t) => { out.text += t; emit({ type: 'text', delta: t }); });
  if (cfg.format === 'anthropic') await readAnthropicStream(res, out, think, emit);
  else await readOpenAIStream(res, out, think, emit);
  think.flush();

  const toolCalls = out.calls.filter(Boolean).map((c, i) => ({
    id: c.id || `call_${Date.now()}_${i}`,
    name: c.name,
    args: c.args,
    ...(c.extra ? { extra_content: c.extra } : {}),
  }));
  debug.response = { finish_reason: out.finish, text: out.text.trim(), tool_calls: toolCalls.map((c) => ({ name: c.name, arguments: tryJson(c.args) })), usage: out.usage };
  return { text: out.text.trim(), toolCalls, debug };
}

// ---------------------------------------------------------------- formato OpenAI
function openaiRequest(cfg, messages, tools) {
  const gemini = cfg.provider === 'gemini';
  const body = {
    ...(cfg.model ? { model: cfg.model } : {}),
    // Algunos proveedores (Groq) rechazan campos que no conocen: cada uno recibe solo lo suyo.
    messages: messages.map((m) => {
      if (m.role === 'tool') return { role: 'tool', tool_call_id: m.tool_call_id, content: m.content, ...(gemini && m.name ? { name: m.name } : {}) };
      if (m.tool_calls) {
        return {
          ...m,
          // La "thought signature" de Gemini 3 solo le sirve a Gemini (y es obligatoria allí).
          tool_calls: m.tool_calls.map(({ extra_content, ...c }) => (gemini && extra_content ? { ...c, extra_content } : c)),
        };
      }
      return m;
    }),
    stream: true,
    // Gemini manda el uso de tokens siempre; el resto (LM Studio, Groq, OpenRouter…) solo si se pide.
    ...(gemini ? {} : { stream_options: { include_usage: true } }),
    temperature: cfg.temperature,
    ...(tools.length
      ? {
          tools: tools.map((t) => ({
            type: 'function',
            function: { name: t.name, description: (t.description || t.name).slice(0, 1024), parameters: cleanSchema(t.inputSchema) },
          })),
          tool_choice: 'auto',
        }
      : {}),
  };
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey || 'sin-key'}` };
  if (cfg.provider === 'openrouter') headers['x-title'] = 'WebMCP Flow';
  return {
    url: `${cfg.baseUrl}/chat/completions`,
    headers,
    debugHeaders: { ...headers, authorization: `Bearer ${mask(cfg.apiKey)}` },
    body,
  };
}

async function readOpenAIStream(res, out, think, emit) {
  await readSSE(res, (data) => {
    if (data === '[DONE]') return;
    const chunk = tryJson(data);
    if (!chunk || typeof chunk !== 'object') return;
    if (chunk.error) throw new Error(chunk.error.message ?? JSON.stringify(chunk.error));
    if (chunk.usage) out.usage = chunk.usage;
    else if (chunk.x_groq?.usage) out.usage = chunk.x_groq.usage;
    const choice = chunk.choices?.[0];
    if (!choice) return;
    if (choice.finish_reason) out.finish = choice.finish_reason;
    const delta = choice.delta ?? {};
    if (delta.content) think.push(delta.content);
    const calls = out.calls;
    for (const tc of delta.tool_calls ?? []) {
      // Gemini a veces no manda index: usamos el id o la posición.
      let i = Number.isInteger(tc.index) ? tc.index : calls.findIndex((c) => c.id && c.id === tc.id);
      if (i < 0) i = calls.length;
      if (!calls[i]) calls[i] = { id: tc.id ?? '', name: '', args: '' };
      if (tc.id) calls[i].id = tc.id;
      if (tc.function?.name) {
        if (!calls[i].name) emit({ type: 'tool', name: tc.function.name });
        calls[i].name = calls[i].name || tc.function.name;
      }
      if (tc.function?.arguments) calls[i].args += tc.function.arguments;
      // Gemini 3 exige devolver su "thought signature" junto a la llamada en el turno siguiente.
      if (tc.extra_content) calls[i].extra = { ...(calls[i].extra ?? {}), ...tc.extra_content };
    }
  });
}

// ---------------------------------------------------------------- formato Anthropic (Claude)
const ANTHROPIC_MAX_TOKENS = 4096;
const safeId = (id, i) => String(id || `call_${i}`).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);

/** Traduce la conversación (formato OpenAI) a la API de Messages de Claude. */
export function toAnthropic(messages) {
  let system = '';
  const out = [];
  const push = (role, blocks) => {
    if (!blocks.length) return;
    const last = out.at(-1);
    if (last?.role === role) last.content.push(...blocks); // Claude exige alternar user/assistant
    else out.push({ role, content: blocks });
  };
  messages.forEach((m, n) => {
    if (m.role === 'system') system += (system ? '\n\n' : '') + m.content;
    else if (m.role === 'user') push('user', [{ type: 'text', text: String(m.content ?? '') }]);
    else if (m.role === 'assistant') {
      const blocks = [];
      if (m.content) blocks.push({ type: 'text', text: String(m.content) });
      (m.tool_calls ?? []).forEach((c, i) => {
        const input = tryJson(c.function?.arguments || '{}');
        blocks.push({ type: 'tool_use', id: safeId(c.id, `${n}_${i}`), name: c.function?.name, input: input && typeof input === 'object' ? input : {} });
      });
      push('assistant', blocks);
    } else if (m.role === 'tool') {
      const content = String(m.content ?? '');
      const isErr = /^\s*\{\s*"error"\s*:/.test(content);
      push('user', [{ type: 'tool_result', tool_use_id: safeId(m.tool_call_id, n), content: content || '(sin resultado)', ...(isErr ? { is_error: true } : {}) }]);
    }
  });
  if (out[0]?.role === 'assistant') out.unshift({ role: 'user', content: [{ type: 'text', text: '(continúa)' }] });
  return { system, messages: out };
}

function anthropicRequest(cfg, messages, tools) {
  const { system, messages: msgs } = toAnthropic(messages);
  const body = {
    model: cfg.model,
    max_tokens: ANTHROPIC_MAX_TOKENS,
    stream: true,
    temperature: Math.min(1, cfg.temperature),
    ...(system ? { system } : {}),
    messages: msgs,
    ...(tools.length
      ? { tools: tools.map((t) => ({ name: t.name, description: (t.description || t.name).slice(0, 1024), input_schema: cleanSchema(t.inputSchema) })), tool_choice: { type: 'auto' } }
      : {}),
  };
  const headers = {
    'content-type': 'application/json',
    'x-api-key': cfg.apiKey,
    'anthropic-version': '2023-06-01',
    // Las llamadas salen del navegador (service worker de la extensión): Claude exige declararlo.
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  return { url: `${cfg.baseUrl}/messages`, headers, debugHeaders: { ...headers, 'x-api-key': mask(cfg.apiKey) }, body };
}

async function readAnthropicStream(res, out, think, emit) {
  const blocks = {}; // index -> { kind, call }
  const usage = {};
  await readSSE(res, (data) => {
    const e = tryJson(data);
    if (!e || typeof e !== 'object') return;
    if (e.type === 'message_start') Object.assign(usage, e.message?.usage);
    else if (e.type === 'content_block_start') {
      const b = e.content_block ?? {};
      if (b.type === 'tool_use') {
        const call = { id: b.id, name: b.name, args: '' };
        out.calls.push(call);
        blocks[e.index] = { kind: 'tool', call };
        emit({ type: 'tool', name: b.name });
      } else blocks[e.index] = { kind: b.type };
    } else if (e.type === 'content_block_delta') {
      const d = e.delta ?? {};
      if (d.type === 'text_delta') think.push(d.text);
      else if (d.type === 'input_json_delta' && blocks[e.index]?.call) blocks[e.index].call.args += d.partial_json;
    } else if (e.type === 'message_delta') {
      if (e.delta?.stop_reason) out.finish = e.delta.stop_reason;
      Object.assign(usage, e.usage);
    } else if (e.type === 'error') {
      throw new Error(`Claude: ${e.error?.message ?? 'error en el stream'}`);
    }
  });
  if (usage.input_tokens != null || usage.output_tokens != null) {
    const input = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
    out.usage = { prompt_tokens: input, completion_tokens: usage.output_tokens ?? 0, total_tokens: input + (usage.output_tokens ?? 0) };
  }
}

// ---------------------------------------------------------------- "Probar conexión"
export async function testConnection(cfg) {
  const url = `${cfg.baseUrl}/models${cfg.format === 'anthropic' ? '?limit=100' : ''}`;
  const headers = cfg.format === 'anthropic'
    ? { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }
    : { authorization: `Bearer ${cfg.apiKey || 'sin-key'}` };
  const res = await fetch(url, { headers });
  const body = await res.text();
  if (!res.ok) {
    let msg = body.slice(0, 200);
    try { const j = JSON.parse(body); msg = j?.error?.message ?? j?.[0]?.error?.message ?? msg; } catch { /* texto */ }
    throw new Error(`${res.status}: ${msg}`);
  }
  return (tryJson(body)?.data ?? []).map((m) => String(m.id).replace(/^models\//, ''));
}

async function readSSE(res, onData) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const data = raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
      if (data) onData(data);
    }
  }
  const rest = buf.trim();
  if (rest.startsWith('data:')) onData(rest.slice(5).trimStart());
}

/** Quita en vivo los bloques <think>…</think> de algunos modelos locales. */
function thinkFilter(out) {
  let inThink = false;
  let pending = '';
  return {
    push(chunk) {
      pending += chunk;
      for (;;) {
        if (inThink) {
          const end = pending.indexOf('</think>');
          if (end === -1) { pending = pending.slice(-8); return; }
          pending = pending.slice(end + 8);
          inThink = false;
        } else {
          const start = pending.indexOf('<think>');
          if (start === -1) {
            const keep = partialTag(pending, '<think>');
            if (pending.length > keep) out(pending.slice(0, pending.length - keep));
            pending = pending.slice(pending.length - keep);
            return;
          }
          if (start > 0) out(pending.slice(0, start));
          pending = pending.slice(start + 7);
          inThink = true;
        }
      }
    },
    flush() { if (!inThink && pending) out(pending); pending = ''; },
  };
}
function partialTag(s, tag) {
  for (let n = Math.min(tag.length - 1, s.length); n > 0; n--) if (s.endsWith(tag.slice(0, n))) return n;
  return 0;
}
export function tryJson(s) { try { return JSON.parse(s); } catch { return s; } }
