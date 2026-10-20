// Paperwall's templates. Every one was designed for this project from shapes,
// text, icons and stickers, and is dedicated to the public domain (CC0).

import { createDesign, createText, createShape, createLine, createIcon, createSticker, createQr, createPage, clone } from '../model/doc.js';
import { FONT_PAIRS, fontsUsed } from '../model/fonts.js';
import { approxMeasure } from '../model/text-layout.js';
import { layoutDesign } from '../model/layout.js';
import { PALETTES, makePage } from './kit.js';
import { FORMATS, CATEGORIES, SETS } from './content.js';

const T = (text, props) => createText({ text, ...props });
const S = (shape, props) => createShape(shape, props);
const L = (props) => createLine(props);
const I = (iconId, props) => createIcon(iconId, props);
const K = (stickerId, props) => createSticker(stickerId, props);
const lin = (angle, ...colors) => ({ type: 'linear', angle, stops: colors.map((c, i) => ({ offset: i / (colors.length - 1), color: c })) });
const rad = (...colors) => ({ type: 'radial', stops: colors.map((c, i) => ({ offset: i / (colors.length - 1), color: c })) });

function design(width, height, background, elements) {
  return { width, height, background, elements };
}

const BUILDERS = [
  {
    id: 'grand-opening', name: 'Grand opening', category: 'Grand opening', tags: 'shop store opening launch announcement',
    build: () => design(1080, 1080, { type: 'gradient', gradient: lin(160, '#e04a1f', '#c93a17', '#9d1789') }, [
      K('rays', { x: 290, y: 60, w: 500, h: 500, opacity: 0.25 }),
      T('NOW OPEN', { x: 90, y: 300, w: 900, size: 64, font: 'Montserrat', weight: 700, color: '#ffffff', align: 'center', letterSpacing: 18 }),
      T('GRAND\nOPENING', { x: 90, y: 390, w: 900, size: 190, font: 'Bebas Neue', color: '#ffffff', align: 'center', lineHeight: 0.92 }),
      T('Saturday · 10 am', { x: 290, y: 800, w: 500, size: 44, font: 'Poppins', weight: 700, color: '#16161d', align: 'center', highlight: { color: '#ffd166', padding: 14, radius: 40 } }),
      T('12 Market Street', { x: 190, y: 910, w: 700, size: 34, font: 'Poppins', color: '#ffffff', align: 'center' }),
      K('burst', { x: 820, y: 70, w: 190, h: 190, rotation: 12 }),
      T('FREE\nCOFFEE', { x: 840, y: 122, w: 150, size: 30, font: 'Archivo Black', color: '#16161d', align: 'center', rotation: 12, lineHeight: 1 }),
    ]),
  },
  {
    id: 'quote-card', name: 'Quote card', category: 'Quotes', tags: 'quote inspiration motivation words',
    build: () => design(1080, 1080, { type: 'color', color: '#16161d' }, [
      I('quote', { x: 460, y: 150, w: 160, h: 160, color: '#f25c2a', strokeWidth: 2.2 }),
      T('Make the thing you wish existed. Then give it away.', { x: 140, y: 360, w: 800, size: 72, font: 'Playfair Display', color: '#ffffff', align: 'center', lineHeight: 1.25 }),
      L({ x: 490, y: 760, w: 100, h: 20, stroke: '#f25c2a', strokeWidth: 4 }),
      T('A. MAKER', { x: 290, y: 810, w: 500, size: 30, font: 'Montserrat', weight: 700, color: '#c9c9d6', align: 'center', letterSpacing: 8 }),
    ]),
  },
  {
    id: 'summer-sale', name: 'Summer sale', category: 'Sales', tags: 'sale discount offer shop story summer',
    build: () => design(1080, 1920, { type: 'gradient', gradient: lin(180, '#ffd166', '#ff9f43', '#f25c2a') }, [
      S('ellipse', { x: 640, y: -160, w: 640, h: 640, fill: '#fff3b0', opacity: 0.6 }),
      I('sun', { x: 760, y: 120, w: 220, h: 220, color: '#ffffff', strokeWidth: 1.6 }),
      T('SUMMER', { x: 80, y: 560, w: 940, size: 150, font: 'Archivo Black', color: '#16161d', lineHeight: 0.95 }),
      T('SALE', { x: 80, y: 700, w: 940, size: 250, font: 'Archivo Black', color: '#16161d', lineHeight: 0.95 }),
      T('Up to 50% off everything', { x: 80, y: 1010, w: 900, size: 60, font: 'Poppins', weight: 700, color: '#16161d', highlight: { color: '#ffffff', padding: 18, radius: 16 } }),
      T('This weekend only', { x: 80, y: 1150, w: 900, size: 48, font: 'Poppins', weight: 700, color: '#16161d' }),
      S('rect', { x: 80, y: 1560, w: 460, h: 130, radius: 65, fill: '#16161d' }),
      T('Shop now →', { x: 80, y: 1592, w: 460, size: 52, font: 'Poppins', weight: 700, color: '#ffffff', align: 'center' }),
      K('sparkles', { x: 820, y: 1500, w: 200, h: 200 }),
    ]),
  },
  {
    id: 'birthday-invite', name: 'Birthday party', category: 'Birthday', tags: 'birthday party invite celebrate kids',
    build: () => design(1500, 2100, { type: 'color', color: '#fff4f7' }, [
      K('confetti', { x: 0, y: 0, w: 1500, h: 700, opacity: 0.9 }),
      S('ellipse', { x: 300, y: 560, w: 900, h: 900, fill: '#ffffff', shadow: { x: 0, y: 20, blur: 60, color: '#ff4d6d', opacity: 0.18 } }),
      T("You're invited", { x: 300, y: 700, w: 900, size: 110, font: 'Dancing Script', weight: 700, color: '#ff4d6d', align: 'center' }),
      T("MAYA'S 7TH\nBIRTHDAY", { x: 300, y: 880, w: 900, size: 120, font: 'Archivo Black', color: '#16161d', align: 'center', lineHeight: 1 }),
      I('cake', { x: 680, y: 1160, w: 140, h: 140, color: '#ff4d6d', strokeWidth: 1.6 }),
      T('SATURDAY, JUNE 14 · 3 PM', { x: 150, y: 1560, w: 1200, size: 54, font: 'Montserrat', weight: 700, color: '#16161d', align: 'center', letterSpacing: 4 }),
      T('The Garden Room, 4 Elm Avenue\nPlease reply by June 7', { x: 150, y: 1660, w: 1200, size: 46, font: 'Lora', color: '#5a5a6e', align: 'center', lineHeight: 1.5 }),
      K('heart-pair', { x: 1180, y: 1820, w: 200, h: 200 }),
    ]),
  },
  {
    id: 'event-poster', name: 'Event poster', category: 'Events', tags: 'event concert festival poster gig music',
    build: () => design(1080, 1350, { type: 'color', color: '#0b0b12' }, [
      S('ellipse', { x: -200, y: -150, w: 800, h: 800, fill: '#5b5bd6' }),
      S('ellipse', { x: 540, y: 420, w: 700, h: 700, fill: '#f25c2a' }),
      S('rect', { x: 120, y: 660, w: 380, h: 380, fill: '#ffd166', rotation: 18 }),
      T('NIGHT\nMARKET', { x: 70, y: 90, w: 940, size: 220, font: 'Bebas Neue', color: '#ffffff', lineHeight: 0.88 }),
      T('Food · Music · Makers', { x: 70, y: 520, w: 700, size: 46, font: 'Space Grotesk', weight: 700, color: '#ffffff' }),
      I('calendar', { x: 70, y: 1150, w: 56, h: 56, color: '#ffffff' }),
      T('Fri, Aug 22 · 6 pm', { x: 140, y: 1155, w: 420, size: 38, font: 'Space Grotesk', color: '#ffffff' }),
      I('pin', { x: 580, y: 1150, w: 56, h: 56, color: '#ffffff' }),
      T('Riverside Park', { x: 650, y: 1155, w: 380, size: 38, font: 'Space Grotesk', color: '#ffffff' }),
    ]),
  },
  {
    id: 'video-thumbnail', name: 'Bold video thumbnail', category: 'YouTube', tags: 'youtube thumbnail video vlog',
    build: () => design(1280, 720, { type: 'color', color: '#ffe600' }, [
      S('ellipse', { x: 760, y: 80, w: 560, h: 560, fill: '#16161d' }),
      S('ellipse', { x: 830, y: 150, w: 420, h: 420, fill: '#ff2e63' }),
      I('play', { x: 960, y: 270, w: 180, h: 180, color: '#ffffff', strokeWidth: 2.4 }),
      T('I MADE\nTHIS IN\n10 MIN', { x: 70, y: 90, w: 700, size: 116, font: 'Archivo Black', color: '#ffffff', lineHeight: 1, outline: { width: 9, color: '#16161d' } }),
      T('no design skills', { x: 80, y: 500, w: 420, size: 58, font: 'Caveat', weight: 700, color: '#16161d' }),
      K('doodle-arrow', { x: 480, y: 450, w: 220, h: 160, rotation: 4 }),
    ]),
  },
  {
    id: 'business-card', name: 'Clean business card', category: 'Business cards', tags: 'business card contact name professional',
    build: () => design(1050, 600, { type: 'color', color: '#ffffff' }, [
      S('rect', { x: 0, y: 0, w: 24, h: 600, fill: '#f25c2a' }),
      T('Alex Rivera', { x: 90, y: 90, w: 600, size: 64, font: 'Montserrat', weight: 700, color: '#16161d' }),
      T('Product Designer', { x: 90, y: 175, w: 600, size: 32, font: 'Inter', color: '#f25c2a' }),
      I('phone', { x: 90, y: 330, w: 36, h: 36, color: '#5a5a6e' }),
      T('+1 555 0142', { x: 140, y: 332, w: 400, size: 28, font: 'Inter', color: '#16161d' }),
      I('mail', { x: 90, y: 390, w: 36, h: 36, color: '#5a5a6e' }),
      T('alex@example.com', { x: 140, y: 392, w: 400, size: 28, font: 'Inter', color: '#16161d' }),
      I('globe', { x: 90, y: 450, w: 36, h: 36, color: '#5a5a6e' }),
      T('example.com', { x: 140, y: 452, w: 400, size: 28, font: 'Inter', color: '#16161d' }),
      createQr('https://example.com', { x: 780, y: 330, w: 190, h: 190 }),
    ]),
  },
  {
    id: 'slides-title', name: 'Presentation title', category: 'Presentations', tags: 'slides presentation deck title pitch',
    build: () => design(1920, 1080, { type: 'gradient', gradient: lin(135, '#14142b', '#2a2a5a') }, [
      K('dots', { x: 1500, y: 100, w: 300, h: 300, opacity: 0.35 }),
      T('Q3 REVIEW', { x: 160, y: 300, w: 1200, size: 40, font: 'Space Grotesk', weight: 700, color: '#ff9f43', letterSpacing: 12 }),
      T('Where we are and\nwhere we go next', { x: 160, y: 380, w: 1400, size: 120, font: 'Space Grotesk', weight: 700, color: '#ffffff', lineHeight: 1.05 }),
      L({ x: 160, y: 720, w: 220, h: 24, stroke: '#ff9f43', strokeWidth: 8 }),
      T('Team update · October', { x: 160, y: 790, w: 1000, size: 44, font: 'Inter', color: '#b9b9d9' }),
    ]),
  },
  {
    id: 'hiring', name: "We're hiring", category: 'Hiring', tags: 'hiring job recruit career team',
    build: () => design(1080, 1080, { type: 'color', color: '#eef6ff' }, [
      S('rect', { x: 60, y: 60, w: 960, h: 960, radius: 48, fill: '#ffffff', shadow: { x: 0, y: 16, blur: 48, color: '#3a86ff', opacity: 0.18 } }),
      I('briefcase', { x: 130, y: 140, w: 110, h: 110, color: '#3a86ff' }),
      T("We're\nhiring!", { x: 130, y: 290, w: 820, size: 150, font: 'Poppins', weight: 700, color: '#16161d', lineHeight: 1 }),
      T('Frontend engineer\nRemote · Full time', { x: 130, y: 640, w: 820, size: 48, font: 'Inter', color: '#3d3d4e', lineHeight: 1.4 }),
      S('rect', { x: 130, y: 850, w: 380, h: 100, radius: 50, fill: '#3a86ff' }),
      T('Apply today', { x: 130, y: 875, w: 380, size: 40, font: 'Poppins', weight: 700, color: '#ffffff', align: 'center' }),
      K('sparkles', { x: 800, y: 130, w: 160, h: 160 }),
    ]),
  },
  {
    id: 'cafe-menu', name: 'Café menu', category: 'Menus', tags: 'menu cafe restaurant food drinks coffee',
    build: () => design(1748, 2480, { type: 'color', color: '#fbf3e4' }, [
      I('coffee', { x: 794, y: 160, w: 160, h: 160, color: '#6f4518', strokeWidth: 1.4 }),
      T('The Corner Café', { x: 150, y: 360, w: 1448, size: 140, font: 'DM Serif Display', color: '#3a2618', align: 'center' }),
      T('— MENU —', { x: 150, y: 560, w: 1448, size: 50, font: 'Montserrat', weight: 700, color: '#8a6446', align: 'center', letterSpacing: 14 }),
      T('Espresso\nFlat white\nOat latte\nChai\nHot chocolate', { x: 250, y: 760, w: 900, size: 64, font: 'Lora', color: '#3a2618', lineHeight: 1.9 }),
      T('3.00\n3.80\n4.20\n3.90\n3.50', { x: 1200, y: 760, w: 300, size: 64, font: 'Lora', weight: 700, color: '#3a2618', align: 'right', lineHeight: 1.9 }),
      L({ x: 250, y: 1450, w: 1250, h: 24, stroke: '#b08968', strokeWidth: 3, dash: 'dotted' }),
      T('Croissant\nBanana bread\nAvocado toast', { x: 250, y: 1560, w: 900, size: 64, font: 'Lora', color: '#3a2618', lineHeight: 1.9 }),
      T('3.20\n3.60\n8.50', { x: 1200, y: 1560, w: 300, size: 64, font: 'Lora', weight: 700, color: '#3a2618', align: 'right', lineHeight: 1.9 }),
      K('leaf-branch', { x: 1300, y: 2050, w: 330, h: 330 }),
      T('Open daily 7–5', { x: 150, y: 2200, w: 1448, size: 48, font: 'Montserrat', color: '#6f4518', align: 'center' }),
    ]),
  },
  {
    id: 'thank-you', name: 'Thank you', category: 'Thank you', tags: 'thank you card gratitude customer',
    build: () => design(1080, 1080, { type: 'gradient', gradient: rad('#fff1e6', '#ffd6c2') }, [
      K('frame-corners', { x: 90, y: 90, w: 900, h: 900 }),
      T('thank you', { x: 140, y: 360, w: 800, size: 170, font: 'Pacifico', color: '#d1495b', align: 'center' }),
      T('for supporting a small business', { x: 190, y: 640, w: 700, size: 42, font: 'Lora', color: '#5a3a3a', align: 'center' }),
      I('heart', { x: 505, y: 780, w: 70, h: 70, color: '#d1495b' }),
    ]),
  },
  {
    id: 'save-the-date', name: 'Save the date', category: 'Wedding', tags: 'wedding save the date engagement',
    build: () => design(1500, 2100, { type: 'color', color: '#f6f1eb' }, [
      K('leaf-branch', { x: 1000, y: 60, w: 440, h: 440, rotation: 90 }),
      K('leaf-branch', { x: 60, y: 1600, w: 440, h: 440, rotation: -90 }),
      T('Save the date', { x: 150, y: 520, w: 1200, size: 150, font: 'Dancing Script', weight: 700, color: '#2d6a4f', align: 'center' }),
      T('SAM & JORDAN', { x: 150, y: 860, w: 1200, size: 96, font: 'Playfair Display', color: '#1b1b1b', align: 'center', letterSpacing: 10 }),
      L({ x: 600, y: 1040, w: 300, h: 24, stroke: '#2d6a4f', strokeWidth: 3 }),
      T('09 · 20 · 2027', { x: 150, y: 1120, w: 1200, size: 80, font: 'Playfair Display', color: '#1b1b1b', align: 'center' }),
      T('Lisbon, Portugal\nInvitation to follow', { x: 150, y: 1300, w: 1200, size: 52, font: 'Lora', italic: true, color: '#5a5a5a', align: 'center', lineHeight: 1.5 }),
    ]),
  },
  {
    id: 'podcast-cover', name: 'Podcast cover', category: 'Podcast', tags: 'podcast cover art audio show episode',
    build: () => design(1080, 1080, { type: 'color', color: '#08d9d6' }, [
      S('ellipse', { x: 140, y: 140, w: 800, h: 800, fill: '#16161d' }),
      I('mic', { x: 440, y: 230, w: 200, h: 200, color: '#ffe600', strokeWidth: 1.6 }),
      T('THE\nSIDE PROJECT\nSHOW', { x: 140, y: 460, w: 800, size: 74, font: 'Archivo Black', color: '#ffffff', align: 'center', lineHeight: 1.05 }),
      T('new episodes every friday', { x: 240, y: 730, w: 600, size: 34, font: 'Space Grotesk', color: '#08d9d6', align: 'center' }),
    ]),
  },
  {
    id: 'workout-story', name: 'Class schedule', category: 'Fitness', tags: 'fitness gym workout schedule class story',
    build: () => design(1080, 1920, { type: 'color', color: '#111827' }, [
      I('dumbbell', { x: 80, y: 160, w: 140, h: 140, color: '#a3e635', strokeWidth: 2 }),
      T('THIS\nWEEK', { x: 80, y: 340, w: 920, size: 200, font: 'Oswald', weight: 700, color: '#ffffff', lineHeight: 0.95 }),
      T('MON   HIIT · 7 am\nTUE   Yoga · 6 pm\nWED   Strength · 7 am\nTHU   Spin · 6 pm\nFRI   Open gym', { x: 80, y: 820, w: 920, size: 64, font: 'Oswald', color: '#e5e7eb', lineHeight: 1.7 }),
      S('rect', { x: 80, y: 1560, w: 920, h: 160, radius: 24, fill: '#a3e635' }),
      T('Book in the app', { x: 80, y: 1600, w: 920, size: 64, font: 'Oswald', weight: 700, color: '#111827', align: 'center' }),
    ]),
  },
  {
    id: 'webinar', name: 'Webinar', category: 'Webinars', tags: 'webinar online event talk live workshop',
    build: () => design(1920, 1080, { type: 'color', color: '#ffffff' }, [
      S('rect', { x: 1100, y: 0, w: 820, h: 1080, fill: lin(160, '#5b5bd6', '#8e7dff') }),
      K('blob-1', { x: 1250, y: 260, w: 560, h: 560, opacity: 0.35 }),
      I('users', { x: 1400, y: 380, w: 260, h: 260, color: '#ffffff', strokeWidth: 1.4 }),
      T('FREE LIVE WORKSHOP', { x: 140, y: 240, w: 900, size: 38, font: 'Inter', weight: 700, color: '#5b5bd6', letterSpacing: 6 }),
      T('Design your first\nposter in 30 minutes', { x: 140, y: 320, w: 940, size: 74, font: 'Poppins', weight: 700, color: '#16161d', lineHeight: 1.12 }),
      T('Thursday, 5 pm UTC · Online', { x: 140, y: 520, w: 900, size: 44, font: 'Inter', color: '#3d3d4e' }),
      S('rect', { x: 140, y: 720, w: 420, h: 110, radius: 55, fill: '#16161d' }),
      T('Save my seat', { x: 140, y: 748, w: 420, size: 42, font: 'Poppins', weight: 700, color: '#ffffff', align: 'center' }),
    ]),
  },
  {
    id: 'open-house', name: 'Open house', category: 'Real estate', tags: 'real estate house home open house property',
    build: () => design(1080, 1350, { type: 'color', color: '#f4f1ea' }, [
      S('rect', { x: 0, y: 0, w: 1080, h: 620, fill: lin(180, '#9fd3c7', '#385170') }),
      I('home', { x: 390, y: 140, w: 300, h: 300, color: '#ffffff', strokeWidth: 1.2 }),
      T('OPEN HOUSE', { x: 60, y: 690, w: 960, size: 130, font: 'Bebas Neue', color: '#142d4c', align: 'center' }),
      T('Sunday · 1–4 pm', { x: 60, y: 862, w: 960, size: 54, font: 'Montserrat', weight: 700, color: '#385170', align: 'center' }),
      T('3 bed · 2 bath · garden\n88 Willow Lane', { x: 60, y: 960, w: 960, size: 44, font: 'Inter', color: '#3d3d4e', align: 'center', lineHeight: 1.5 }),
      K('price-tag', { x: 800, y: 1120, w: 200, h: 140 }),
    ]),
  },
];

