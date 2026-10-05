/*
 * Café Juanito · tienda de ejemplo con tools WebMCP (sin backend: todo vive en esta página).
 * Sirve para probar WebMCP Flow sin montar nada y la usa el CI de la extensión.
 * Tools globales: catálogo, carrito, entrega, checkout (con confirmación humana) y navegación.
 * Tools contextuales: solo existen mientras se ve un producto (get_current_product, customize_current_product,
 * add_current_product_to_cart).
 */
const mc = document.modelContext || navigator.modelContext;

// ------------------------------------------------------------------ datos
const SIZES = [{ name: 'Alto', ml: 350, delta: 0 }, { name: 'Grande', ml: 470, delta: 1.5 }, { name: 'Venti', ml: 590, delta: 2.5 }];
const MILK = { id: 'leche', name: 'Leche', required: true, max: 1, options: [{ name: 'Entera', price: 0 }, { name: 'Descremada', price: 0 }, { name: 'Bebida de Avena', price: 2.5 }, { name: 'Bebida de Almendra', price: 2.5 }] };
const COFFEE = { id: 'cafe', name: 'Café', required: true, max: 1, options: [{ name: 'Espresso', price: 0 }, { name: 'Descafeinado', price: 0 }] };
const SHOT = { id: 'shot', name: 'Shot extra', required: false, max: 3, stepper: true, options: [{ name: 'Shot de espresso', price: 2 }] };
const SYRUP = { id: 'jarabe', name: 'Jarabe', required: false, max: 1, options: [{ name: 'Vainilla', price: 1.5 }, { name: 'Caramel', price: 1.5 }] };
const PRODUCTS = [
  { slug: 'latte', name: 'Latte', category: 'Café caliente', price: 13, emoji: '☕', description: 'Espresso con leche vaporizada y una capa fina de espuma.', groups: [MILK, COFFEE, SHOT, SYRUP] },
  { slug: 'americano', name: 'Americano', category: 'Café caliente', price: 10, emoji: '☕', description: 'Espresso con agua caliente.', groups: [COFFEE, SHOT] },
  { slug: 'cappuccino', name: 'Cappuccino', category: 'Café caliente', price: 13.5, emoji: '☕', description: 'Espresso con mucha espuma de leche.', groups: [MILK, COFFEE, SHOT] },
  { slug: 'caramel-frappe', name: 'Caramel Frappé', category: 'Bebidas frías', price: 16, emoji: '🧋', description: 'Café licuado con hielo, leche y caramelo.', groups: [MILK, COFFEE] },
  { slug: 'chai-latte', name: 'Chai Latte', category: 'Té', price: 14, emoji: '🍵', description: 'Té negro con especias y leche vaporizada.', groups: [MILK] },
  { slug: 'croissant', name: 'Croissant de mantequilla', category: 'Para comer', price: 7, emoji: '🥐', description: 'Horneado cada mañana.', groups: [] },
];
const DELIVERY = { address: 'Av. Siempre Viva 742', store: 'Café Juanito · Centro', minutes: 30, fee: 6.5 };
const CARD = { last4: '4242', name: 'Tarjeta de regalo', balance: 150 };

const state = { cart: [], orders: [], current: null, pending: null };
let lineSeq = 1;
const money = (n) => `S/ ${n.toFixed(2)}`;
const find = (slug) => PRODUCTS.find((p) => p.slug === slug);
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

