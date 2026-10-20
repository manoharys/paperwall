// Paperwall's own icons and stickers, drawn for this project and released as CC0.
// Icons are line drawings on a 24 × 24 grid; they take the element's color.
// Stickers are full-color drawings on a 100 × 100 grid.

const I = (id, name, tags, body) => ({ id, name, tags, body });

export const ICONS = [
  I('heart', 'Heart', 'love like favorite', '<path d="M12 20.5C7 17 3 13.6 3 9.2 3 6.3 5.2 4 7.9 4c1.7 0 3.2.9 4.1 2.3C12.9 4.9 14.4 4 16.1 4 18.8 4 21 6.3 21 9.2c0 4.4-4 7.8-9 11.3z"/>'),
  I('star', 'Star', 'rating favorite', '<path d="M12 3l2.7 5.6 6.1.8-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1-4.4-4.3 6.1-.8z"/>'),
  I('check', 'Check', 'done yes tick', '<path d="M4.5 12.5l4.8 4.8L19.5 7"/>'),
  I('close', 'Cross', 'no close x remove', '<path d="M6 6l12 12M18 6L6 18"/>'),
  I('plus', 'Plus', 'add new', '<path d="M12 5v14M5 12h14"/>'),
  I('minus', 'Minus', 'remove less', '<path d="M5 12h14"/>'),
  I('arrow-right', 'Arrow right', 'next forward', '<path d="M4 12h15M13.5 6.5L19 12l-5.5 5.5"/>'),
  I('arrow-left', 'Arrow left', 'back previous', '<path d="M20 12H5M10.5 6.5L5 12l5.5 5.5"/>'),
  I('arrow-up', 'Arrow up', 'up top', '<path d="M12 20V5M6.5 10.5L12 5l5.5 5.5"/>'),
  I('arrow-down', 'Arrow down', 'down', '<path d="M12 4v15M6.5 13.5L12 19l5.5-5.5"/>'),
  I('circle-check', 'Check circle', 'done ok success', '<circle cx="12" cy="12" r="8.5"/><path d="M8 12.3l2.8 2.7L16.2 9.5"/>'),
  I('phone', 'Phone', 'call contact', '<path d="M7.2 3.5h2.4l1.3 4-2 1.4a10.5 10.5 0 0 0 6.2 6.2l1.4-2 4 1.3v2.4c0 1.2-1 2.2-2.2 2.2A15.6 15.6 0 0 1 5 5.7c0-1.2 1-2.2 2.2-2.2z"/>'),
  I('mail', 'Mail', 'email envelope contact', '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4 7l8 6 8-6"/>'),
  I('pin', 'Location', 'map place address', '<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>'),
  I('home', 'Home', 'house', '<path d="M4 11l8-6.5 8 6.5M6.5 9.5V19h11V9.5M10 19v-5h4v5"/>'),
  I('user', 'Person', 'user profile account', '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c.8-4 3.8-6 7.5-6s6.7 2 7.5 6"/>'),
  I('users', 'People', 'team group', '<circle cx="9" cy="9" r="3.2"/><path d="M3 19c.6-3.3 2.9-5 6-5s5.4 1.7 6 5"/><path d="M15.5 6.2a3 3 0 0 1 0 5.6M17.5 14.3c2 .6 3.1 2.2 3.5 4.7"/>'),
  I('calendar', 'Calendar', 'date event schedule', '<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>'),
  I('clock', 'Clock', 'time hour', '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  I('camera', 'Camera', 'photo picture', '<path d="M4 8.5h3.2l1.6-2.5h6.4l1.6 2.5H20V19H4z"/><circle cx="12" cy="13.2" r="3.4"/>'),
  I('image', 'Picture', 'photo image landscape', '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="9.5" r="1.7"/><path d="M4 17l5-4.5 3.5 3 3-2.5 4.5 4"/>'),
  I('music', 'Music', 'song note audio', '<path d="M9 17.5V6l10-2v11.5"/><circle cx="6.7" cy="17.5" r="2.3"/><circle cx="16.7" cy="15.5" r="2.3"/>'),
  I('play', 'Play', 'video start', '<path d="M8 5.5v13l10.5-6.5z"/>'),
  I('bell', 'Bell', 'notification alert', '<path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5z"/><path d="M10.3 20.2a1.9 1.9 0 0 0 3.4 0"/>'),
  I('gift', 'Gift', 'present birthday', '<rect x="4" y="9" width="16" height="11" rx="1"/><path d="M3.5 9h17M12 9v11M12 9c-1.5-3.5-5.5-4-5.5-1.7S9.5 9 12 9zm0 0c1.5-3.5 5.5-4 5.5-1.7S14.5 9 12 9z"/>'),
  I('cart', 'Cart', 'shop buy basket', '<path d="M3 4.5h2.3l2.2 10.5h10.3L20 7.5H6.5"/><circle cx="9" cy="19" r="1.4"/><circle cx="16.5" cy="19" r="1.4"/>'),
  I('bag', 'Bag', 'shopping store', '<path d="M5 8h14l-1 12H6z"/><path d="M9 10V7a3 3 0 0 1 6 0v3"/>'),
  I('tag', 'Tag', 'price sale label', '<path d="M3.5 12.2V4.5h7.7l9.3 9.3-7.7 7.7z"/><circle cx="8" cy="9" r="1.4"/>'),
  I('coffee', 'Coffee', 'cup drink cafe', '<path d="M5 9h11v5.5a4.5 4.5 0 0 1-4.5 4.5h-2A4.5 4.5 0 0 1 5 14.5z"/><path d="M16 10.5h1.5a2.3 2.3 0 0 1 0 4.6H16M8.5 3.5c-.8 1 .8 2 0 3M12 3.5c-.8 1 .8 2 0 3"/>'),
  I('sun', 'Sun', 'day summer weather', '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.3M12 19.2v2.3M2.5 12h2.3M19.2 12h2.3M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>'),
  I('moon', 'Moon', 'night sleep', '<path d="M19.5 14.5A8 8 0 1 1 9.5 4.5a6.3 6.3 0 0 0 10 10z"/>'),
  I('cloud', 'Cloud', 'weather sky', '<path d="M7 18.5a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 18 10a4.3 4.3 0 0 1-.5 8.5z"/>'),
  I('leaf', 'Leaf', 'nature eco plant', '<path d="M5 19c0-8 5-13.5 14.5-14-.3 9.5-6 14.5-14 14z"/><path d="M5 19l8.5-8.5"/>'),
  I('flame', 'Flame', 'fire hot trending', '<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.5 2.6-5.3 3.4-8.8 1.8 1.4 2.4 3.2 2.4 4.6 1-.7 1.7-2 1.8-3.4 2.6 2 5.4 4.6 5.4 7.6 0 3.6-2.6 6.2-6.5 6.2z"/>'),
  I('bolt', 'Lightning', 'power fast energy', '<path d="M13.5 3L5.5 13.5h6l-1 7.5 8-10.5h-6z"/>'),
  I('globe', 'Globe', 'world web internet', '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c-2.5 2.6-3.5 5.4-3.5 8.5s1 5.9 3.5 8.5c2.5-2.6 3.5-5.4 3.5-8.5S14.5 6.1 12 3.5z"/>'),
  I('link', 'Link', 'url chain', '<path d="M10.5 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1"/><path d="M13.5 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1"/>'),
  I('lock', 'Lock', 'secure private', '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>'),
  I('chat', 'Chat', 'message talk speech', '<path d="M4 5.5h16v10.5H10l-4.5 3.5V16H4z"/>'),
  I('quote', 'Quote', 'quotation testimonial', '<path d="M5 17.5c0-4.6 1.6-8 4.5-10M5 13.5h4V17.5H5zM14 17.5c0-4.6 1.6-8 4.5-10M14 13.5h4V17.5h-4z"/>'),
  I('sparkle', 'Sparkle', 'magic shine new', '<path d="M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8zM18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>'),
  I('crown', 'Crown', 'king queen premium', '<path d="M4 18h16M4.5 15.5L3.5 7l5 4L12 5l3.5 6 5-4-1 8.5z"/>'),
  I('trophy', 'Trophy', 'award winner prize', '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 5.5H4.5c0 3 1.5 4.5 3.7 4.8M16 5.5h3.5c0 3-1.5 4.5-3.7 4.8M12 13v3.5M8.5 20h7l-.8-3.5H9.3z"/>'),
  I('book', 'Book', 'read learn education', '<path d="M4 5.5c2.7-.8 5.5-.6 8 1 2.5-1.6 5.3-1.8 8-1V18c-2.7-.8-5.5-.6-8 1-2.5-1.6-5.3-1.8-8-1z"/><path d="M12 6.5V19"/>'),
  I('pencil', 'Pencil', 'edit write draw', '<path d="M4.5 19.5l1-4.5L15.8 4.7a1.8 1.8 0 0 1 2.5 0l1 1a1.8 1.8 0 0 1 0 2.5L9 18.5z"/><path d="M13.8 6.7l3.5 3.5"/>'),
  I('cake', 'Cake', 'birthday party celebrate', '<path d="M4.5 20.5h15V14a2 2 0 0 0-2-2h-11a2 2 0 0 0-2 2z"/><path d="M4.5 16c1.3 1 2.5 1 3.8 0s2.5-1 3.7 0 2.5 1 3.8 0 2.4-1 3.7 0M12 12V9M12 6.8c-.9-.8-.4-2.2 0-3.3.4 1.1.9 2.5 0 3.3z"/>'),
  I('megaphone', 'Megaphone', 'announce marketing promo', '<path d="M4 10v4h3l9 4.5v-13L7 10z"/><path d="M7 14l1.2 5h2.3l-1-4.5M19 9.5a3.5 3.5 0 0 1 0 5"/>'),
  I('briefcase', 'Briefcase', 'work job business', '<rect x="3.5" y="7.5" width="17" height="12" rx="2"/><path d="M9 7.5V5.5h6v2M3.5 12.5h17"/>'),
  I('graduation', 'Graduation cap', 'school study education', '<path d="M2.5 9.5L12 5l9.5 4.5L12 14z"/><path d="M6.5 11.5v4c3.3 2.2 7.7 2.2 11 0v-4M21.5 9.5v5"/>'),
  I('wifi', 'Wifi', 'internet signal', '<path d="M3 9.5a13 13 0 0 1 18 0M6 12.8a8.6 8.6 0 0 1 12 0M9 16a4.2 4.2 0 0 1 6 0"/><circle cx="12" cy="19" r=".8"/>'),
  I('at', 'At sign', 'email handle social', '<circle cx="12" cy="12" r="3.5"/><path d="M15.5 9v4.3c0 1.5 1 2.4 2.2 2.4 1.6 0 2.8-1.5 2.8-3.7A8.5 8.5 0 1 0 16 19.4"/>'),
  I('percent', 'Percent', 'discount sale offer', '<path d="M18.5 5.5l-13 13"/><circle cx="7.5" cy="7.5" r="2.3"/><circle cx="16.5" cy="16.5" r="2.3"/>'),
  I('smile', 'Smile', 'happy face emoji', '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14c1.9 2.3 5.1 2.3 7 0"/><circle cx="9.2" cy="9.8" r=".6"/><circle cx="14.8" cy="9.8" r=".6"/>'),
  I('flower', 'Flower', 'spring nature garden', '<circle cx="12" cy="10" r="2.2"/><path d="M12 7.8C11 5.5 11.4 3.5 12 3c.6.5 1 2.5 0 4.8zM14.2 10c2.3-1 4.3-.6 4.8 0-.5.6-2.5 1-4.8 0zM12 12.2c1 2.3.6 4.3 0 4.8-.6-.5-1-2.5 0-4.8zM9.8 10C7.5 11 5.5 10.6 5 10c.5-.6 2.5-1 4.8 0z"/><path d="M12 17v4.5"/>'),
  I('paw', 'Paw', 'pet dog cat animal', '<circle cx="7" cy="10" r="1.8"/><circle cx="10.3" cy="6.6" r="1.8"/><circle cx="13.7" cy="6.6" r="1.8"/><circle cx="17" cy="10" r="1.8"/><path d="M12 11.5c-2.6 0-5 3.4-5 5.6 0 1.6 1.3 2.4 2.6 2.4 1 0 1.5-.5 2.4-.5s1.4.5 2.4.5c1.3 0 2.6-.8 2.6-2.4 0-2.2-2.4-5.6-5-5.6z"/>'),
  I('dumbbell', 'Dumbbell', 'fitness gym workout', '<path d="M8 12h8M4.5 8.5v7M7.5 7v10M16.5 7v10M19.5 8.5v7M2.5 12h2M19.5 12h2"/>'),
  I('plane', 'Plane', 'travel flight trip', '<path d="M21 4.5L3.5 11l6 2.5 2.5 6z"/><path d="M9.5 13.5l4-4"/>'),
  I('car', 'Car', 'drive auto travel', '<path d="M4 16.5V12l2-4.5h12l2 4.5v4.5zM4 12h16"/><circle cx="7.5" cy="16.5" r="1.8"/><circle cx="16.5" cy="16.5" r="1.8"/>'),
  I('pizza', 'Pizza', 'food slice', '<path d="M4 6c5-2.5 11-2.5 16 0L12 21z"/><path d="M5.3 8.6c4.4-2 9-2 13.4 0"/><circle cx="10" cy="11" r="1"/><circle cx="14" cy="13" r="1"/>'),
  I('mic', 'Microphone', 'podcast voice sing', '<rect x="9" y="3.5" width="6" height="10.5" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/>'),
  I('eye', 'Eye', 'view see watch', '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>'),
  I('thumbs-up', 'Thumbs up', 'like approve good', '<path d="M7.5 10.5v9H4v-9zM7.5 10.5l3.7-6.5c1.3 0 2.3 1 2.3 2.3V9h5a1.7 1.7 0 0 1 1.7 2l-1.4 7a1.7 1.7 0 0 1-1.7 1.5H7.5"/>'),
  I('info', 'Info', 'information help', '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r=".7"/>'),
  I('download', 'Download', 'save get', '<path d="M12 4v11M7 10.5l5 5 5-5M4.5 19.5h15"/>'),
  I('rocket', 'Rocket', 'launch startup space', '<path d="M12 3c3 2.4 4.5 6 4 10.5l-2 2.5h-4l-2-2.5C7.5 9 9 5.4 12 3z"/><circle cx="12" cy="9.5" r="1.6"/><path d="M8.3 13.3L5.5 15.5l1 3.5 3-1.5M15.7 13.3l2.8 2.2-1 3.5-3-1.5M11 19l1 2 1-2"/>'),
];

const S = (id, name, tags, svg) => ({ id, name, tags, svg });

export const STICKERS = [
  S('burst', 'Burst badge', 'sale badge new offer', '<path d="M50 4l8 12 14-5 1 15 15 1-5 14 12 8-12 8 5 14-15 1-1 15-14-5-8 12-8-12-14 5-1-15-15-1 5-14L4 50l12-8-5-14 15-1 1-15 14 5z" fill="#ff5d5d"/><path d="M50 18l5 8 9-3 1 10 10 1-3 9 8 5-8 5 3 9-10 1-1 10-9-3-5 8-5-8-9 3-1-10-10-1 3-9-8-5 8-5-3-9 10-1 1-10 9 3z" fill="#ffd166"/>'),
  S('sparkles', 'Sparkles', 'shine magic stars', '<path d="M40 10l6 22 22 6-22 6-6 22-6-22-22-6 22-6z" fill="#ffd166"/><path d="M76 52l4 12 12 4-12 4-4 12-4-12-12-4 12-4z" fill="#ff9f1c"/><path d="M78 10l2.5 7.5L88 20l-7.5 2.5L78 30l-2.5-7.5L68 20l7.5-2.5z" fill="#ffbf69"/>'),
  S('blob-1', 'Soft blob', 'shape organic background', '<path d="M68 8c16 6 26 22 24 40-2 19-14 37-33 43C40 97 18 89 9 72 0 55 5 32 20 19 34 6 52 2 68 8z" fill="#a0e7e5"/>'),
  S('blob-2', 'Wavy blob', 'shape organic background', '<path d="M52 6c12 0 18 10 28 14s16 14 14 27-12 18-16 28-14 20-28 19S28 86 18 78 2 62 6 48s12-18 18-28S40 6 52 6z" fill="#ffaebc"/>'),
  S('scribble-circle', 'Circled', 'highlight doodle hand drawn', '<path d="M18 52C14 28 38 12 62 14c22 2 32 18 28 36-4 20-26 34-50 32C20 80 8 64 14 44c4-14 18-24 34-28" fill="none" stroke="#ff4d6d" stroke-width="4" stroke-linecap="round"/>'),
  S('underline', 'Hand-drawn underline', 'highlight doodle scribble', '<path d="M6 60c20-8 44-10 88-6M14 72c22-6 46-7 72-4" fill="none" stroke="#3a86ff" stroke-width="5" stroke-linecap="round"/>'),
  S('doodle-arrow', 'Doodle arrow', 'pointer hand drawn', '<path d="M10 78C24 40 52 22 86 24" fill="none" stroke="#1a1a2e" stroke-width="4" stroke-linecap="round"/><path d="M72 14l15 10-12 13" fill="none" stroke="#1a1a2e" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>'),
  S('dots', 'Dot grid', 'pattern texture decoration', Array.from({ length: 25 }, (_, i) => `<circle cx="${14 + (i % 5) * 18}" cy="${14 + Math.floor(i / 5) * 18}" r="4" fill="#6c5ce7"/>`).join('')),
  S('confetti', 'Confetti', 'party celebrate birthday', '<rect x="12" y="18" width="10" height="5" rx="2" fill="#ff5d5d" transform="rotate(30 17 20)"/><rect x="60" y="12" width="10" height="5" rx="2" fill="#3a86ff" transform="rotate(-25 65 14)"/><rect x="80" y="50" width="10" height="5" rx="2" fill="#ffd166" transform="rotate(60 85 52)"/><rect x="30" y="70" width="10" height="5" rx="2" fill="#06d6a0" transform="rotate(-50 35 72)"/><circle cx="45" cy="38" r="4" fill="#ff9f1c"/><circle cx="18" cy="52" r="3.5" fill="#8338ec"/><circle cx="70" cy="80" r="4" fill="#ff5d5d"/><circle cx="88" cy="22" r="3" fill="#06d6a0"/><path d="M50 60l3 6 6 2-6 2-3 6-3-6-6-2 6-2z" fill="#ffd166"/>'),
  S('wave', 'Wave', 'divider sea water', '<path d="M0 56c12-10 25-10 37 0s25 10 37 0 19-8 26-4V100H0z" fill="#3a86ff"/><path d="M0 70c12-8 25-8 37 0s25 8 37 0 19-6 26-3V100H0z" fill="#8ecae6"/>'),
  S('ribbon', 'Ribbon banner', 'label title banner', '<path d="M2 36h16v28H2l8-14z" fill="#c1121f"/><path d="M98 36H82v28h16l-8-14z" fill="#c1121f"/><rect x="12" y="30" width="76" height="30" fill="#e63946"/>'),
  S('rays', 'Sunburst', 'retro rays background', Array.from({ length: 12 }, (_, i) => `<path d="M50 50L${50 + 70 * Math.cos((i * 30 - 6) * Math.PI / 180)} ${50 + 70 * Math.sin((i * 30 - 6) * Math.PI / 180)}L${50 + 70 * Math.cos((i * 30 + 6) * Math.PI / 180)} ${50 + 70 * Math.sin((i * 30 + 6) * Math.PI / 180)}z" fill="#ffd166"/>`).join('') + '<circle cx="50" cy="50" r="16" fill="#ff9f1c"/>'),
  S('leaf-branch', 'Leafy branch', 'nature botanical eco', '<path d="M14 88C34 66 56 40 88 12" fill="none" stroke="#2d6a4f" stroke-width="3" stroke-linecap="round"/><path d="M30 70c-12-2-18-10-18-20 12 0 18 8 18 20zM44 54c-12-2-18-10-18-20 12 0 18 8 18 20zM58 38c-12-2-18-10-18-20 12 0 18 8 18 20zM36 66c2-12 10-18 20-18 0 12-8 18-20 18zM50 50c2-12 10-18 20-18 0 12-8 18-20 18zM64 34c2-12 10-18 20-18 0 12-8 18-20 18z" fill="#52b788"/>'),
  S('speech', 'Speech cloud', 'comment talk bubble', '<path d="M50 12c24 0 42 13 42 30S74 72 50 72c-5 0-10-.6-14-1.7L16 84l6-17C13 61 8 52 8 42c0-17 18-30 42-30z" fill="#ffffff" stroke="#1a1a2e" stroke-width="3"/>'),
  S('heart-pair', 'Two hearts', 'love valentine wedding', '<path d="M38 80C20 66 8 55 8 40c0-10 8-18 17-18 6 0 10 3 13 8 3-5 7-8 13-8 9 0 17 8 17 18 0 15-12 26-30 40z" fill="#ff4d6d"/><path d="M70 58C60 50 53 44 53 35c0-6 4-10 10-10 3 0 6 2 7 4 1-2 4-4 7-4 6 0 10 4 10 10 0 9-7 15-17 23z" fill="#ff8fa3"/>'),
  S('price-tag', 'Price tag', 'sale price shop', '<path d="M8 50L40 18h48v64H40z" fill="#ffd166"/><circle cx="30" cy="50" r="6" fill="#ffffff"/>'),
  S('frame-corners', 'Corner frame', 'border frame elegant', '<path d="M6 30V6h24M70 6h24v24M94 70v24H70M30 94H6V70" fill="none" stroke="#b08968" stroke-width="3"/>'),
  S('squiggle', 'Squiggle', 'line decoration fun', '<path d="M6 50c8-16 14-16 22 0s14 16 22 0 14-16 22 0 14 16 22 0" fill="none" stroke="#8338ec" stroke-width="6" stroke-linecap="round"/>'),
];

export function iconById(id) {
  return ICONS.find((i) => i.id === id) || null;
}

export function stickerById(id) {
  return STICKERS.find((s) => s.id === id) || null;
}

export function searchGraphics(query) {
  const q = query.trim().toLowerCase();
  const match = (g) => !q || g.name.toLowerCase().includes(q) || g.tags.includes(q) || g.id.includes(q);
  return { icons: ICONS.filter(match), stickers: STICKERS.filter(match) };
}
