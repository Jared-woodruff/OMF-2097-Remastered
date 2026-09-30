// Cuts the credits' song ending (src/game/credits/song.ts ENDING_FILE): the master from a little before bar 152's
// downbeat to its end, in the master's format (FLAC, 48 kHz, 24 bit). Needs ffmpeg on the PATH.
// Usage: node tools/credits/ending.mjs
import { spawnSync } from 'node:child_process';

// (src/game/credits/song.ts: BEAT, FIRST_BEAT, ENDING_BAR, ENDING_PREROLL)
const BEAT = 0.434839, FIRST_BEAT = 0.0078, ENDING_BAR = 152, ENDING_PREROLL = 0.1;
const start = FIRST_BEAT + (2 + 4 * ENDING_BAR) * BEAT - ENDING_PREROLL;
const src = 'public/audio/credits/twenty-ninety-seven-remix.flac';
const out = 'public/audio/credits/twenty-ninety-seven-remix-ending.flac';
const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-af', `atrim=start=${start.toFixed(6)},asetpts=PTS-STARTPTS`,
  '-c:a', 'flac', '-sample_fmt', 's32', '-bits_per_raw_sample', '24', '-compression_level', '8', out], { stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status ?? 1);
console.log(`${out}: from ${start.toFixed(3)} s`);
