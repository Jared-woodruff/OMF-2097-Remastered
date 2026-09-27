#!/usr/bin/env node
// Renders a MASI PSM music module (One Must Fall 2097 MENU.PSM, ARENA0.PSM, ...) to a 16-bit
// stereo WAV file using the game's player (src/audio/psm.ts + src/audio/tracker.ts).
//
// Usage (Node >= 22.18 / 23.6, which load the TypeScript sources directly by type stripping):
//   node tools/render-psm.mjs public/gamedata/MENU.PSM out.wav --seconds 90
//
// Options:
//   --seconds N       length to render (default: one full pass of the song plus 2 s)
//   --rate HZ         output sample rate (default 44100)
//   --interp MODE     nearest | linear | cubic (default linear)
//   --gain G          mix gain (default: the player's DEFAULT_MIX_GAIN)
//   --volume V        master volume 0..1 (default 1)
//   --separation S    stereo separation 0..1 (default 1 = original Sound Blaster driver panning)
//   --no-loop         stop at the end of the song instead of looping
//   --song N          subsong index (default 0)
//   --rows FILE       also write a "frame order pattern row" line for every row change
//   --info            print module information only
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (file) => pathToFileURL(path.join(root, 'src', 'audio', file)).href;
const { parsePSM } = await import(src('psm.ts'));
const { TrackerPlayer, measureSong, DEFAULT_MIX_GAIN } = await import(src('tracker.ts'));

function usage(msg) {
  if (msg) console.error(`error: ${msg}`);
  console.error('usage: node tools/render-psm.mjs <in.psm> <out.wav> [--seconds N] [--rate HZ] [--interp nearest|linear|cubic]');
  console.error('       [--gain G] [--volume V] [--separation S] [--no-loop] [--song N] [--rows FILE] [--info]');
  process.exit(2);
}

const args = process.argv.slice(2);
const positional = [];
const opt = { rate: 44100, interp: 'linear', loop: true, song: 0, volume: 1, separation: 1 };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const next = () => {
    if (i + 1 >= args.length) usage(`${a} needs a value`);
    return args[++i];
  };
  if (a === '--seconds') opt.seconds = Number(next());
  else if (a === '--rate') opt.rate = Number(next());
  else if (a === '--interp') opt.interp = next();
  else if (a === '--gain') opt.gain = Number(next());
  else if (a === '--volume') opt.volume = Number(next());
  else if (a === '--separation') opt.separation = Number(next());
  else if (a === '--no-loop') opt.loop = false;
  else if (a === '--song') opt.song = Number(next());
  else if (a === '--rows') opt.rows = next();
  else if (a === '--info') opt.info = true;
  else if (a.startsWith('--')) usage(`unknown option ${a}`);
  else positional.push(a);
}
if (positional.length < (opt.info ? 1 : 2)) usage();
if (!['nearest', 'linear', 'cubic'].includes(opt.interp)) usage(`bad --interp ${opt.interp}`);

const [inPath, outPath] = positional;
let mod;
try {
  mod = parsePSM(new Uint8Array(fs.readFileSync(inPath)));
} catch (err) {
  console.error(`error: ${inPath}: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
const song = mod.songs[opt.song];
if (!song) usage(`song ${opt.song} does not exist`);
const len = measureSong(mod, opt.song);
const nonEmpty = mod.samples.filter((s) => s.data.length > 0).length;
console.log(`${path.basename(inPath)}: "${mod.title}", ${song.channels} channels, ${mod.patterns.length} patterns, ` +
  `${song.orders.length} orders, ${nonEmpty}/${mod.samples.length} samples, speed ${song.initialSpeed}, tempo ${song.initialTempo}`);
console.log(`song length ${len.seconds.toFixed(3)} s (${len.rows} rows, ${len.ticks} ticks) until it ${len.loops ? `loops to order ${song.restartOrder}` : 'ends'}`);
if (opt.info) process.exit(0);

const seconds = opt.seconds ?? len.seconds + 2;
if (!(seconds > 0)) usage('bad --seconds');
const player = new TrackerPlayer(mod, opt.rate, {
  song: opt.song,
  interpolation: opt.interp,
  loop: opt.loop,
  mixGain: opt.gain ?? DEFAULT_MIX_GAIN,
  stereoSeparation: opt.separation,
});
player.setVolume(opt.volume);

const total = Math.round(seconds * opt.rate);
const BLOCK = 128; // render like an AudioWorklet does
const L = new Float32Array(BLOCK);
const R = new Float32Array(BLOCK);
const pcm = Buffer.alloc(total * 4);
const rowLog = [];
let lastRow = '';
let peak = 0;
let clipped = 0;
let sumSq = 0;
for (let done = 0; done < total; done += BLOCK) {
  const n = Math.min(BLOCK, total - done);
  L.fill(0);
  R.fill(0);
  player.render(L, R, 0, n);
  for (let i = 0; i < n; i++) {
    const l = L[i];
    const r = R[i];
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
    sumSq += l * l + r * r;
    if (Math.abs(l) > 1 || Math.abs(r) > 1) clipped++;
    pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(l * 32767))), (done + i) * 4);
    pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(r * 32767))), (done + i) * 4 + 2);
  }
  if (opt.rows) {
    const key = `${player.order} ${player.pattern} ${player.row}`;
    if (key !== lastRow) {
      rowLog.push(`${done + n} ${key}`);
      lastRow = key;
    }
  }
}

const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write('WAVEfmt ', 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(2, 22); // stereo
header.writeUInt32LE(opt.rate, 24);
header.writeUInt32LE(opt.rate * 4, 28);
header.writeUInt16LE(4, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(pcm.length, 40);
fs.writeFileSync(outPath, Buffer.concat([header, pcm]));
if (opt.rows) fs.writeFileSync(opt.rows, rowLog.join('\n') + '\n');

const rms = Math.sqrt(sumSq / (2 * total));
const db = (x) => (x > 0 ? (20 * Math.log10(x)).toFixed(1) : '-inf');
console.log(`wrote ${outPath}: ${seconds.toFixed(2)} s at ${opt.rate} Hz, peak ${peak.toFixed(3)} (${db(peak)} dBFS), ` +
  `RMS ${db(rms)} dBFS, ${clipped} clipped frames${player.ended ? ', song ended' : ''}`);
