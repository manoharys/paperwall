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
import { t } from './i18n.js';
import { presetName } from './names.js';

/** The "Describe a design" block for the home screen. `newDesign(doc, opts)` opens a design. */
export function aiDesignBlock({ newDesign }) {
  const text = h('textarea', { rows: '2', maxlength: '1000', placeholder: t('aiDesign.placeholder'), 'aria-label': t('aiDesign.title'), 'data-testid': 'ai-design-prompt' });
  const size = h('select', { 'aria-label': t('common.size'), 'data-testid': 'ai-design-size' }, DESIGN_SIZES.map((p) => h('option', { value: p.id }, presetName(p))));
  size.value = 'portrait';
  const count = h('select', { 'aria-label': t('aiDesign.howMany'), 'data-testid': 'ai-design-count' }, h('option', { value: '1' }, t('aiDesign.one')), h('option', { value: '3' }, t('aiDesign.three')));
  const go = h('button', { type: 'submit', class: 'btn primary', 'data-testid': 'ai-design-go' }, t('aiDesign.go'));
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
    const providerId = await providerFor('design');
    if (job.signal.aborted) return void (controller = null); // (stopped meanwhile: AI setup was opened)
    const preset = presetById(size.value);
    const n = +count.value;
    go.disabled = true;
    say(h('div', { class: 'ai-progress', role: 'status', 'data-testid': 'ai-design-progress' },
      h('span', { class: 'ai-spinner', 'aria-hidden': 'true' }),
      h('span', null, t('aiDesign.working', { name: PROVIDERS[providerId].name })),
      h('button', { type: 'button', class: 'btn small', 'data-testid': 'ai-design-cancel', onClick: () => job.abort() }, t('common.cancel'))));
    try {
      const { system, prompt } = designPrompt(description, { width: preset.w, height: preset.h, count: n });
      const answer = await complete({ feature: 'design', system, prompt, json: true, maxTokens: n > 1 ? 8000 : 4000, signal: job.signal });
      // Its fonts first, so text is measured as it will look.
      const specs = designSpecs(parseJsonReply(answer));
      await Promise.all(specs.flatMap(specFonts).map(({ font, weight }) => ensureFont(font, weight)));
      if (job.signal.aborted) throw new DOMException('Stopped', 'AbortError');
      const docs = designsFromReply(answer, { preset: preset.id, measure, description });
      if (docs.length === 1) return newDesign(docs[0], { fit: true });
      say(h('p', { class: 'hint' }, t('aiDesign.pick')),
        h('div', { class: 'ai-choices', 'data-testid': 'ai-design-choices' }, docs.map((doc, i) => h('button', {
          type: 'button', class: 'ai-choice', 'aria-label': t('aiDesign.open', { n: i + 1, name: doc.name }), 'data-testid': 'ai-design-choice',
          onClick: () => newDesign(doc, { fit: true }),
        }, h('span', { class: 'ai-choice-img', style: { aspectRatio: `${doc.width} / ${doc.height}` }, html: renderPage(doc, 0, { measure, noSize: true, idPrefix: `ai${i}-` }) }), h('small', null, doc.name)))));
    } catch (e) {
      if (isAbort(e)) return void (status.querySelector('.ai-progress') && say()); // (AI setup may be showing instead)
      say(h('p', { class: 'ai-error', role: 'alert', 'data-testid': 'ai-design-error' }, e.message));
      toast(e.message, 'error');
    } finally {
      if (controller === job) controller = null;
      go.disabled = false;
    }
  };

  return h('section', { class: 'block', 'data-testid': 'ai-design' },
    h('div', { class: 'block-head' }, h('h2', null, t('aiDesign.title')),
      h('button', { type: 'button', class: 'link-btn', 'data-testid': 'ai-design-settings', onClick: () => {
        controller?.abort(); // (a design on its way stops first: its Cancel is about to go)
        say(aiSetup('design', { onDone: () => say(), onCancel: () => say() }));
      } }, t('ai.setup'))),
    h('form', { class: 'ai-design-form', onSubmit: (e) => {
      e.preventDefault();
      if (!controller) make();
    } }, text, h('div', { class: 'row' }, size, count, go)),
    h('p', { class: 'fine' }, t('aiDesign.fine')),
    status);
}
