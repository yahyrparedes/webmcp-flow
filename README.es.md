# WebMCP Flow

[![CI](https://github.com/yahyrparedes/webmcp-flow/actions/workflows/ci.yml/badge.svg)](https://github.com/yahyrparedes/webmcp-flow/actions/workflows/ci.yml)

**Prueba de punta a punta las tools WebMCP de tu web, con un chat que las usa como lo haría un agente de IA.** · [English](README.md) · [Página del proyecto](https://yahyrparedes.github.io/webmcp-flow/)

WebMCP Flow es una extensión de Chrome para equipos que exponen tools [WebMCP](https://github.com/webmachinelearning/webmcp) en sus webs. Abres tu web, escribes lo que pediría un cliente ("agrega el latte más barato y llévame a pagar") y ves cómo el modelo que elijas completa la tarea usando **solo las tools de tu página**. Una consola de debug muestra cada llamada al modelo y a cada tool. También sirve para hacer demos en vivo fuera del equipo.

![WebMCP Flow pidiendo un latte en la tienda de ejemplo](docs/assets/demo.gif)

> Estado: 0.4.0, prototipo. Licencia MIT.

---

## Usarla (probar tu web)

### Qué hace

- **Chat flotante** en tu página (Shadow DOM: no choca con tus estilos).
- **Detecta tus tools WebMCP** registradas con `document.modelContext` / `navigator.modelContext`. Sin el flag de WebMCP de Chrome instala un *shim* compatible y tus tools se registran igual.
- **Flujos completos con memoria**: la conversación sobrevive a la navegación y a las recargas; las tools de cada pantalla se refrescan en cada paso.
- **Pasos humanos**: si una tool espera a la persona (por ejemplo, confirmar un pago en la página), el chat se recoge y espera.
- **Fallos claros**: si la página no tiene tools, te dice qué revisar en lugar de adivinar.
- **Consola de debug** (`>_`): cada `POST` al modelo (endpoint, headers con la key enmascarada, request, response, tokens, tiempo) y cada tool. **Exportar traza (JSON)** para adjuntarla a un issue.
- **Solo donde la activas**: `localhost` y `127.0.0.1` por defecto; cualquier otro sitio desde el ícono → *Activar en este sitio*.
- Interfaz en español e inglés.

### Instalar

Desde Chrome Web Store: *próximamente*. Mientras tanto, en modo desarrollador:

1. Descarga el último `webmcp-flow-x.y.z.zip` desde [Releases](https://github.com/yahyrparedes/webmcp-flow/releases) y descomprímelo (o clona este repositorio).
2. Abre `chrome://extensions` y activa **Modo de desarrollador**.
3. **Cargar descomprimida** → elige la carpeta descomprimida (en un clon, la carpeta `extension/`).
4. Abre tu web en `localhost`. El chat muestra *Configura tu asistente* → **Abrir ajustes**.

### Elegir modelo

| Proveedor | Key | Modelo por defecto |
|---|---|---|
| Gemini | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | `gemini-3.8-flash` |
| Claude (Anthropic) | [console.anthropic.com](https://console.anthropic.com/settings/keys) | `claude-sonnet-5-5` |
| Groq | [console.groq.com/keys](https://console.groq.com/keys) | `openai/gpt-oss-120b` |
| OpenRouter | [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys) | `openai/gpt-oss-120b` |
| LM Studio | no hace falta | el modelo cargado (`http://localhost:1234/v1`) |
| Otro (compatible con OpenAI) | opcional | obligatorio (Mistral, DeepSeek, xAI, Ollama, vLLM…) |

Usa un modelo con *tool calling*. Si LM Studio está en tu misma computadora, usa `localhost`: así Chrome no pide permisos.

### Preparar tu web

```js
const mc = document.modelContext || navigator.modelContext;
mc?.registerTool({
  name: 'search_products',
  description: 'Busca productos por nombre. Devuelve slug, nombre y precio.',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  async execute({ query }) {
    return { resultados: await api.search(query) };
  },
});
```

- Devuelve **errores legibles** como datos (`{ error: "El carrito está vacío." }`) en lugar de lanzar excepciones: el modelo los lee y se corrige.
- Registra las **tools de cada pantalla** mientras esa pantalla está abierta (con un `AbortSignal`).
- Deja los pasos sensibles en manos de la persona: la tool prepara el pago y espera a que pulse el botón en tu página.

Pruébala sin montar nada: [Café Juanito](https://yahyrparedes.github.io/webmcp-flow/demo/), la tienda de ejemplo (actívala desde el ícono de la extensión).

### Privacidad

La key se guarda solo en tu navegador (`chrome.storage.local`), se edita en los ajustes de la extensión (nunca dentro de la web que pruebas) y se envía solo al proveedor que elegiste. No hay servidor intermedio. Lo que envías va a ese proveedor bajo sus condiciones: usa datos de prueba. [Política completa](https://yahyrparedes.github.io/webmcp-flow/privacy.html).

---

## Desarrollar (contribuir)

```bash
npm ci
npx playwright install chromium
npm test            # prueba rápida + flujo de compra con 4 proveedores simulados
npm run package     # dist/webmcp-flow-<versión>.zip para Chrome Web Store
```

Estructura, pruebas, flujo de versiones y workflows: ver la sección [Develop](README.md#develop-contribute) del README en inglés.

**Publicar una versión:** sube la versión en `package.json` y `extension/manifest.json`, agrégala a `CHANGELOG.md` y empuja el tag (`git tag v0.4.1 && git push origin v0.4.1`). El workflow *Release* corre las pruebas y adjunta el zip al release.

**Reportar un fallo:** usa la plantilla de [reporte de fallo](https://github.com/yahyrparedes/webmcp-flow/issues/new?template=bug_report.yml) y adjunta la traza exportada de la consola.

## Licencia

[MIT](LICENSE) © 2026 Yahyr Paredes
