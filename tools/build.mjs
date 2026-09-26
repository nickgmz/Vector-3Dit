#!/usr/bin/env node
// Bundles Vector 3Dit into one self-contained HTML file (CSS and JS inlined).
//   node tools/build.mjs                 → dist/vector-3dit.html
//   node tools/build.mjs --artifact out  → page-content variant without <html>/<head>/<body> wrappers
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

const scriptBlock = /<!-- build:scripts -->([\s\S]*?)<!-- \/build:scripts -->/.exec(html);
if (!scriptBlock) throw new Error('index.html is missing the build:scripts markers');
const files = [...scriptBlock[1].matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
const js = files
  .map((f) => `/* ---- ${f} ---- */\n` + readFileSync(join(root, f), 'utf8'))
  .join('\n')
  // Never let a string literal close the inline script early.
  .replace(/<\/script/gi, '<\\/script');
const css = readFileSync(join(root, 'css', 'app.css'), 'utf8');

// One self-contained file: the favicon links become one embedded PNG icon.
const icon = 'data:image/png;base64,' + readFileSync(join(root, 'brand', 'vector-3dit-64.png')).toString('base64');
let out = html
  .replace(/<link rel="icon"[^>]*>\s*<link rel="icon"[^>]*>\s*<link rel="apple-touch-icon"[^>]*>/, () => `<link rel="icon" type="image/png" href="${icon}">`)
  .replace('<link rel="stylesheet" href="css/app.css">', () => `<style>\n${css}\n</style>`)
  .replace(scriptBlock[0], () => `<script>\n${js}\n</script>`);

const args = process.argv.slice(2);
const ai = args.indexOf('--artifact');
if (ai >= 0) {
  // Artifact hosts add their own document skeleton: keep only title, styles, fonts and body content.
  const head = /<head>([\s\S]*?)<\/head>/.exec(out)[1].replace(/<meta[^>]*>\s*/g, '');
  const body = /<body>([\s\S]*?)<\/body>/.exec(out)[1];
  // Hosted previews block script downloads: route saves to copy/preview dialogs instead.
  out = head.trim() + '\n<script>globalThis.V3D_NO_DOWNLOAD = true;</script>\n' + body.trim() + '\n';
  const target = args[ai + 1] || join(root, 'dist', 'vector-3dit.artifact.html');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, out);
  console.log('wrote', target, (out.length / 1024).toFixed(0) + ' KB');
} else {
  const target = join(root, 'dist', 'vector-3dit.html');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, out);
  console.log('wrote', target, (out.length / 1024).toFixed(0) + ' KB', `(${files.length} scripts)`);
}
