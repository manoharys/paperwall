// Renders and checks templates in a real browser with the real fonts. Used by
// the template quality gate test, and handy by eye: open
// http://127.0.0.1:5173/test/qa/templates.html with `npm run dev` running.

import { TEMPLATES, templateDoc } from '../../src/templates/index.js';
import { registerFonts, ensureDesignFonts, measure } from '../../src/app/fonts.js';
import { renderPage } from '../../src/model/render.js';
import { lintDesign } from '../../src/model/lint.js';

registerFonts();

async function check(t) {
  await ensureDesignFonts(templateDoc(t));
  const doc = templateDoc(t, measure);
  return { doc, issues: lintDesign(doc, measure) };
}

async function run(ids = TEMPLATES.map((t) => t.id)) {
  const out = [];
  for (const id of ids) {
    const t = TEMPLATES.find((x) => x.id === id);
    const { doc, issues } = await check(t);
    out.push({ id, pages: doc.pages.length, issues });
  }
  return out;
}

async function show({ only = null, bad = false } = {}) {
  const grid = document.getElementById('grid');
  grid.textContent = '';
  for (const t of TEMPLATES) {
    if (only && !only.includes(t.category) && !only.includes(t.id)) continue;
    const { doc, issues } = await check(t);
    if (bad && !issues.length) continue;
    doc.pages.forEach((_, i) => {
      const fig = document.createElement('figure');
      if (issues.length) fig.className = 'bad';
      fig.innerHTML = renderPage(doc, i, { measure, noSize: true, idPrefix: `q${t.id}-${i}` });
      const cap = document.createElement('figcaption');
      cap.textContent = `${t.id}${doc.pages.length > 1 ? ` p${i + 1}` : ''}${issues.length ? ` — ${issues.map((x) => x.message).join('; ')}` : ''}`;
      fig.append(cap);
      grid.append(fig);
    });
  }
}

window.qa = { run, show, ids: TEMPLATES.map((t) => t.id), categories: [...new Set(TEMPLATES.map((t) => t.category))] };
window.qaReady = true;
