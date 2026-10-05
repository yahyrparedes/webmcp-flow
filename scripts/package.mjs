// Empaqueta extension/ en dist/webmcp-flow-<versión>.zip para Chrome Web Store (sin test/, docs/ ni node_modules).
// --check: solo verifica que package.json y extension/manifest.json tengan la misma versión.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (manifest.version !== pkg.version) {
  console.error(`Versiones distintas: manifest ${manifest.version} · package.json ${pkg.version}`);
  process.exit(1);
}
const tag = process.env.GITHUB_REF_NAME;
if (tag?.startsWith('v') && tag.slice(1) !== manifest.version) {
  console.error(`El tag ${tag} no coincide con la versión ${manifest.version}`);
  process.exit(1);
}
if (process.argv.includes('--check')) { console.log(`Versión ${manifest.version} OK`); process.exit(0); }

const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });
const out = path.join(dist, `webmcp-flow-${manifest.version}.zip`);
fs.rmSync(out, { force: true });
execFileSync('zip', ['-r', '-X', '-q', out, '.', '-x', '*.DS_Store'], { cwd: path.join(root, 'extension'), stdio: 'inherit' });
console.log(`${path.relative(root, out)} (${(fs.statSync(out).size / 1024).toFixed(1)} KB)`);
