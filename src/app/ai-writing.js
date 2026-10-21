// AI writing (an online extra): an "AI" menu for the selected text box that
// writes, rewrites, shortens, lengthens, corrects, changes the tone of or
// translates its text. Each result replaces the text as one undo step and
// keeps the box's style.

import { h, clear, toast } from './ui.js';
import { section } from './widgets.js';
import { PROVIDERS, providerFor } from './online.js';
import { complete, aiReady, aiSetup, isAbort } from './ai.js';
import { WRITING_ACTIONS, TONES, LANGUAGES, writingPrompt, cleanWriting } from '../model/ai.js';
import { findElement } from '../model/commands.js';
import { t } from './i18n.js';
import { writingActionName, toneName, aiLanguageName } from './names.js';

// What's going on, by element id. Kept here, not in the panel: the panel is
// redrawn often, and a request can outlive several redraws.
const jobs = new Map(); // id -> { controller, label }
const errors = new Map(); // id -> message
let menuFor = null; // the id whose menu is open
let setupFor = null; // { id, retry } while the setup prompt shows
let current = null; // the latest panel drawn: { body, paint }
let language = 'Spanish';

// What each action is doing, while it does it (keys in the catalog).
const DOING = { write: 'ai.doing.write', rewrite: 'ai.doing.rewrite', shorten: 'ai.doing.shorten', longer: 'ai.doing.longer', fix: 'ai.doing.fix', tone: 'ai.doing.tone', translate: 'ai.doing.translate' };

function repaint() {
  if (current?.body.isConnected) current.paint();
}

/** Ask for new text for a box and put it in (one undo step). */
async function run(ed, id, pageId, action, opts = {}) {
  if (jobs.has(id)) return;
  // (Held at once, so a second click meanwhile doesn't send another request.)
  const controller = new AbortController();
  jobs.set(id, { controller, label: t('ai.gettingReady') });
  if (!(await aiReady('writing').catch(() => false))) {
    jobs.delete(id);
    setupFor = { id, retry: () => run(ed, id, pageId, action, opts) };
    menuFor = null;
    return repaint();
  }
  const page = ed.doc.pages.find((p) => p.id === pageId);
  const el = page && findElement(page, id);
  if (!el || el.type !== 'text') return void jobs.delete(id);
  const sent = el.text;
  const { system, prompt } = writingPrompt(action, { ...opts, text: sent, el });
  jobs.get(id).label = t(DOING[action], { name: PROVIDERS[await providerFor('writing')].name });
  errors.delete(id);
  menuFor = null;
  repaint();
  try {
    const text = cleanWriting(await complete({ feature: 'writing', system, prompt, signal: controller.signal }), sent);
    if (!text) throw new Error(t('ai.empty'));
    // (Typed into meanwhile: what was typed stays.)
    // (Looked up again: undo and redo put a new copy of the design in place.)
    const nowPage = ed.doc.pages.find((p) => p.id === pageId);
    if ((nowPage && findElement(nowPage, id))?.text !== sent) throw new Error(t('ai.textChanged'));
    if (!ed.closed) ed.update({ text }, null, [id], pageId);
  } catch (e) {
    if (!isAbort(e)) {
      errors.set(id, e.message);
      toast(e.message, 'error');
    }
  } finally {
    jobs.delete(id);
    repaint();
  }
}

/** The AI writing section of the text panel. */
export function aiWritingSection(ed, el) {
  const id = el.id;
  const pageId = ed.pageData.id;
  const body = h('div', { class: 'ai-writing', 'data-testid': 'ai-writing' });
  const act = (action, opts) => run(ed, id, pageId, action, opts);
  const paint = () => {
    clear(body);
    const job = jobs.get(id);
    if (job) {
      body.append(h('div', { class: 'ai-progress', role: 'status', 'data-testid': 'ai-progress' },
        h('span', { class: 'ai-spinner', 'aria-hidden': 'true' }), h('span', null, job.label),
        h('button', { type: 'button', class: 'btn small', 'data-testid': 'ai-cancel', onClick: () => job.controller.abort() }, t('common.cancel'))));
      return;
    }
    if (setupFor?.id === id) {
      const { retry } = setupFor;
      body.append(aiSetup('writing', {
        onDone: () => {
          setupFor = null;
          retry ? retry() : repaint();
        },
        onCancel: () => {
          setupFor = null;
          repaint();
        },
      }));
      return;
    }
    const open = menuFor === id;
    body.append(h('div', { class: 'row' },
      h('button', { type: 'button', class: `btn small${open ? ' on' : ''}`, 'aria-expanded': String(open), 'data-testid': 'ai-menu', onClick: () => {
        menuFor = open ? null : id;
        errors.delete(id);
        paint();
      } }, t('ai.menu')),
      h('button', { type: 'button', class: 'link-btn', 'data-testid': 'ai-settings', onClick: () => {
        setupFor = { id, retry: null };
        paint();
      } }, t('ai.setup'))));
    if (errors.has(id)) body.append(h('p', { class: 'ai-error', role: 'alert', 'data-testid': 'ai-error' }, errors.get(id)));
    if (open) body.append(actionMenu(act));
  };
  current = { body, paint };
  paint();
  return section(t('feature.writing'), body);
}

/** The actions: Write takes a few words, Tone and Translate a choice. */
function actionMenu(act) {
  const brief = h('input', { type: 'text', placeholder: t('ai.writePlaceholder'), 'aria-label': t('ai.writeLabel'), 'data-testid': 'ai-write-prompt', maxlength: '500' });
  const write = () => {
    if (!brief.value.trim()) return brief.focus();
    act('write', { brief: brief.value });
  };
  brief.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') write();
  });
  const lang = h('select', { 'aria-label': t('common.language'), 'data-testid': 'ai-language' }, LANGUAGES.map((l) => h('option', { value: l }, aiLanguageName(l))));
  lang.value = language;
  lang.addEventListener('change', () => (language = lang.value));
  const name = (id) => writingActionName(WRITING_ACTIONS.find((a) => a.id === id));
  const button = (id, onClick, label = name(id)) => h('button', { type: 'button', class: 'btn small', 'data-testid': `ai-${id}`, onClick }, label);
  return h('div', { class: 'ai-menu', role: 'group', 'aria-label': t('feature.writing'), 'data-testid': 'ai-actions' },
    h('div', { class: 'ai-line' }, brief, button('write', write, t('ai.write'))),
    h('div', { class: 'ai-grid' }, ['rewrite', 'shorten', 'longer', 'fix'].map((a) => button(a, () => act(a)))),
    h('span', { class: 'hint' }, name('tone')),
    h('div', { class: 'ai-grid three' }, TONES.map((tone) => h('button', { type: 'button', class: 'btn small', 'data-testid': `ai-tone-${tone}`, onClick: () => act('tone', { tone }) }, toneName(tone)))),
    h('div', { class: 'ai-line' }, lang, button('translate', () => act('translate', { language: lang.value }))));
}
