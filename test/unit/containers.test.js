import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMp4, readBoxes } from '../../src/model/mp4.js';
import { buildWebm, readEbml } from '../../src/model/webm.js';

// The browser this runs in for tests may not offer H.264 or AAC, so their
// paths are checked here with real streams made by ffmpeg (where it's
// installed): our files must decode cleanly, frame for frame.
const ffmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const run = (args) => {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return r;
};

/** Split an Annex B H.264 stream (with access unit delimiters) into samples and avcC. */
function annexB(bytes) {
  const nals = [];
  for (let i = 0, start = -1; i <= bytes.length; i++) {
    const at3 = bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1;
    if (at3 || i === bytes.length) {
      if (start >= 0) {
        let end = i;
        while (end > start && bytes[end - 1] === 0) end--;
        nals.push(bytes.subarray(start, end));
      }
      start = i + 3;
      i += 2;
    }
  }
  let sps = null;
  let pps = null;
  const units = [];
  let cur = null;
  for (const n of nals) {
    const type = n[0] & 31;
    if (type === 9) {
      cur = { nals: [], key: false };
      units.push(cur);
      continue;
    }
    if (type === 7) sps ||= n;
    if (type === 8) pps ||= n;
    if (type === 5) cur.key = true;
    if (type === 7 || type === 8 || type === 6) continue;
    cur.nals.push(n);
  }
  const lp = (list) => Buffer.concat(list.flatMap((n) => [Buffer.from([(n.length >>> 24) & 255, (n.length >>> 16) & 255, (n.length >>> 8) & 255, n.length & 255]), Buffer.from(n)]));
  const avcC = Buffer.concat([Buffer.from([1, sps[1], sps[2], sps[3], 0xff, 0xe1, sps.length >> 8, sps.length & 255]), Buffer.from(sps), Buffer.from([1, pps.length >> 8, pps.length & 255]), Buffer.from(pps)]);
  return { avcC: new Uint8Array(avcC), units: units.filter((u) => u.nals.length).map((u) => ({ data: new Uint8Array(lp(u.nals)), key: u.key })) };
}

/** Raw AAC frames out of ADTS, and the stream's AudioSpecificConfig. */
function adts(bytes) {
  const frames = [];
  let config = null;
  for (let p = 0; p + 7 <= bytes.length;) {
    const len = ((bytes[p + 3] & 3) << 11) | (bytes[p + 4] << 3) | (bytes[p + 5] >> 5);
    const head = bytes[p + 1] & 1 ? 7 : 9;
    if (!config) {
      const profile = (bytes[p + 2] >> 6) + 1;
      const rate = (bytes[p + 2] >> 2) & 15;
      const ch = ((bytes[p + 2] & 1) << 2) | (bytes[p + 3] >> 6);
      config = new Uint8Array([(profile << 3) | (rate >> 1), ((rate & 1) << 7) | (ch << 3)]);
    }
    frames.push(bytes.subarray(p + head, p + len));
    p += len;
  }
  return { frames, config };
}

