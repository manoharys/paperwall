// Templates in the browser: laid out with their real fonts, once.

import { templateDoc, templateFonts } from '../templates/index.js';
import { clone } from '../model/doc.js';
import { measure, ensureFont } from './fonts.js';

const ready = new Map(); // template id -> Promise of its laid-out design

/**
 * A template laid out with its real fonts, ready to show, open or add. The
 * layout is done once per template; each call gets its own copy.
 */
export async function readyTemplate(t) {
  if (!ready.has(t.id)) {
    ready.set(t.id, (async () => {
      await Promise.all(templateFonts(t).map(({ font, weight }) => ensureFont(font.name, weight)));
      return templateDoc(t, measure);
    })());
  }
  return clone(await ready.get(t.id));
}
