# Changelog

All notable changes to WebMCP Flow. Versions follow [Semantic Versioning](https://semver.org/); dates are YYYY-MM-DD.

## [0.4.0] - 2026-10-05
### Added
- Public repository with CI (GitHub Actions): smoke test plus the full purchase flow with four simulated providers on every push, a store-ready `.zip`, releases on `v*` tags and GitHub Pages deployment.
- Sample WebMCP shop (`docs/demo`, "Café Juanito") used by CI and the project page.
- Console: **Export trace (JSON)** button to attach to bug reports (API keys stay masked).
- Issue and pull request templates.
### Changed
- Extension files moved to `extension/` (load that folder in Developer mode).

## [0.3.0] - 2026-10-05
### Changed
- Per-site activation: scripts are registered with `chrome.scripting` only for `localhost`, `127.0.0.1` and the sites you enable from the toolbar icon. Chrome no longer warns about "all sites".
### Added
- Toolbar popup with Enable/Disable on this site and Open chat; list of active sites in Settings.
- Spanish and English interface (`_locales`), following Chrome's language.
- Notice in Settings before Chrome asks permission for a self-hosted model server.

## [0.2.1] - 2026-10-05
### Added
- With no WebMCP tools on the page, the chat says so right away (without calling the model) and explains what to check.
- If the page script does not answer, the chat asks to reload the page.
- The assistant says clearly when no tool fits the request; an empty model reply shows a notice.

## [0.2.0] - 2026-10-05
### Added
- Providers: Claude (Anthropic Messages adapter), Groq, OpenRouter and any OpenAI-compatible server.
- Key, model and URL stored per provider; v0.1 settings migrate automatically.
### Changed
- Clearer error messages (404 → check URL and model).

## [0.1.1] - 2026-10-05
### Fixed
- The chat collapses into a small bar while a tool waits for the person, so it no longer covers buttons such as "Confirm and pay".
- LM Studio token usage now shows in the console (`stream_options.include_usage`).

## [0.1.0] - 2026-10-05
### Added
- First prototype: floating chat (Shadow DOM), WebMCP tool detection (native or compatibility shim), Gemini and LM Studio, read-only debug console, memory across navigation and reloads.

[0.4.0]: https://github.com/yahyrparedes/webmcp-flow/releases/tag/v0.4.0