const slug = (s) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const pairByName = (name) => FONT_PAIRS.find((p) => p.name === name) || FONT_PAIRS[0];
const formatOf = (w, h) => Object.entries(FORMATS).find(([, f]) => f.w === w && f.h === h)?.[0] || 'custom';

/** Generated templates: every piece of content laid out in each of its category's layouts. */
function generated() {
  const out = [];
  for (const cat of CATEGORIES) {
    cat.items.forEach((item, i) => {
      cat.layouts.forEach((layout, j) => {
        const format = cat.formats[(i + j) % cat.formats.length];
        const { w, h } = FORMATS[format];
        const palette = PALETTES[cat.palettes[(i * cat.layouts.length + j) % cat.palettes.length]];
        const pair = pairByName(cat.pairs[(i + j * 2) % cat.pairs.length]);
        out.push({
          id: `${slug(cat.name)}-${slug(item.name)}-${'abcdef'[j]}`,
          name: item.name,
          category: cat.name,
          tags: `${cat.tags} ${item.name.toLowerCase()} ${FORMATS[format].label.toLowerCase()}`,
          format,
          build: () => ({ width: w, height: h, pages: [makePage(layout, { W: w, H: h, palette, pair, content: { ...item, variant: j } })] }),
        });
      });
    });
  }
  for (const set of SETS) {
    const { w, h } = FORMATS[set.format];
    const palette = PALETTES[set.palette];
    const pair = pairByName(set.pair);
    out.push({
      id: set.id,
      name: set.name,
      category: set.category,
      tags: `${set.tags} ${set.pages.length} pages`,
      format: set.format,
      pages: set.pages.length,
      build: () => ({ width: w, height: h, pages: set.pages.map(([layout, content], i) => makePage(layout, { W: w, H: h, palette, pair, content: { ...content, variant: i } })) }),
    });
  }
  return out;
}

