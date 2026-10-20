// Templates in the browser: laid out with their real fonts, once.

import { templateDoc, templateFonts } from '../templates/index.js';
import { clone } from '../model/doc.js';
import { measure, ensureFont, fontLoaded } from './fonts.js';

const ready = new Map(); // template id -> Promise of its laid-out design

/**
 * A template laid out with its real fonts, ready to show, open or add. The
 * layout is done once per template and each call gets its own copy. If a font
 * failed to load, the result isn't kept, so the next call tries again.
 */
export async function readyTemplate(t) {
  let job = ready.get(t.id);
  if (!job) {
    job = (async () => {
      const spec = t.build();
      const fonts = templateFonts(t, spec);
      await Promise.all(fonts.map(({ font, weight }) => ensureFont(font.name, weight)));
      const doc = templateDoc(t, measure, spec);
      if (!fonts.every(({ font, weight }) => fontLoaded(font.name, weight))) ready.delete(t.id);
      return doc;
    })();
    ready.set(t.id, job);
    job.catch(() => ready.delete(t.id));
  }
  return clone(await job);
}
