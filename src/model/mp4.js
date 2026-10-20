// MP4 files, written from scratch: the browser encodes the video (H.264, or
// VP9 where H.264 isn't on offer) and audio (AAC or Opus); this lays the
// pieces out as an MP4 with the index first, so it starts playing at once.

import { opusPreSkip } from './webm.js';

import { concat } from './bytes.js';

const enc = new TextEncoder();

const u8 = (...v) => Uint8Array.from(v);
const u16 = (v) => u8((v >> 8) & 255, v & 255);
const u32 = (v) => u8((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
const zeros = (n) => new Uint8Array(n);
const fourcc = (s) => enc.encode(s);

function box(type, ...parts) {
  const body = concat(parts);
  return concat([u32(body.length + 8), fourcc(type), body]);
}
const full = (type, version, flags, ...parts) => box(type, u8(version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255), ...parts);

// The identity matrix that every track and movie header carries.
const MATRIX = concat([u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000)]);

/**
 * video: { codec: 'avc' | 'vp9', codecString, width, height, description (avcC bytes, for H.264), chunks: [{ data, timestamp (µs), duration (µs), key }] }
 * audio (optional): { codec: 'aac' | 'opus', sampleRate, channels, description, chunks: [...] }
 * duration: seconds. Returns the file's bytes.
 */
export function buildMp4(spec) {
  return concat(buildMp4Parts(spec));
}

/** The file as a list of parts (for a Blob: the samples are never copied). */
export function buildMp4Parts({ video, audio = null, duration }) {
  const ftyp = box('ftyp', fourcc('isom'), u32(0x200), fourcc('isom'), fourcc('iso2'), fourcc(video.codec === 'avc' ? 'avc1' : 'iso6'), fourcc('mp41'));
  const tracks = [{ kind: 'video', ...video, timescale: 90000 }];
  if (audio) tracks.push({ kind: 'audio', ...audio, timescale: audio.sampleRate });
  // Each track's samples, one after another in the media data.
  const moovFor = (base) => {
    let at = base;
    const traks = tracks.map((t, i) => {
      const offsets = t.chunks.map((c) => {
        const o = at;
        at += c.data.length;
        return o;
      });
      return trak(t, i + 1, offsets, duration);
    });
    return box('moov', mvhd(duration, tracks.length + 1), ...traks);
  };
  // The index's size doesn't depend on the offsets in it: measure, then write.
  const size = moovFor(0).length;
  const moov = moovFor(ftyp.length + size + 8);
  const samples = tracks.flatMap((t) => t.chunks.map((c) => c.data));
  const mediaSize = samples.reduce((s, d) => s + d.length, 0);
  return [ftyp, moov, u32(mediaSize + 8), fourcc('mdat'), ...samples];
}

function mvhd(duration, nextTrack) {
  return full('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(Math.round(duration * 1000)), u32(0x00010000), u16(0x0100), zeros(10), MATRIX, zeros(24), u32(nextTrack));
}

function trak(t, id, offsets, duration) {
  const video = t.kind === 'video';
  const tkhd = full('tkhd', 0, 3, u32(0), u32(0), u32(id), u32(0), u32(Math.round(duration * 1000)), zeros(8), u16(0), u16(video ? 0 : 1), u16(video ? 0 : 0x0100), u16(0), MATRIX,
    u32(video ? t.width << 16 : 0), u32(video ? t.height << 16 : 0));
  const ticks = (us) => Math.round((us / 1e6) * t.timescale);
  const total = Math.round(duration * t.timescale);
  const mdhd = full('mdhd', 0, 0, u32(0), u32(0), u32(t.timescale), u32(total), u16(0x55c4), u16(0));
  const hdlr = full('hdlr', 0, 0, u32(0), fourcc(video ? 'vide' : 'soun'), zeros(12), enc.encode(video ? 'VideoHandler\0' : 'SoundHandler\0'));
  const header = video ? full('vmhd', 0, 1, zeros(8)) : full('smhd', 0, 0, u16(0), u16(0));
  const dinf = box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1)));
  // Sample times from the encoder's timestamps (display times, chunks in
  // decode order): decode times are those times in order; a frame shown
  // later than it's decoded gets an offset (ctts). Gaps (dropped frames)
  // stay gaps. The last sample lasts its own duration.
  const pts = t.chunks.map((c) => ticks(c.timestamp ?? 0));
  const dts = [...pts].sort((a, b) => a - b);
  // The last sample lasts as long as the frame shown last says.
  const lastShown = t.chunks[pts.indexOf(dts[dts.length - 1])];
  const deltas = dts.map((d, i) => (i + 1 < dts.length ? dts[i + 1] - d : Math.max(1, ticks(lastShown?.duration ?? 0) || (i ? dts[i] - dts[i - 1] : 1))));
  const runs = runLengths(deltas);
  const stts = full('stts', 0, 0, u32(runs.length), ...runs.map(([n, d]) => concat([u32(n), u32(d)])));
  // Offsets are kept at zero or more (some players refuse a frame decoded
  // after it's shown): every frame is shown `lead` later, and an edit list
  // starts the track `lead` in, so it still plays from its first frame.
  const raw = pts.map((p, i) => p - dts[i]);
  const lead = raw.reduce((m, o) => Math.max(m, -o), 0);
  const shifts = raw.map((o) => o + lead);
  let ctts = null;
  if (shifts.some((o) => o !== 0)) {
    const oruns = runLengths(shifts);
    ctts = full('ctts', 0, 0, u32(oruns.length), ...oruns.map(([n, o]) => concat([u32(n), u32(o)])));
  }
  const edts = lead ? box('edts', full('elst', 0, 0, u32(1), u32(Math.round(duration * 1000)), u32(lead), u16(1), u16(0))) : null;
  const keys = t.chunks.map((c, i) => (c.key ? i + 1 : 0)).filter(Boolean);
  const stss = video ? full('stss', 0, 0, u32(keys.length), ...keys.map(u32)) : null;
  const stsc = full('stsc', 0, 0, u32(1), u32(1), u32(1), u32(1)); // a chunk per sample
  const stsz = full('stsz', 0, 0, u32(0), u32(t.chunks.length), ...t.chunks.map((c) => u32(c.data.length)));
  const stco = full('stco', 0, 0, u32(offsets.length), ...offsets.map(u32));
  const stbl = box('stbl', full('stsd', 0, 0, u32(1), video ? videoEntry(t) : audioEntry(t)), stts, ...(ctts ? [ctts] : []), ...(stss ? [stss] : []), stsc, stsz, stco);
  return box('trak', tkhd, ...(edts ? [edts] : []), box('mdia', mdhd, hdlr, box('minf', header, dinf, stbl)));
}

