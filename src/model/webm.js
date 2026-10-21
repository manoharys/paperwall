// WebM files, written from scratch: the browser encodes the video (VP9 or
// VP8) and audio (Opus); this puts the pieces in a Matroska/WebM file, with
// a seek head and cues so players can jump around in it.

import { concat } from './bytes.js';
import { opusPreSkip, opusHead, isOpusHead } from './opus.js';

const enc = new TextEncoder();

/** An element ID's bytes (IDs carry their own length marker). */
function idBytes(id) {
  const out = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) out.unshift(v & 255);
  return Uint8Array.from(out);
}

/** A size as an EBML variable-length integer (the shortest that fits, or `len` bytes). */
function vint(n, len = 0) {
  let l = len || 1;
  while (!len && n >= 2 ** (7 * l) - 1) l++;
  const out = new Uint8Array(l);
  let v = n;
  for (let i = l - 1; i >= 0; i--) {
    out[i] = v & 255;
    v = Math.floor(v / 256);
  }
  out[0] |= 1 << (8 - l);
  return out;
}

/**
 * An element: its header and its contents as a list of parts, so the big
 * media bytes inside are pointed to, never copied, until the file is made.
 */
const el = (id, ...payload) => {
  const parts = payload.flatMap((p) => (p instanceof Uint8Array ? [p] : p.parts));
  const size = parts.reduce((s, p) => s + p.length, 0);
  const head = concat([idBytes(id), vint(size)]);
  return { parts: [head, ...parts], length: head.length + size };
};
const uint = (id, n, len = 0) => {
  const bytes = [];
  let v = n;
  do {
    bytes.unshift(v & 255);
    v = Math.floor(v / 256);
  } while (v > 0);
  while (bytes.length < len) bytes.unshift(0);
  return el(id, Uint8Array.from(bytes));
};
const float = (id, x) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, x);
  return el(id, b);
};
const str = (id, s) => el(id, enc.encode(s));

const ID = {
  EBML: 0x1a45dfa3, Segment: 0x18538067, SeekHead: 0x114d9b74, Seek: 0x4dbb, SeekID: 0x53ab, SeekPosition: 0x53ac,
  Info: 0x1549a966, TimecodeScale: 0x2ad7b1, Duration: 0x4489, MuxingApp: 0x4d80, WritingApp: 0x5741,
  Tracks: 0x1654ae6b, TrackEntry: 0xae, TrackNumber: 0xd7, TrackUID: 0x73c5, TrackType: 0x83, CodecID: 0x86, CodecPrivate: 0x63a2,
  CodecDelay: 0x56aa, SeekPreRoll: 0x56bb, Video: 0xe0, PixelWidth: 0xb0, PixelHeight: 0xba, Audio: 0xe1, SamplingFrequency: 0xb5, Channels: 0x9f,
  Cluster: 0x1f43b675, Timecode: 0xe7, SimpleBlock: 0xa3,
  Cues: 0x1c53bb6b, CuePoint: 0xbb, CueTime: 0xb3, CueTrackPositions: 0xb7, CueTrack: 0xf7, CueClusterPosition: 0xf1,
};

/**
 * video: { codec: 'vp9' | 'vp8', width, height, chunks: [{ data, timestamp (µs), key }] }
 * audio (optional): { sampleRate, channels, codecPrivate (OpusHead bytes), chunks: [...] }
 * duration: seconds. Returns the file's bytes.
 */
export function buildWebm(spec) {
  return concat(buildWebmParts(spec));
}

