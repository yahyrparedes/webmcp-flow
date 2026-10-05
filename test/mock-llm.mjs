// Servidor OpenAI-compatible de mentira: guion fijo para probar el bucle de la extensión.
import http from 'node:http';
export const requests = [];
function sse(res, chunks) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.write('data: [DONE]\n\n'); res.end();
}
const call = (id, name, args) => [
  { choices: [{ delta: { tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: '' } }] } }] },
  { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args).slice(0, 5) } }] } }] },
  { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args).slice(5) } }] }, finish_reason: 'tool_calls' }] },
];
export function start(port = 1235) {
  const srv = http.createServer((req, res) => {
    if (req.url.endsWith('/models')) { res.end(JSON.stringify({ data: [{ id: 'mock-model' }] })); return; }
    let body = ''; req.on('data', (d) => body += d); req.on('end', () => {
      const b = JSON.parse(body); requests.push(b);
      const last = b.messages.at(-1);
      // Los mensajes tool no llevan "name" (formato OpenAI): lo sacamos de la llamada que responden.
      if (last.role === 'tool') last.name = b.messages.flatMap((m) => m.tool_calls ?? []).find((c) => c.id === last.tool_call_id)?.function.name;
      const tools = (b.tools ?? []).map((t) => t.function.name);
      if (last.role === 'user') return sse(res, [{ choices: [{ delta: { content: '<think>hmm</think>Busco ' } }] }, { choices: [{ delta: { content: 'sedanes…' } }] }, ...call('c1', 'search_cars', { query: 'sedán' })]);
      if (last.role === 'tool' && last.name === 'search_cars') return sse(res, call('c2', 'open_car', { id: 3 }));
      if (last.role === 'tool' && last.name === 'open_car') {
        if (!tools.includes('add_current_car_to_favorites')) return sse(res, [{ choices: [{ delta: { content: 'FALLO: no apareció la tool contextual' } }] }]);
        return sse(res, call('c3', 'add_current_car_to_favorites', {}));
      }
      return sse(res, [{ choices: [{ delta: { content: 'Listo: agregué el **Sedán Brisa** ' } }] }, { choices: [{ delta: { content: 'a favoritos.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 321, completion_tokens: 12 } }]);
    });
  });
  srv.listen(port);
  return srv;
}
