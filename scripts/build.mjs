// Builds Paperwall into self-contained files, with no bundler dependency:
//   dist/paperwall.html  the whole app in one file; works when opened from disk
//   dist/index.html    the same app for hosting, plus offline support (PWA)
//   dist/sw.js, dist/manifest.webmanifest, dist/icons/*
//
// Modules are wrapped in functions and linked in dependency order. The app
// code only uses named imports and exports, which keeps this simple.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { onlineHosts } from '../src/model/providers.js';

const root = resolve(new URL('..', import.meta.url).pathname);
const dist = join(root, 'dist');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

// ---------- bundling ----------

const IMPORT_RE = /^import\s+(?:\{([^}]*)\}|\*\s+as\s+(\w+))\s+from\s+['"](\.[^'"]+)['"];?\s*$/gm;

export function bundle(entry) {
  const modules = new Map(); // path -> { id, code, deps }
  const order = [];
  const visiting = new Set();
  const visit = (file) => {
    if (modules.has(file)) return modules.get(file);
    if (visiting.has(file)) throw new Error(`Circular import: ${relative(root, file)}`);
    visiting.add(file);
    const src = readFileSync(file, 'utf8');
    if (/^\s*export\s+default\b/m.test(src)) throw new Error(`${relative(root, file)}: default exports aren't supported`);
    if (/\bimport\s*\(/.test(src)) throw new Error(`${relative(root, file)}: dynamic import() isn't supported`);
    const deps = [];
    for (const m of src.matchAll(IMPORT_RE)) deps.push(resolve(dirname(file), m[3]));
    for (const d of deps) visit(d);
    const mod = { id: order.length, file, src };
    modules.set(file, mod);
    order.push(mod);
    visiting.delete(file);
    return mod;
  };
  visit(resolve(entry));

  const out = ['(() => {', '"use strict";', 'const __m = [];'];
  for (const mod of order) {
    const names = new Set();
    let code = mod.src.replace(IMPORT_RE, (_, named, ns, spec) => {
      const dep = modules.get(resolve(dirname(mod.file), spec));
      if (ns) return `const ${ns} = __m[${dep.id}];`;
      const parts = named.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
        const [a, b] = s.split(/\s+as\s+/);
        return b ? `${a}: ${b}` : a;
      });
      return `const { ${parts.join(', ')} } = __m[${dep.id}];`;
    });
    if (/^\s*import\s/m.test(code)) throw new Error(`${relative(root, mod.file)}: unsupported import form`);
    code = code.replace(/^export\s+(async\s+function\*?|function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm, (_, kind, name) => {
      names.add(name);
      return `${kind} ${name}`;
    });
    code = code.replace(/^export\s*\{([^}]*)\};?\s*$/gm, (_, list) => {
      for (const n of list.split(',').map((s) => s.trim()).filter(Boolean)) names.add(n);
      return '';
    });
    if (/^\s*export\s/m.test(code)) throw new Error(`${relative(root, mod.file)}: unsupported export form`);
    out.push(`// ${relative(root, mod.file)}`);
    out.push(`__m[${mod.id}] = (() => {\n${code}\nreturn { ${[...names].join(', ')} };\n})();`);
  }
  out.push('})();');
  return { code: out.join('\n'), files: order.map((m) => relative(root, m.file)) };
}

// ---------- assets ----------

function fontData() {
  const dir = join(root, 'assets/fonts');
  const fonts = {};
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.woff2')).sort()) {
    fonts[f] = `data:font/woff2;base64,${readFileSync(join(dir, f)).toString('base64')}`;
  }
  return fonts;
}

function sha256(text) {
  return `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
}

function csp(scriptHashes, pwa) {
  return [
    "default-src 'none'",
    `script-src ${scriptHashes.join(' ')}`,
    "style-src 'unsafe-inline'",
    pwa ? "img-src 'self' data: blob:" : 'img-src data: blob:',
    pwa ? "font-src 'self' data:" : 'font-src data:',
    'media-src data: blob:',
    // Only the online extras' providers, and only once someone turns one on
    // (src/app/online.js); nothing else, ever. The hosted page may also fetch
    // its own font files.
    `connect-src ${[...(pwa ? ["'self'"] : []), ...onlineHosts()].join(' ')}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ].join('; ');
}

