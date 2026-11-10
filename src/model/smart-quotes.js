// Typing ' or " in a text box gives a real quote, the way a typesetter would:
// an opening one at the start of a word or after a space or bracket, a closing
// one (which is also the apostrophe) everywhere else.

const OPENS_AFTER = /[\s([{<—–‘“]$/;

/** The character to insert for a typed straight quote, or null if it isn't one. */
export function smartQuote(typed, before = '') {
  if (typed !== "'" && typed !== '"') return null;
  const opening = before === '' || OPENS_AFTER.test(before);
  if (typed === "'") return opening ? '‘' : '’';
  return opening ? '“' : '”';
}