export const TEMPLATES = [
  ...BUILDERS.map(({ build, ...meta }) => {
    const { width, height } = build();
    return { ...meta, format: formatOf(width, height), width, height, pages: 1, build };
  }),
  ...generated().map((t) => ({ pages: 1, ...t, width: FORMATS[t.format].w, height: FORMATS[t.format].h })),
];

export const TEMPLATE_CATEGORIES = [...new Set(TEMPLATES.map((t) => t.category))];

/** Formats that templates come in, for filtering: [{ id, label, count }]. */
export const TEMPLATE_FORMATS = Object.entries(FORMATS)
  .map(([id, f]) => ({ id, label: f.label, count: TEMPLATES.filter((t) => t.format === id).length }))
  .filter((f) => f.count);

/** A short description of a template's size, like "Story · 1080 × 1920". */
export function templateFormatLabel(t) {
  return FORMATS[t.format]?.label || `${t.width} × ${t.height}`;
}

export function templateById(id) {
  return TEMPLATES.find((t) => t.id === id) || null;
}

/** Templates matching a search, a category and a format ('All' for any). */
export function searchTemplates({ query = '', category = 'All', format = 'All' } = {}) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return TEMPLATES.filter((t) => (category === 'All' || t.category === category) &&
    (format === 'All' || t.format === format) &&
    words.every((w) => `${t.name} ${t.category} ${t.tags}`.toLowerCase().includes(w)));
}

/** The fonts a template uses, without laying it out. */
export function templateFonts(t) {
  const spec = t.build();
  return fontsUsed({ pages: spec.pages || [{ elements: spec.elements }] });
}

/**
 * A fresh, editable design made from a template. Text is fitted with
 * `measure`; pass the real font measurer once the template's fonts are
 * loaded (the rough default is fine for working out which fonts it uses).
 */
export function templateDoc(t, measure = approxMeasure) {
  const spec = t.build();
  const pages = spec.pages || [{ background: spec.background, elements: spec.elements }];
  const doc = createDesign({ width: spec.width, height: spec.height, name: t.name });
  doc.pages = pages.map((p) => ({ ...createPage(clone(p.background)), elements: p.elements, flows: p.flows, after: p.after }));
  return layoutDesign(doc, measure);
}