/** Values as [count, value] runs of equal ones in a row. */
function runLengths(values) {
  const runs = [];
  for (const v of values) {
    const last = runs[runs.length - 1];
    if (last && last[1] === v) last[0]++;
    else runs.push([1, v]);
  }
  return runs;
}

function videoEntry(t) {
  const common = [zeros(6), u16(1), zeros(16), u16(t.width), u16(t.height), u32(0x00480000), u32(0x00480000), u32(0), u16(1), zeros(32), u16(0x0018), u16(0xffff)];
  if (t.codec === 'avc') return box('avc1', ...common, box('avcC', t.description));
  // vp09.PP.LL.DD: profile, level, bit depth.
  const [, profile = '00', level = '40', depth = '08'] = (t.codecString || 'vp09.00.40.08').split('.');
  const vpcC = full('vpcC', 1, 0, u8(+profile, +level, ((+depth) << 4) | (1 << 1) | 0, 1, 1, 1), u16(0));
  return box('vp09', ...common, vpcC);
}

function audioEntry(t) {
  const common = [zeros(6), u16(1), zeros(8), u16(t.channels), u16(16), u16(0), u16(0), u32(t.sampleRate << 16)];
  if (t.codec === 'opus') {
    // dOps: the Opus header, big-endian, without its magic.
    const dops = concat([u8(0, t.channels), u16(opusPreSkip(t.codecPrivate || t.description)), u32(t.sampleRate), u16(0), u8(0)]);
    return box('Opus', ...common, box('dOps', dops));
  }
  return box('mp4a', ...common, esds(t.description || aacConfig(t.sampleRate, t.channels)));
}

/** The AAC decoder settings (AudioSpecificConfig) for plain AAC-LC. */
function aacConfig(sampleRate, channels) {
  const rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000];
  const i = Math.max(0, rates.indexOf(sampleRate));
  return u8((2 << 3) | (i >> 1), ((i & 1) << 7) | (channels << 3));
}

function esds(config) {
  const desc = (tag, ...parts) => {
    const body = concat(parts);
    return concat([u8(tag, 0x80, 0x80, 0x80, body.length), body]);
  };
  const decoderSpecific = desc(0x05, config);
  const decoderConfig = desc(0x04, u8(0x40, 0x15), u8(0, 0, 0), u32(0), u32(0), decoderSpecific);
  const sl = desc(0x06, u8(0x02));
  return full('esds', 0, 0, desc(0x03, u16(1), u8(0), decoderConfig, sl));
}

// For tests: the boxes in a range of bytes.
export function readBoxes(bytes, start = 0, end = bytes.length) {
  const out = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let p = start; p + 8 <= end;) {
    const size = view.getUint32(p);
    const type = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
    out.push({ type, start: p + 8, end: p + size });
    if (size < 8) break;
    p += size;
  }
  return out;
}