// ------------------------------------------------------------------ reglas de personalización
function emptySelection(p) {
  return { size: p.groups.length ? 'Grande' : null, options: {} };
}
function findOption(p, name, group) {
  const n = norm(name);
  const groups = group ? p.groups.filter((g) => norm(g.name).includes(norm(group))) : p.groups;
  for (const g of groups) for (const o of g.options) if (norm(o.name) === n || norm(o.name).includes(n)) return { g, o };
  return null;
}
function applyRequest(p, { size, options = [] } = {}, base) {
  const sel = structuredClone(base ?? emptySelection(p));
  const errors = [];
  if (size) {
    const s = SIZES.find((x) => norm(x.name) === norm(size));
    if (!p.groups.length) errors.push(`${p.name} no tiene tamaños.`);
    else if (!s) errors.push(`Tamaño "${size}" no existe. Tamaños: ${SIZES.map((x) => x.name).join(', ')}.`);
    else sel.size = s.name;
  }
  for (const req of options) {
    const hit = findOption(p, req.option, req.group);
    if (!hit) {
      errors.push(`"${req.option}" no es una opción de ${p.name}. Opciones: ${p.groups.flatMap((g) => g.options.map((o) => o.name)).join(', ')}.`);
      continue;
    }
    const { g, o } = hit;
    const qty = req.quantity ?? 1;
    if (g.max === 1 && !g.stepper) sel.options[g.id] = qty === 0 ? {} : { [o.name]: 1 };
    else {
      const cur = { ...(sel.options[g.id] ?? {}) };
      if (qty === 0) delete cur[o.name]; else cur[o.name] = qty;
      const total = Object.values(cur).reduce((a, b) => a + b, 0);
      if (total > g.max) errors.push(`${g.name}: máximo ${g.max}.`);
      else sel.options[g.id] = cur;
    }
  }
  return { sel, errors };
}
const missing = (p, sel) => p.groups.filter((g) => g.required && !Object.keys(sel.options[g.id] ?? {}).length).map((g) => `${g.name}: debes elegir una opción.`);
function unitPrice(p, sel) {
  let price = p.price + (SIZES.find((s) => s.name === sel.size)?.delta ?? 0);
  for (const g of p.groups) for (const [name, q] of Object.entries(sel.options[g.id] ?? {})) price += (g.options.find((o) => o.name === name)?.price ?? 0) * q;
  return Math.round(price * 100) / 100;
}
function describe(p, sel) {
  const parts = sel.size ? [`${sel.size} (${SIZES.find((s) => s.name === sel.size).ml} ml)`] : [];
  for (const g of p.groups) for (const [name, q] of Object.entries(sel.options[g.id] ?? {})) parts.push(q > 1 ? `${q}× ${name}` : name);
  return parts;
}
const productForAgent = (p) => ({
  slug: p.slug, nombre: p.name, descripcion: p.description, categoria: p.category,
  tamaños: p.groups.length ? SIZES.map((s) => ({ nombre: s.name, precio: p.price + s.delta })) : [{ nombre: 'Único', precio: p.price }],
  personalizacion: p.groups.map((g) => ({ grupo: g.name, obligatorio: g.required, regla: g.required ? 'elegir exactamente 1' : `hasta ${g.max}`, opciones: g.options.map((o) => ({ nombre: o.name, precioAdicional: o.price })) })),
  moneda: 'PEN',
});
function cartForAgent() {
  const subtotal = state.cart.reduce((a, l) => a + l.total, 0);
  const total = subtotal ? subtotal + DELIVERY.fee : 0;
  return {
    productos: state.cart.map((l) => ({ lineId: l.lineId, nombre: l.name, personalizacion: l.summary, cantidad: l.quantity, precioUnitario: l.unit, total: l.total })),
    subtotal, delivery: subtotal ? DELIVERY.fee : 0, total, moneda: 'PEN',
  };
}
function addLine(p, sel, quantity = 1) {
  const miss = missing(p, sel);
  if (miss.length) return { error: `No pude agregarlo: ${miss.join(' ')}`, detalles: miss };
  const unit = unitPrice(p, sel);
  const line = { lineId: `L${lineSeq++}`, slug: p.slug, name: sel.size ? `${p.name} ${sel.size}` : p.name, summary: describe(p, sel), quantity, unit, total: unit * quantity };
  state.cart.push(line);
  flash(`Agregado: ${line.name}`);
  render();
  return { agregado: { lineId: line.lineId, nombre: line.name, personalizacion: line.summary, cantidad: quantity, total: line.total }, carrito: cartForAgent() };
}

// ------------------------------------------------------------------ tools
const tool = (name, description, inputSchema, execute, annotations = {}) => ({ name, description, inputSchema, annotations, execute });
const obj = (properties = {}, required) => ({ type: 'object', properties, ...(required ? { required } : {}) });
const waitFor = async (cond, ms = 5000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, 50)); } return true; };
const registered = new Set();