/** Build one HTML file. pwa: link the manifest and register the service worker. */
export function buildHtml({ pwa = false } = {}) {
  const { code, files } = bundle(join(root, 'src/app/main.js'));
  const css = readFileSync(join(root, 'src/app/styles.css'), 'utf8');
  // The one-file app carries every font inside it. The hosted page stays light:
  // its fonts sit beside it in fonts/ and arrive as designs need them.
  const assets = (pwa ? 'globalThis.PAPERWALL_FONTS = "fonts/";\n' : `globalThis.PAPERWALL_ASSETS = ${JSON.stringify({ fonts: fontData() })};\n`) +
    `globalThis.PAPERWALL_VERSION = ${JSON.stringify(pkg.version)};\n` +
    (pwa ? 'globalThis.PAPERWALL_SW = "sw.js";\n' : '');
  const scripts = [assets, code];
  let html = readFileSync(join(root, 'src/app/index.html'), 'utf8');
  html = html.replace('<!--CSP-->', () => `<meta http-equiv="Content-Security-Policy" content="${csp(scripts.map(sha256), pwa)}">`);
  html = html.replace('<!--HEAD-->', pwa
    ? '<link rel="manifest" href="manifest.webmanifest">\n<link rel="apple-touch-icon" href="icons/icon-192.png">\n' +
      '<meta property="og:title" content="Paperwall: design anything, free and offline">\n' +
      '<meta property="og:description" content="An open-source design tool that runs on your device. No account, no watermark, no paywall.">\n' +
      '<meta property="og:url" content="https://manoharys.github.io/paperwall/">\n' +
      '<meta property="og:image" content="https://manoharys.github.io/paperwall/og.png">\n<meta name="twitter:card" content="summary_large_image">'
    : '');
  // Function replacements, so "$&" and friends in the code stay literal.
  html = html.replace('<link rel="stylesheet" href="/src/app/styles.css">', () => `<style>\n${css}\n</style>`);
  html = html.replace('<script type="module" src="/src/app/main.js"></script>', () => scripts.map((s) => `<script>${s}</script>`).join('\n'));
  if (html.includes('/src/')) throw new Error('A /src/ reference survived the build');
  return { html, files };
}

function fontFileNames() {
  return readdirSync(join(root, 'assets/fonts')).filter((f) => f.endsWith('.woff2')).sort();
}

function serviceWorker(version) {
  return `// Paperwall works offline: this caches the app on the first visit, and then
// every font in the background, so any design opens offline later.
const CACHE = 'paperwall-${version}';
const FILES = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];
const FONTS = ${JSON.stringify(fontFileNames().map((f) => `./fonts/${f}`))};
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
async function cacheFonts() {
  const c = await caches.open(CACHE);
  const missing = [];
  for (const f of FONTS) if (!(await c.match(f))) missing.push(f);
  for (let i = 0; i < missing.length; i += 8) {
    await Promise.all(missing.slice(i, i + 8).map((f) => c.add(f).catch(() => null)));
  }
}
self.addEventListener('message', (e) => {
  if (e.data !== 'cache-fonts') return;
  e.waitUntil(cacheFonts().then(() => e.source?.postMessage('fonts-cached')));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).then((res) => {
    const copy = res.clone();
    if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, copy));
    return res;
  }).catch(() => caches.match('./index.html'))));
});
`;
}

function manifest() {
  return JSON.stringify({
    name: 'Paperwall',
    short_name: 'Paperwall',
    description: 'Free design tool that works offline. No account, no watermark.',
    start_url: './',
    scope: './',
    display: 'standalone',
    background_color: '#f7f4ef',
    theme_color: '#f25c2a',
    icons: [
      { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  }, null, 2);
}

export function build() {
  if (existsSync(dist)) rmSync(dist, { recursive: true });
  mkdirSync(join(dist, 'icons'), { recursive: true });
  const single = buildHtml({ pwa: false });
  const hosted = buildHtml({ pwa: true });
  writeFileSync(join(dist, 'paperwall.html'), single.html);
  writeFileSync(join(dist, 'index.html'), hosted.html);
  mkdirSync(join(dist, 'fonts'), { recursive: true });
  for (const f of fontFileNames()) copyFileSync(join(root, 'assets/fonts', f), join(dist, 'fonts', f));
  writeFileSync(join(dist, 'sw.js'), serviceWorker(pkg.version));
  writeFileSync(join(dist, 'manifest.webmanifest'), manifest());
  for (const f of ['icon-192.png', 'icon-512.png']) copyFileSync(join(root, 'assets/icons', f), join(dist, 'icons', f));
  copyFileSync(join(root, 'assets/icons/og.png'), join(dist, 'og.png'));
  return { files: single.files, size: Buffer.byteLength(single.html) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { files, size } = build();
  console.log(`Bundled ${files.length} modules. dist/paperwall.html is ${(size / 1024).toFixed(0)} KB.`);
}
