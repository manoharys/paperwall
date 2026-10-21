// A small accessibility checker for the browser tests, written for
// Paperwall: names for everything you can press or type in, no duplicate
// ids, alt text on pictures, labelled modal dialogs, visible focus, and
// colour contrast worked out from computed styles. It runs in the page.

/** Problems on the page as it is now: a list of short descriptions (empty when all is well). */
export async function audit(page) {
  return page.evaluate(() => {
    const problems = [];
    const shown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden], [aria-hidden="true"]');
    const describe = (el) => {
      const id = el.dataset?.testid ? `[data-testid="${el.dataset.testid}"]` : el.id ? `#${el.id}` : el.className ? `.${String(el.className).split(' ')[0]}` : '';
      return `<${el.tagName.toLowerCase()}${id ? ` ${id}` : ''}>`;
    };
    const text = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();

    // The accessible name, in the order browsers look for one (simplified).
    const nameOf = (el) => {
      const by = el.getAttribute('aria-labelledby');
      if (by) {
        const t = by.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map(text).join(' ').trim();
        if (t) return t;
      }
      const label = el.getAttribute('aria-label');
      if (label?.trim()) return label.trim();
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) {
        if (el.id) {
          const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
          if (l && text(l)) return text(l);
        }
        const wrap = el.closest('label');
        if (wrap) {
          const copy = wrap.cloneNode(true);
          copy.querySelectorAll('input, select, textarea').forEach((x) => x.remove());
          const t = (copy.textContent || '').replace(/\s+/g, ' ').trim();
          if (t) return t;
        }
        if (el.placeholder?.trim()) return el.placeholder.trim();
      } else {
        const t = text(el) || [...el.querySelectorAll('img[alt]')].map((i) => i.alt).join(' ').trim();
        if (t) return t;
      }
      return el.getAttribute('title')?.trim() || '';
    };

    // 1. Everything you can press or type in has a name.
    const controls = document.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"], [role="option"], [role="application"]');
    for (const el of controls) {
      if (!shown(el)) continue;
      if (!nameOf(el)) problems.push(`no accessible name: ${describe(el)}`);
    }

    // 2. No id is used twice.
    const seen = new Map();
    for (const el of document.querySelectorAll('[id]')) {
      // (Ids inside drawn designs are their own SVG's, prefixed per drawing.)
      if (el.closest('svg')) continue;
      seen.set(el.id, (seen.get(el.id) || 0) + 1);
    }
    for (const [id, n] of seen) if (n > 1) problems.push(`id used ${n} times: #${id}`);

    // 3. Pictures say what they are (or that they're decoration: alt="").
    for (const img of document.querySelectorAll('img')) if (!img.hasAttribute('alt')) problems.push(`image without alt: ${describe(img)}`);

    // 4. Modal dialogs are announced as such, with a name.
    for (const d of document.querySelectorAll('.dialog, [role="dialog"]')) {
      if (d.getAttribute('role') !== 'dialog') problems.push(`dialog without role=dialog: ${describe(d)}`);
      if (d.getAttribute('aria-modal') !== 'true') problems.push(`dialog without aria-modal: ${describe(d)}`);
      if (!nameOf(d) && !d.getAttribute('aria-label')) problems.push(`dialog without a label: ${describe(d)}`);
    }
    return problems;
  });
}

/**
 * Text that doesn't reach WCAG AA contrast (4.5:1, or 3:1 for large text)
 * against what's behind it, for every shown element matching `selectors`.
 * The background is the nearest solid one behind the element.
 */
export async function contrastProblems(page, selectors) {
  return page.evaluate((list) => {
    const parse = (c) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const [r, g, b, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      return { r, g, b, a };
    };
    const lum = ({ r, g, b }) => {
      const f = (v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const over = (top, under) => ({
      r: top.r * top.a + under.r * (1 - top.a),
      g: top.g * top.a + under.g * (1 - top.a),
      b: top.b * top.a + under.b * (1 - top.a),
      a: 1,
    });
    // The colour behind an element: its own and its ancestors' backgrounds, layered.
    const behind = (el) => {
      const layers = [];
      for (let e = el; e; e = e.parentElement) {
        const c = parse(getComputedStyle(e).backgroundColor);
        if (c && c.a > 0) {
          layers.push(c);
          if (c.a >= 1) break;
        }
      }
      let out = { r: 255, g: 255, b: 255, a: 1 };
      for (const c of layers.reverse()) out = over(c, out);
      return out;
    };
    const problems = [];
    const checked = [];
    for (const sel of list) {
      for (const el of document.querySelectorAll(sel)) {
        if (!el.getClientRects().length || !(el.innerText || '').trim()) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || +cs.opacity === 0) continue;
        // (Disabled controls are exempt from contrast rules.)
        if (el.disabled || el.closest('[disabled]')) continue;
        const fg = parse(cs.color);
        if (!fg) continue;
        const bg = behind(el);
        const front = over(fg, bg);
        const [hi, lo] = [lum(front), lum(bg)].sort((a, b) => b - a);
        const ratio = (hi + 0.05) / (lo + 0.05);
        const size = parseFloat(cs.fontSize);
        const bold = +cs.fontWeight >= 700;
        const large = size >= 24 || (bold && size >= 18.66);
        const need = large ? 3 : 4.5;
        checked.push(sel);
        if (ratio < need - 0.01) problems.push(`${sel} "${el.innerText.trim().slice(0, 30)}": ${ratio.toFixed(2)} < ${need} (${cs.color} on rgb(${bg.r | 0}, ${bg.g | 0}, ${bg.b | 0}))`);
      }
    }
    return { problems, checked: [...new Set(checked)] };
  }, selectors);
}

/** Press Tab (or Shift+Tab) until `selector` has focus; fails after `max` presses. */
export async function tabTo(page, selector, { back = false, max = 150 } = {}) {
  for (let i = 0; i < max; i++) {
    if (await page.evaluate((s) => document.activeElement?.matches(s), selector)) return;
    await page.keyboard.press(back ? 'Shift+Tab' : 'Tab');
  }
  throw new Error(`Tab never reached ${selector}; focus is on ${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120))}`);
}

/** The focused element's data-testid (or tag name). */
export function focused(page) {
  return page.evaluate(() => document.activeElement?.dataset.testid || document.activeElement?.tagName.toLowerCase());
}