const GLOBAL_TOOLS = [
  tool('list_menu', 'Lista el menú por categoría con el precio desde (en soles).', obj({ category: { type: 'string', description: 'Filtra por categoría.' } }),
    async ({ category } = {}) => {
      const cats = [...new Set(PRODUCTS.map((p) => p.category))].filter((c) => !category || norm(c).includes(norm(category)));
      return { categorias: cats.map((c) => ({ categoria: c, productos: PRODUCTS.filter((p) => p.category === c).map((p) => ({ slug: p.slug, nombre: p.name, desde: p.price })) })) };
    }, { readOnlyHint: true }),
  tool('search_products', 'Busca productos por nombre o ingrediente (p. ej. "latte", "caramel").', obj({ query: { type: 'string', description: 'Texto a buscar.' } }, ['query']),
    async ({ query }) => ({ resultados: PRODUCTS.filter((p) => norm(`${p.name} ${p.description} ${p.category}`).includes(norm(query))).map((p) => ({ slug: p.slug, nombre: p.name, categoria: p.category, desde: p.price })) }),
    { readOnlyHint: true }),
  tool('get_product_details', 'Detalle de un producto: tamaños, opciones de personalización con sus reglas y precios.', obj({ slug: { type: 'string' } }, ['slug']),
    async ({ slug }) => { const p = find(slug); return p ? productForAgent(p) : { error: `No existe el producto "${slug}". Usa search_products.` }; }, { readOnlyHint: true }),
  tool('get_delivery_info', 'Dirección de entrega, tienda asignada y tiempo estimado.', obj(),
    async () => ({ metodo: 'Delivery', direccion: DELIVERY.address, tienda: DELIVERY.store, tiempoEstimadoMin: DELIVERY.minutes }), { readOnlyHint: true }),
  tool('view_cart', 'Muestra el carrito: productos (con lineId), subtotal, delivery y total en soles.', obj(), async () => cartForAgent(), { readOnlyHint: true }),
  tool('add_to_cart', 'Agrega un producto personalizado al carrito. Valida tamaño y opciones; si algo falta devuelve el motivo.',
    obj({ slug: { type: 'string' }, size: { type: 'string', description: 'Alto, Grande o Venti.' }, options: { type: 'array', items: obj({ option: { type: 'string' }, group: { type: 'string' }, quantity: { type: 'integer', minimum: 0 } }, ['option']) }, quantity: { type: 'integer', minimum: 1, maximum: 10 } }, ['slug']),
    async ({ slug, size, options = [], quantity = 1 }) => {
      const p = find(slug);
      if (!p) return { error: `No existe el producto "${slug}". Usa search_products para encontrar el slug correcto.` };
      const { sel, errors } = applyRequest(p, { size, options });
      if (errors.length) return { error: `No pude interpretar la personalización: ${errors.join(' ')}` };
      return addLine(p, sel, quantity);
    }),
  tool('update_cart_item', 'Cambia la cantidad de una línea del carrito (0 la elimina).', obj({ lineId: { type: 'string' }, quantity: { type: 'integer', minimum: 0, maximum: 10 } }, ['lineId', 'quantity']),
    async ({ lineId, quantity }) => {
      const l = state.cart.find((x) => x.lineId === lineId);
      if (!l) return { error: `No hay una línea ${lineId}. Usa view_cart.` };
      if (quantity === 0) state.cart = state.cart.filter((x) => x !== l); else Object.assign(l, { quantity, total: l.unit * quantity });
      render();
      return cartForAgent();
    }),
  tool('remove_from_cart', 'Quita una línea del carrito por su lineId.', obj({ lineId: { type: 'string' } }, ['lineId']),
    async ({ lineId }) => { const n = state.cart.length; state.cart = state.cart.filter((x) => x.lineId !== lineId); render(); return n === state.cart.length ? { error: `No hay una línea ${lineId}.` } : cartForAgent(); }),
  tool('checkout', 'Prepara el pago del carrito y muestra la pantalla de confirmación. El pago SOLO se hace si el cliente pulsa "Confirmar y pagar"; la tool espera su decisión y devuelve el resultado.', obj({ note: { type: 'string', maxLength: 48 } }),
    async ({ note = '' } = {}) => {
      if (state.pending) return { error: 'Ya hay un pago esperando la confirmación del cliente.' };
      const cart = cartForAgent();
      if (!cart.productos.length) return { error: 'El carrito está vacío.' };
      if (CARD.balance < cart.total) return { error: `Saldo insuficiente: la tarjeta •••• ${CARD.last4} tiene ${money(CARD.balance)} y el total es ${money(cart.total)}.` };
      go('#/checkout');
      const decision = await new Promise((resolve) => { state.pending = { resolve, note: String(note).slice(0, 48) }; render(); });
      state.pending = null;
      render();
      if (decision === 'paid') { const o = state.orders.at(-1); return { resultado: 'pagado', pedido: o.id, totalPagado: o.total, tarjeta: `•••• ${CARD.last4}`, saldoRestante: CARD.balance, llegaEnMin: DELIVERY.minutes }; }
      return { resultado: 'cancelado', motivo: 'El cliente no confirmó el pago.' };
    }, { destructiveHint: true }),
  tool('get_order_status', 'Estado de un pedido pagado (por defecto, el último).', obj({ orderId: { type: 'string' } }),
    async ({ orderId } = {}) => {
      const o = orderId ? state.orders.find((x) => x.id === orderId) : state.orders.at(-1);
      return o ? { pedido: o.id, estado: 'Pedido recibido', productos: o.items, totalPagado: o.total } : { error: 'Todavía no hay pedidos en esta sesión.' };
    }, { readOnlyHint: true }),
  tool('navigate_to', 'Muestra una pantalla al cliente: "inicio", "producto" (requiere slug) o "carrito". Devuelve las tools disponibles en esa pantalla.',
    obj({ page: { type: 'string', enum: ['inicio', 'producto', 'carrito'] }, slug: { type: 'string', description: 'Slug cuando page es "producto".' } }, ['page']),
    async ({ page, slug }) => {
      if (page === 'producto') {
        if (!find(slug)) return { error: `No existe el producto "${slug}". Verifica el slug con search_products.` };
        go(`#/p/${slug}`);
        await waitFor(() => registered.has('customize_current_product') && state.current?.product.slug === slug);
      } else go(page === 'carrito' ? '#/cart' : '#/');
      return { ok: true, pantalla: page, ...(slug ? { slug } : {}), toolsDisponibles: [...registered] };
    }),
];

