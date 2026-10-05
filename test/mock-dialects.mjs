// Modelo simulado para test/demo.mjs. Dialectos:
//  - lmstudio: index, <think>, usage solo con stream_options.include_usage
//  - gemini: sin index, ids propios, extra_content.google.thought_signature obligatoria en el turno siguiente
//  - groq: como OpenAI, pero rechaza campos desconocidos (extra_content, name en mensajes tool)
//  - anthropic: API de Messages (/v1/messages), eventos content_block_*, exige alternar user/assistant
import http from 'node:http';
export const log = [];
export const problems = [];
function sse(res, chunks) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.write('data: [DONE]\n\n'); res.end();
}
export function start(port, dialect, script) {
  return http.createServer((req, res) => {
    if (req.url.includes('/models')) return res.end(JSON.stringify({ data: [{ id: { gemini: 'models/gemini-3.8-flash', anthropic: 'claude-sonnet-5-5', groq: 'openai/gpt-oss-120b' }[dialect] ?? 'qwen/qwen3.8-27b' }] }));
    if (dialect === 'anthropic') return anthropic(req, res, script);
    let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => {
      const b = JSON.parse(body); log.push(b);
      const tools = (b.tools ?? []).map((t) => t.function.name);
      // Gemini: cada assistant con tool_calls debe traer su firma
      if (dialect === 'gemini') {
        for (const m of b.messages) for (const tc of (m.tool_calls ?? []).slice(0, 1)) {
          if (!tc.extra_content?.google?.thought_signature) {
            res.writeHead(400, { 'content-type': 'application/json' });
            return res.end(JSON.stringify([{ error: { code: 400, message: 'Function call is missing a thought_signature in functionCall parts.', status: 'INVALID_ARGUMENT' } }]));
          }
        }
        const bad = b.messages.find((m) => m.role === 'tool' && !m.tool_call_id);
        if (bad) problems.push('tool msg sin tool_call_id');
      }
      if (dialect === 'groq') {
        const unk = b.messages.flatMap((m, i) => [
          ...(m.role === 'tool' && 'name' in m ? [`messages.${i}.name`] : []),
          ...(m.tool_calls ?? []).flatMap((c, j) => Object.keys(c).filter((k) => !['id', 'type', 'function'].includes(k)).map((k) => `messages.${i}.tool_calls.${j}.${k}`)),
        ]);
        if (unk.length) {
          res.writeHead(400, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ error: { message: `property '${unk[0]}' is unsupported`, type: 'invalid_request_error' } }));
        }
        if (req.headers.authorization !== 'Bearer gsk_FAKE') problems.push('groq: authorization incorrecta');
      }
      const lastUser = b.messages.findLastIndex((m) => m.role === 'user');
      const step = b.messages.slice(lastUser).filter((m) => m.role === 'assistant').length;
      const turn = b.messages.filter((m) => m.role === 'user').length - 1;
      const s = script[turn]?.[step];
      if (!s) return sse(res, [{ choices: [{ delta: { content: `FIN (turn ${turn} step ${step})` }, finish_reason: 'stop' }] }]);
      if (s.needs) for (const n of s.needs) if (!tools.includes(n)) problems.push(`turn ${turn} step ${step}: falta tool ${n} (hay: ${tools.join(',')})`);
      if (s.check) { const p = s.check(b); if (p) problems.push(`turn ${turn} step ${step}: ${p}`); }
      const chunks = [];
      if (s.text) {
        if (dialect === 'lmstudio') chunks.push({ choices: [{ delta: { content: '<thi' } }] }, { choices: [{ delta: { content: 'nk>razono…</th' } }] }, { choices: [{ delta: { content: 'ink>' } }] });
        for (const part of s.text.match(/.{1,12}/gs)) chunks.push({ choices: [{ delta: { content: part } }] });
      }
      (s.calls ?? []).forEach(([name, args], i) => {
        const id = dialect === 'gemini' ? `function-call-${Math.random().toString(36).slice(2)}` : `call_${turn}_${step}_${i}`;
        const a = JSON.stringify(args);
        if (dialect === 'gemini') {
          chunks.push({ choices: [{ delta: { role: 'assistant', tool_calls: [{ id, type: 'function', function: { name, arguments: a }, ...(i === 0 ? { extra_content: { google: { thought_signature: 'c2lnLWZha2U=' } } } : {}) }] } }] });
        } else {
          chunks.push({ choices: [{ delta: { tool_calls: [{ index: i, id, type: 'function', function: { name, arguments: '' } }] } }] });
          chunks.push({ choices: [{ delta: { tool_calls: [{ index: i, function: { arguments: a.slice(0, 4) } }] } }] });
          chunks.push({ choices: [{ delta: { tool_calls: [{ index: i, function: { arguments: a.slice(4) } }] } }] });
        }
      });
      const usage = { prompt_tokens: 1000 + step, completion_tokens: 20, total_tokens: 1020 + step };
      const fin = { choices: [{ delta: {}, finish_reason: s.calls ? 'tool_calls' : 'stop' }] };
      if (dialect === 'gemini') fin.usage = usage; // Gemini manda usage en el último chunk
      chunks.push(fin);
      if (dialect !== 'gemini' && b.stream_options?.include_usage) chunks.push({ choices: [], usage });
      sse(res, chunks);
    });
  }).listen(port);
}