/** Real Opus packets (and their OpusHead), from an audio-only WebM ffmpeg makes, read with our own EBML reader. */
function opusPackets(dir) {
  run(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2', '-ac', '2', '-c:a', 'libopus', '-f', 'webm', join(dir, 'a.webm')]);
  const b = new Uint8Array(readFileSync(join(dir, 'a.webm')));
  const [, seg] = readEbml(b);
  const chunks = [];
  let head = null;
  const walk = (start, end) => {
    for (const e of readEbml(b, start, end)) {
      if ([0x1654ae6b, 0xae, 0x1f43b675].includes(e.id)) walk(e.start, e.start + e.size);
      if (e.id === 0x63a2) head = b.slice(e.start, e.start + e.size);
      if (e.id === 0xa3) chunks.push({ data: b.slice(e.start + 4, e.start + e.size), timestamp: chunks.length * 20000, duration: 20000, key: true });
    }
  };
  walk(seg.start, seg.start + seg.size);
  return { sampleRate: 48000, channels: 2, codecPrivate: head, chunks };
}

test('[MOT-06] MP4 with H.264 and AAC decodes cleanly, every frame', { skip: !ffmpeg && 'ffmpeg is not installed' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'pw-mp4-'));
  try {
    run(['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30:duration=2', '-c:v', 'libx264', '-g', '60', '-bf', '0', '-pix_fmt', 'yuv420p', '-x264-params', 'aud=1', '-f', 'h264', join(dir, 'v.h264')]);
    run(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2', '-ac', '2', '-c:a', 'aac', '-f', 'adts', join(dir, 'a.aac')]);
    const v = annexB(new Uint8Array(readFileSync(join(dir, 'v.h264'))));
    const a = adts(new Uint8Array(readFileSync(join(dir, 'a.aac'))));
    assert.equal(v.units.length, 60);
    const frame = 1e6 / 30;
    const mp4 = buildMp4({
      video: { codec: 'avc', width: 320, height: 240, description: v.avcC, chunks: v.units.map((u, i) => ({ ...u, timestamp: i * frame, duration: frame })) },
      audio: { codec: 'aac', sampleRate: 48000, channels: 2, description: a.config, chunks: a.frames.map((d, i) => ({ data: d, timestamp: (i * 1024 * 1e6) / 48000, duration: (1024 * 1e6) / 48000, key: true })) },
      duration: 2,
    });
    assert.deepEqual(readBoxes(mp4).map((b) => b.type), ['ftyp', 'moov', 'mdat']);
    writeFileSync(join(dir, 'out.mp4'), mp4);
    // Decodes with no errors, and has every frame.
    const probe = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,nb_read_frames', '-of', 'csv=p=0', join(dir, 'out.mp4')], { encoding: 'utf8' });
    assert.equal(probe.stderr, '');
    assert.equal(probe.stdout.trim(), 'h264,320,240,60');
    const audio = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name,channels,sample_rate', '-of', 'csv=p=0', join(dir, 'out.mp4')], { encoding: 'utf8' });
    assert.equal(audio.stdout.trim(), 'aac,48000,2');
    const decode = spawnSync('ffmpeg', ['-v', 'error', '-i', join(dir, 'out.mp4'), '-f', 'null', '-'], { encoding: 'utf8' });
    assert.equal(decode.stderr, '', 'no decoding errors');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('[MOT-06] WebM with VP9 and Opus decodes cleanly, with cues', { skip: !ffmpeg && 'ffmpeg is not installed' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'pw-webm-'));
  try {
    // Real VP9 frames and Opus packets, taken out of ffmpeg's own WebM with
    // its frame dump (one file per packet).
    run(['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30:duration=2', '-c:v', 'libvpx-vp9', '-g', '60', '-deadline', 'realtime', '-f', 'ivf', join(dir, 'v.ivf')]);
    const ivf = new Uint8Array(readFileSync(join(dir, 'v.ivf')));
    const frames = [];
    for (let p = 32; p + 12 <= ivf.length;) {
      const size = ivf[p] | (ivf[p + 1] << 8) | (ivf[p + 2] << 16) | (ivf[p + 3] << 24);
      frames.push({ data: ivf.subarray(p + 12, p + 12 + size), key: frames.length % 60 === 0 }); // a key frame every 60 (-g 60)
      p += 12 + size;
    }
    const frame = 1e6 / 30;
    const audio = opusPackets(dir);
    const webm = buildWebm({ video: { codec: 'vp9', width: 320, height: 240, chunks: frames.map((f, i) => ({ data: f.data, key: f.key, timestamp: i * frame })) }, audio, duration: 2 });
    const top = readEbml(webm);
    assert.deepEqual(top.map((e) => e.id.toString(16)), ['1a45dfa3', '18538067']);
    const inSegment = readEbml(webm, top[1].start, top[1].start + top[1].size).map((e) => e.id.toString(16));
    assert.deepEqual([inSegment[0], inSegment[1], inSegment[2], inSegment.at(-1)], ['114d9b74', '1549a966', '1654ae6b', '1c53bb6b'], 'seek head, info, tracks … cues');
    writeFileSync(join(dir, 'out.webm'), webm);
    const probe = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,nb_read_frames', '-of', 'csv=p=0', join(dir, 'out.webm')], { encoding: 'utf8' });
    assert.equal(probe.stderr, '');
    assert.equal(probe.stdout.trim(), 'vp9,320,240,60');
    const sound = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name,channels,sample_rate', '-of', 'csv=p=0', join(dir, 'out.webm')], { encoding: 'utf8' });
    assert.equal(sound.stdout.trim(), 'opus,48000,2');
    const decode = spawnSync('ffmpeg', ['-v', 'error', '-i', join(dir, 'out.webm'), '-f', 'null', '-'], { encoding: 'utf8' });
    assert.equal(decode.stderr, '');
    // And Opus in MP4.
    const mp4 = buildMp4({ video: { codec: 'vp9', codecString: 'vp09.00.10.08', width: 320, height: 240, chunks: frames.map((f, i) => ({ data: f.data, key: f.key, timestamp: i * frame, duration: frame })) }, audio: { ...audio, codec: 'opus' }, duration: 2 });
    writeFileSync(join(dir, 'out.mp4'), mp4);
    const both = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_name,nb_read_frames', '-of', 'csv=p=0', join(dir, 'out.mp4')], { encoding: 'utf8' });
    assert.equal(both.stderr, '');
    assert.match(both.stdout, /vp9,60/);
    assert.match(both.stdout, /opus,\d+/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