const current = () => state.current ?? null;
const CONTEXT_TOOLS = [
  tool('get_current_product', 'El producto abierto en pantalla, con sus opciones y la personalización elegida.', obj(),
    async () => { const c = current(); return c ? { ...productForAgent(c.product), seleccionActual: { personalizacion: describe(c.product, c.sel), precioUnitario: unitPrice(c.product, c.sel), faltante: missing(c.product, c.sel) } } : { error: 'No hay ningún producto abierto.' }; },
    { readOnlyHint: true }),
  tool('customize_current_product', 'Cambia la personalización del producto abierto; el cliente la ve en vivo. reset=true empieza de cero.',
    obj({ size: { type: 'string', description: 'Alto, Grande o Venti.' }, options: { type: 'array', items: obj({ option: { type: 'string' }, group: { type: 'string' }, quantity: { type: 'integer', minimum: 0 } }, ['option']) }, quantity: { type: 'integer', minimum: 1, maximum: 10 }, reset: { type: 'boolean' } }),
    async ({ size, options = [], quantity, reset } = {}) => {
      const c = current();
      if (!c) return { error: 'No hay ningún producto abierto.' };
      const { sel, errors } = applyRequest(c.product, { size, options }, reset ? undefined : c.sel);
      if (errors.length) return { error: `No pude aplicar todos los cambios: ${errors.join(' ')}` };
      c.sel = sel;
      if (quantity) c.quantity = quantity;
      render();
      return { producto: c.product.name, personalizacion: describe(c.product, sel), cantidad: c.quantity, precioUnitario: unitPrice(c.product, sel), faltante: missing(c.product, sel) };
    }),
  tool('add_current_product_to_cart', 'Agrega al carrito el producto abierto con la personalización actual.', obj(),
    async () => { const c = current(); return c ? addLine(c.product, c.sel, c.quantity) : { error: 'No hay ningún producto abierto.' }; }),
];

