// AI design (an online extra): describe a design in a sentence, pick a size,
// and get a new, fully editable design (or three to pick from). The model
// answers in a small schema (see src/model/ai.js), never the design format.

import { h, clear, toast } from './ui.js';
import { PROVIDERS, providerFor } from './online.js';
import { complete, aiReady, aiSetup, isAbort } from './ai.js';
import { DESIGN_SIZES, designPrompt, parseJsonReply, designSpecs, specFonts, designsFromReply } from '../model/ai.js';
import { presetById } from '../model/doc.js';
import { renderPage } from '../model/render.js';
import { ensureFont, measure } from './fonts.js';

/** The "Describe a design" block for the home screen. `newDesign(doc, opts)` opens a design. */
export function aiDesignBlock({ newDesign }) {
  const text = h('textarea', { rows: '2', maxlength: '1000', placeholder: 'For example: a poster for a bake sale on Saturday, in pastel colors', 'aria-label': 'Describe a design', 'data-testid': 'ai-design-prompt' });
  const size = h('select', { 'aria-label': 'Size', 'data-testid': 'ai-design-size' }, DESIGN_SIZES.map((p) => h('option', { value: p.id }, p.name)));
  size.value = 'portrait';
  const count = h('select', { 'aria-label': 'How many', 'data-testid': 'ai-design-count' }, h('option', { value: '1' }, 'One design'), h('option', { value: '3' }, 'Three to pick from'));
  const go = h('button', { type: 'submit', class: 'btn primary', 'data-testid': 'ai-design-go' }, 'Make it');
  const status = h('div', { class: 'ai-status', 'data-testid': 'ai-design-status' });
  let controller = null;

  const say = (...nodes) => clear(status).append(...nodes);
  const make = async () => {
    const description = text.value.trim();
    if (!description) return text.focus();
    if (controller) return;
    // (Held at once, so a second press meanwhile doesn't send another request.)
    const job = (controller = new AbortController());
    if (!(await aiReady('design').catch(() => false))) {
      controller = null;
      return say(aiSetup('design', { onDone: () => (say(), make()), onCancel: () => say() }));
    }
    const preset = presetById(size.value);
    const n = +count.value;
    go.disabled = true;
    say(h('div', { class: 'ai-progress', role: 'status', 'data-testid': 'ai-design-progress' },
      h('span', { class: 'ai-spinner', 'aria-hidden': 'true' }),
      h('span', null, `Designing with ${PROVIDERS[await providerFor('design')].name}…`),
      h('button', { type: 'button', class: 'btn small', 'data-testid': 'ai-design-cancel', onClick: () => job.abort() }, 'Cancel')));
    try {
      const { system, prompt } = designPrompt(description, { width: preset.w, height: preset.h, count: n });
      const answer = await complete({ feature: 'design', system, prompt, json: true, maxTokens: n > 1 ? 8000 : 4000, signal: job.signal });
      // Its fonts first, so text is measured as it will look.
      const specs = designSpecs(parseJsonReply(answer));
      await Promise.all(specs.flatMap(specFonts).map(({ font, weight }) => ensureFont(font, weight)));
      if (job.signal.aborted) throw new DOMException('Stopped', 'AbortError');
      const docs = designsFromReply(answer, { preset: preset.id, measure, description });
      if (docs.length === 1) return newDesign(docs[0], { fit: true });
      say(h('p', { class: 'hint' }, 'Pick one to open. Everything in it can be changed.'),
        h('div', { class: 'ai-choices', 'data-testid': 'ai-design-choices' }, docs.map((doc, i) => h('button', {
          type: 'button', class: 'ai-choice', 'aria-label': `Open design ${i + 1}: ${doc.name}`, 'data-testid': 'ai-design-choice',
          onClick: () => newDesign(doc, { fit: true }),
        }, h('span', { class: 'ai-choice-img', style: { aspectRatio: `${doc.width} / ${doc.height}` }, html: renderPage(doc, 0, { measure, noSize: true, idPrefix: `ai${i}-` }) }), h('small', null, doc.name)))));
    } catch (e) {
      if (isAbort(e)) return say();
      say(h('p', { class: 'ai-error', role: 'alert', 'data-testid': 'ai-design-error' }, e.message));
      toast(e.message, 'error');
    } finally {
      if (controller === job) controller = null;
      go.disabled = false;
    }
  };

  return h('section', { class: 'block', 'data-testid': 'ai-design' },
    h('div', { class: 'block-head' }, h('h2', null, 'Describe a design'),
      h('button', { type: 'button', class: 'link-btn', 'data-testid': 'ai-design-settings', onClick: () => say(aiSetup('design', { onDone: () => say(), onCancel: () => say() })) }, 'AI setup')),
    h('form', { class: 'ai-design-form', onSubmit: (e) => {
      e.preventDefault();
      if (!controller) make();
    } }, text, h('div', { class: 'row' }, size, count, go)),
    h('p', { class: 'fine' }, 'An online extra: your description goes to the AI provider you pick, with your own key. You get an ordinary design to edit.'),
    status);
}