// ---------------------------------------------------------------- Anthropic
function anthropic(req, res, script) {
  let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => {
    const b = JSON.parse(body); log.push(b);
    const fail = (msg) => { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: msg } })); };
    if (req.headers['x-api-key'] !== 'sk-ant-FAKE') return fail('x-api-key incorrecta');
    if (req.headers['anthropic-dangerous-direct-browser-access'] !== 'true') return fail('CORS requests must set anthropic-dangerous-direct-browser-access');
    if (!b.max_tokens) return fail('max_tokens: Field required');
    if (b.messages.some((m) => m.role === 'system')) return fail('system debe ir arriba');
    for (let i = 0; i < b.messages.length; i++) {
      if (b.messages[i].role !== (i % 2 ? 'assistant' : 'user')) return fail(`messages: roles must alternate (posición ${i})`);
      const prev = b.messages[i - 1];
      for (const blk of b.messages[i].content) {
        if (blk.type === 'tool_result' && !prev?.content.some((p) => p.type === 'tool_use' && p.id === blk.tool_use_id)) return fail(`tool_result ${blk.tool_use_id} sin tool_use previo`);
      }
      if (prev?.role === 'assistant') {
        for (const tu of prev.content.filter((p) => p.type === 'tool_use')) {
          if (!b.messages[i].content.some((x) => x.type === 'tool_result' && x.tool_use_id === tu.id)) return fail(`tool_use ${tu.id} sin tool_result`);
        }
      }
    }
    const tools = (b.tools ?? []).map((t) => t.name);
    const lastUser = b.messages.findLastIndex((m) => m.role === 'user' && m.content.some((c) => c.type === 'text'));
    const step = b.messages.slice(lastUser).filter((m) => m.role === 'assistant').length;
    const turn = b.messages.filter((m) => m.role === 'user' && m.content.some((c) => c.type === 'text')).length - 1;
    const s = script[turn]?.[step];
    const ev = [];
    const send = (type, o) => ev.push(`event: ${type}\ndata: ${JSON.stringify({ type, ...o })}\n\n`);
    send('message_start', { message: { id: 'msg_1', role: 'assistant', content: [], usage: { input_tokens: 900 + step, output_tokens: 1 } } });
    let idx = 0;
    const text = s ? s.text : `FIN (turn ${turn} step ${step})`;
    if (s?.needs) for (const n of s.needs) if (!tools.includes(n)) problems.push(`turn ${turn} step ${step}: falta tool ${n}`);
    if (s?.check) {
      // los checks esperan formato OpenAI: adaptamos el último tool_result
      const lastBlk = b.messages.at(-1).content.at(-1);
      const p = s.check({ messages: [...b.messages.slice(0, -1), { role: 'tool', content: lastBlk.content ?? lastBlk.text }], tools: b.tools });
      if (p && !/paralelas/.test(p)) problems.push(`turn ${turn} step ${step}: ${p}`);
    }
    if (text) {
      send('content_block_start', { index: idx, content_block: { type: 'text', text: '' } });
      for (const part of text.match(/.{1,10}/gs)) send('content_block_delta', { index: idx, delta: { type: 'text_delta', text: part } });
      send('content_block_stop', { index: idx++ });
    }
    for (const [i, [name, args]] of (s?.calls ?? []).entries()) {
      const a = JSON.stringify(args);
      send('content_block_start', { index: idx, content_block: { type: 'tool_use', id: `toolu_${turn}${step}${i}`, name, input: {} } });
      send('content_block_delta', { index: idx, delta: { type: 'input_json_delta', partial_json: a.slice(0, 3) } });
      send('content_block_delta', { index: idx, delta: { type: 'input_json_delta', partial_json: a.slice(3) } });
      send('content_block_stop', { index: idx++ });
    }
    send('message_delta', { delta: { stop_reason: s?.calls ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 20 } });
    send('message_stop', {});
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(ev.join(''));
  });
}