// Registro propio: el panel "Tools WebMCP" de la página lista y ejecuta las tools aunque el navegador no traiga WebMCP.
const toolDefs = new Map();
const callLog = [];
const EXAMPLES = {
  search_products: { query: 'latte' }, get_product_details: { slug: 'latte' }, list_menu: { category: 'Café' },
  add_to_cart: { slug: 'latte', size: 'Grande', options: [{ option: 'avena' }, { option: 'espresso' }] },
  navigate_to: { page: 'producto', slug: 'cappuccino' }, customize_current_product: { size: 'Venti', options: [{ option: 'caramel' }] },
  update_cart_item: { lineId: 'L1', quantity: 2 }, remove_from_cart: { lineId: 'L1' },
};
async function runTool(t, input, source) {
  const entry = { at: new Date(), tool: t.name, source, input: input ?? {}, status: 'running' };
  callLog.unshift(entry);
  if (callLog.length > 30) callLog.pop();
  renderTools();
  const t0 = performance.now();
  let out;
  try { out = await t.execute(input ?? {}); } catch (e) { out = { error: e.message }; }
  Object.assign(entry, { output: out, status: out && typeof out === 'object' && 'error' in out ? 'error' : 'ok', ms: Math.round(performance.now() - t0) });
  renderTools();
  return out;
}
function register(t, signal) {
  const wrapped = { ...t, execute: (input) => runTool(t, typeof input === 'string' ? JSON.parse(input || '{}') : input ?? {}, 'agente') };
  registered.add(t.name);
  toolDefs.set(t.name, t);
  signal?.addEventListener('abort', () => { registered.delete(t.name); toolDefs.delete(t.name); renderTools(); }, { once: true });
  try { mc?.registerTool(wrapped, signal ? { signal } : undefined); } catch (e) { console.warn('[demo] registerTool', t.name, e.message); }
  renderTools();
}

function renderTools() {
  const count = document.querySelector('#toolCount');
  if (!count) return;
  count.textContent = toolDefs.size;
  const panel = document.querySelector('#tools');
  if (panel.hidden) return;
  const badge = (t) => t.annotations?.destructiveHint ? '<span class="tag warn">confirma la persona</span>'
    : t.annotations?.readOnlyHint ? '<span class="tag">solo lectura</span>' : '<span class="tag act">acción</span>';
  const contextual = new Set(CONTEXT_TOOLS.map((t) => t.name));
  // La lista se rehace solo si cambian las tools (así no se cierran los paneles abiertos al registrar una llamada).
  const sig = [...toolDefs.keys()].join(',');
  if (renderTools.sig !== sig || !document.querySelector('#toolList').childElementCount) {
    renderTools.sig = sig;
    const open = new Set([...document.querySelectorAll('#toolList details[open]')].map((d) => d.dataset.tool));
    document.querySelector('#toolList').innerHTML = [...toolDefs.values()].map((t) => `
    <details class="tool" data-tool="${esc(t.name)}"${open.has(t.name) ? ' open' : ''}>
      <summary><code>${esc(t.name)}</code>${badge(t)}${contextual.has(t.name) ? '<span class="tag ctx">de esta pantalla</span>' : ''}</summary>
      <p>${esc(t.description)}</p>
      <pre>${esc(JSON.stringify(t.inputSchema, null, 2))}</pre>
      <label>Input (JSON)<textarea data-input="${esc(t.name)}" rows="3" spellcheck="false">${esc(JSON.stringify(EXAMPLES[t.name] ?? {}))}</textarea></label>
      <button type="button" data-run="${esc(t.name)}">Ejecutar</button>
    </details>`).join('');
  }
  document.querySelector('#toolLog').innerHTML = callLog.length ? callLog.map((c) => `
    <li class="${c.status}"><span class="when">${c.at.toLocaleTimeString()}</span> <strong>${esc(c.tool)}</strong> <span class="src">${c.source}</span>${c.ms != null ? ` <span class="when">${c.ms} ms</span>` : ''}
      <code>${esc(JSON.stringify(c.input))}</code>${c.output !== undefined ? `<code class="out">→ ${esc(JSON.stringify(c.output).slice(0, 220))}</code>` : ''}</li>`).join('')
    : '<li class="empty">Aún no hay llamadas. Pídele algo al asistente o ejecuta una tool aquí.</li>';
}

