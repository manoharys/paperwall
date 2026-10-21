// Opus's header block (OpusHead), which both video files carry for their sound.

const enc = new TextEncoder();

/** The pre-skip (samples at 48 kHz) in an OpusHead, or Opus's usual 312. */
export function opusPreSkip(head) {
  return isOpusHead(head) ? head[10] | (head[11] << 8) : 312;
}

/** Whether some bytes are an OpusHead block. */
export function isOpusHead(head) {
  return !!head && head.length >= 19 && String.fromCharCode(...head.subarray(0, 8)) === 'OpusHead';
}

/** Opus's header block, for when the encoder doesn't hand one over. */
export function opusHead(channels, sampleRate) {
  const b = new Uint8Array(19);
  b.set(enc.encode('OpusHead'));
  const v = new DataView(b.buffer);
  b[8] = 1;
  b[9] = channels;
  v.setUint16(10, 312, true); // pre-skip: 6.5 ms at 48 kHz
  v.setUint32(12, sampleRate, true);
  v.setInt16(16, 0, true);
  b[18] = 0;
  return b;
}