/** The file as a list of parts (for a Blob: the media is never copied). */
export function buildWebmParts({ video, audio = null, duration }) {
  const tracks = [el(ID.TrackEntry,
    uint(ID.TrackNumber, 1), uint(ID.TrackUID, 1), uint(ID.TrackType, 1), str(ID.CodecID, video.codec === 'vp8' ? 'V_VP8' : 'V_VP9'),
    el(ID.Video, uint(ID.PixelWidth, video.width), uint(ID.PixelHeight, video.height)))];
  if (audio) {
    tracks.push(el(ID.TrackEntry,
      uint(ID.TrackNumber, 2), uint(ID.TrackUID, 2), uint(ID.TrackType, 2), str(ID.CodecID, 'A_OPUS'),
      // The encoder's own header when it gave one in the usual form, else ours.
      el(ID.CodecPrivate, isOpusHead(audio.codecPrivate) ? audio.codecPrivate : opusHead(audio.channels, audio.sampleRate)),
      // The decoder's delay, from the header's pre-skip (48 kHz samples), in ns.
      uint(ID.CodecDelay, Math.round((opusPreSkip(audio.codecPrivate) / 48000) * 1e9)), uint(ID.SeekPreRoll, 80000000),
      el(ID.Audio, float(ID.SamplingFrequency, audio.sampleRate), uint(ID.Channels, audio.channels))));
  }
  const info = el(ID.Info, uint(ID.TimecodeScale, 1000000), float(ID.Duration, duration * 1000), str(ID.MuxingApp, 'Paperwall'), str(ID.WritingApp, 'Paperwall'));
  const tracksEl = el(ID.Tracks, ...tracks);

  // Every block, in time order; a new cluster at each video key frame (and
  // before a cluster's relative times would overflow).
  const blocks = [
    ...video.chunks.map((c) => ({ ...c, track: 1 })),
    ...(audio ? audio.chunks.map((c) => ({ ...c, track: 2, key: true })) : []),
  ].sort((a, b) => a.timestamp - b.timestamp || a.track - b.track);
  const clusters = [];
  let cur = null;
  // Times here can't be negative: if an encoder's lead-in starts before 0,
  // everything moves later by that much (keeping every gap as it was).
  const base = Math.min(0, blocks[0]?.timestamp ?? 0); // (blocks are in time order)
  for (const b of blocks) {
    const ms = Math.round((b.timestamp - base) / 1000);
    if (!cur || (b.track === 1 && b.key) || ms - cur.start > 30000) {
      // A cluster that opens on a video key frame is a place to jump to.
      cur = { start: ms, blocks: [], key: b.track === 1 && b.key };
      clusters.push(cur);
    }
    const head = new Uint8Array(4);
    head[0] = 0x80 | b.track;
    new DataView(head.buffer).setInt16(1, ms - cur.start);
    head[3] = b.key ? 0x80 : 0;
    cur.blocks.push(el(ID.SimpleBlock, head, b.data));
  }
  const clusterEls = clusters.map((c) => el(ID.Cluster, uint(ID.Timecode, c.start), ...c.blocks));

  // Positions are counted from the start of the segment's contents. The seek
  // head is written with fixed-size numbers, so its own size is known first.
  const seekEntry = (id, pos) => el(ID.Seek, el(ID.SeekID, idBytes(id)), uint(ID.SeekPosition, pos, 8));
  const seekSize = el(ID.SeekHead, seekEntry(ID.Info, 0), seekEntry(ID.Tracks, 0), seekEntry(ID.Cues, 0)).length;
  const infoAt = seekSize;
  const tracksAt = infoAt + info.length;
  let at = tracksAt + tracksEl.length;
  const cuePoints = [];
  clusters.forEach((c, i) => {
    // Cues only where a key frame starts the cluster: video decodes from there.
    if (c.key) cuePoints.push(el(ID.CuePoint, uint(ID.CueTime, c.start), el(ID.CueTrackPositions, uint(ID.CueTrack, 1), uint(ID.CueClusterPosition, at, 8))));
    at += clusterEls[i].length;
  });
  const cues = el(ID.Cues, ...cuePoints);
  const seekHead = el(ID.SeekHead, seekEntry(ID.Info, infoAt), seekEntry(ID.Tracks, tracksAt), seekEntry(ID.Cues, at));
  const segment = el(ID.Segment, seekHead, info, tracksEl, ...clusterEls, cues);
  const header = el(ID.EBML,
    uint(0x4286, 1), uint(0x42f7, 1), uint(0x42f2, 4), uint(0x42f3, 8), str(0x4282, 'webm'), uint(0x4287, 4), uint(0x4285, 2));
  return [...header.parts, ...segment.parts];
}

// For tests: read an EBML tree back.
export function readEbml(bytes, start = 0, end = bytes.length) {
  const out = [];
  let p = start;
  const readVint = (keepMarker) => {
    const first = bytes[p];
    let len = 1;
    while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
    let v = keepMarker ? first : first & (0xff >> len);
    for (let i = 1; i < len; i++) v = v * 256 + bytes[p + i];
    p += len;
    return v;
  };
  while (p < end) {
    const id = readVint(true);
    const size = readVint(false);
    out.push({ id, start: p, size });
    p += size;
  }
  return out;
}