let contextCtrl = null;
function setContextTools(on) {
  if (on && !contextCtrl) {
    contextCtrl = new AbortController();
    CONTEXT_TOOLS.forEach((t) => register(t, contextCtrl.signal));
  } else if (!on && contextCtrl) {
    contextCtrl.abort();
    CONTEXT_TOOLS.forEach((t) => { try { mc?.unregisterTool?.(t.name); } catch { /* ya no existía */ } });
    contextCtrl = null;
  }
}

// ------------------------------------------------------------------ interfaz
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function go(hash) { if (location.hash !== hash) location.hash = hash; else render(); }
let flashTimer;
function flash(text) { const el = $('#flash'); el.textContent = text; el.hidden = false; clearTimeout(flashTimer); flashTimer = setTimeout(() => { el.hidden = true; }, 2500); }

function render() {
  const route = location.hash.replace(/^#/, '') || '/';
  const view = $('#view');
  $('#cartCount').textContent = state.cart.reduce((a, l) => a + l.quantity, 0);
  const [, section, arg] = route.split('/');
  if (section === 'p' && find(arg)) {
    const p = find(arg);
    if (state.current?.product !== p) state.current = { product: p, sel: emptySelection(p), quantity: 1 };
    setContextTools(true);
    const c = state.current;
    view.innerHTML = `
      <a href="#/" class="back">← Menú</a>
      <article class="detail">
        <div class="art">${p.emoji}</div>
        <div>
          <p class="cat">${esc(p.category)}</p>
          <h1>${esc(p.name)}</h1>
          <p>${esc(p.description)}</p>
          ${p.groups.length ? `<div class="group"><h3>Tamaño</h3><div class="chips">${SIZES.map((s) => `<button data-size="${s.name}" class="${c.sel.size === s.name ? 'on' : ''}">${s.name} · ${s.ml} ml</button>`).join('')}</div></div>` : ''}
          ${p.groups.map((g) => `<div class="group"><h3>${esc(g.name)}${g.required ? ' <small>obligatorio</small>' : ''}</h3><div class="chips">${g.options.map((o) => { const q = c.sel.options[g.id]?.[o.name] ?? 0; return `<button data-opt="${esc(o.name)}" data-group="${esc(g.name)}" class="${q ? 'on' : ''}">${q > 1 ? `${q}× ` : ''}${esc(o.name)}${o.price ? ` +${money(o.price)}` : ''}</button>`; }).join('')}</div></div>`).join('')}
          <p class="missing">${missing(p, c.sel).join(' ')}</p>
          <button id="add" class="primary">Agregar · ${money(unitPrice(p, c.sel) * c.quantity)}</button>
        </div>
      </article>`;
    return;
  }
  state.current = null;
  setContextTools(false);
  if (section === 'cart' || section === 'checkout') {
    const cart = cartForAgent();
    const pending = section === 'checkout' && state.pending;
    view.innerHTML = `
      <h1>${section === 'checkout' ? 'Pago' : 'Tu carrito'}</h1>
      ${pending ? `<div class="confirm"><p class="tag">El asistente preparó tu pedido</p><p>Se cobrarán <strong>${money(cart.total)}</strong> de tu ${CARD.name} •••• ${CARD.last4}.</p><div class="row"><button id="pay" class="primary">Confirmar y pagar ${money(cart.total)}</button><button id="cancel">Cancelar</button></div><p class="small">Solo tú puedes confirmar un pago.</p></div>` : ''}
      ${cart.productos.length ? `<ul class="lines">${cart.productos.map((l) => `<li><span>${l.cantidad}× ${esc(l.nombre)}<small>${esc(l.personalizacion.join(' · '))}</small></span><strong>${money(l.total)}</strong></li>`).join('')}</ul>
        <p class="totals">Subtotal ${money(cart.subtotal)} · Delivery ${money(cart.delivery)} · <strong>Total ${money(cart.total)}</strong></p>
        ${section === 'cart' ? '<button id="toCheckout" class="primary">Ir a pagar</button>' : pending ? '' : `<button id="payManual" class="primary">Pagar ${money(cart.total)}</button>`}` : '<p>Tu carrito está vacío.</p>'}`;
    return;
  }
  if (section === 'order') {
    const o = state.orders.find((x) => x.id === arg);
    view.innerHTML = o ? `<div class="done"><h1>¡Gracias por tu compra!</h1><p>Pedido <strong>${o.id}</strong> · ${money(o.total)} · llega en ~${DELIVERY.minutes} min.</p><a href="#/">Volver al menú</a></div>` : '<p>Pedido no encontrado.</p>';
    return;
  }
  view.innerHTML = `
    <section class="hero"><h1>Café Juanito</h1><p>Tienda de ejemplo con tools WebMCP. Ábrela con WebMCP Flow y pídele al asistente lo que quieras.</p></section>
    <div class="grid">${PRODUCTS.map((p) => `<a class="card" href="#/p/${p.slug}"><span class="art">${p.emoji}</span><strong>${esc(p.name)}</strong><small>${esc(p.category)}</small><span>desde ${money(p.price)}</span></a>`).join('')}</div>`;
}

function pay() {
  const cart = cartForAgent();
  CARD.balance = Math.round((CARD.balance - cart.total) * 100) / 100;
  const order = { id: `CJ-${Math.random().toString(36).slice(2, 7).toUpperCase()}`, total: cart.total, items: cart.productos.map((l) => `${l.cantidad}× ${l.nombre}`) };
  state.orders.push(order);
  state.cart = [];
  const pending = state.pending;
  go(`#/order/${order.id}`);
  pending?.resolve('paid');
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.id === 'toolsBtn' || b.id === 'toolsClose') {
    const panel = $('#tools');
    panel.hidden = !panel.hidden;
    $('#toolsBtn').setAttribute('aria-expanded', String(!panel.hidden));
    renderTools();
    return;
  }
  if (b.dataset.run) {
    const t = toolDefs.get(b.dataset.run);
    const raw = document.querySelector(`[data-input="${CSS.escape(b.dataset.run)}"]`)?.value || '{}';
    let input;
    try { input = JSON.parse(raw); } catch { flash('El input no es JSON válido.'); return; }
    if (t) runTool(t, input, 'panel');
    return;
  }
  const c = state.current;
  if (b.dataset.size && c) { c.sel.size = b.dataset.size; render(); }
  else if (b.dataset.opt && c) {
    const g = c.product.groups.find((x) => x.name === b.dataset.group);
    const on = c.sel.options[g.id]?.[b.dataset.opt];
    const { sel } = applyRequest(c.product, { options: [{ option: b.dataset.opt, group: g.name, quantity: g.stepper ? ((on ?? 0) + 1) % (g.max + 1) : on ? 0 : 1 }] }, c.sel);
    c.sel = sel; render();
  } else if (b.id === 'add' && c) { const r = addLine(c.product, c.sel, c.quantity); if (r.error) flash(r.error); }
  else if (b.id === 'toCheckout') go('#/checkout');
  else if (b.id === 'pay' || b.id === 'payManual') pay();
  else if (b.id === 'cancel') { const p = state.pending; go('#/cart'); p?.resolve('cancelled'); }
});
window.addEventListener('hashchange', render);

$('#toolMode').textContent = mc
  ? (mc.__webmcpFlowShim ? 'Registradas en document.modelContext (capa compatible de WebMCP Flow).' : 'Registradas en document.modelContext (WebMCP nativo de Chrome).')
  : 'Este navegador no expone WebMCP: las tools solo se ven y se ejecutan en este panel.';
if (!mc) $('#nowebmcp').hidden = false;
GLOBAL_TOOLS.forEach((t) => register(t));
render();
