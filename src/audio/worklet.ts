// AudioWorklet mixer: 3 sound-effect channels (8-bit PCM at Sound Blaster rates) plus the PSM music player, and the
// remaster's impact thumps. Output 0 is the mix; output 1 carries the sound effects alone, for the arena acoustics
// (a convolution reverb on the main thread).
import { parsePSM } from './psm';
import { TrackerPlayer } from './tracker';

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

interface Channel {
  data: Float32Array | null;
  pos: number;
  step: number;
  gainL: number;
  gainR: number;
  targetL: number;
  targetR: number;
  volume: number;
  fade: number; // fade gain
  fadeDelta: number; // per sample (negative: fade out, positive: fade in)
  active: boolean;
}

const CHANNELS = 3;
const MAX_THUMPS = 4;

/** A low "thump" under heavy impacts: a decaying sine that sweeps down, with a little second harmonic. */
interface Thump {
  t: number;
  dur: number;
  f0: number;
  f1: number;
  amp: number;
  phase: number;
  l: number;
  r: number;
}

function panGains(pan: number): [number, number] {
  // Same law as the reference SDL backend: the far side attenuates linearly.
  const l = pan > 0 ? ((100 - pan) * 255) / 100 : 255;
  const r = pan < 0 ? ((100 + pan) * 255) / 100 : 255;
  return [l / 255, r / 255];
}

class OmfAudioProcessor extends AudioWorkletProcessor {
  private sounds: Float32Array[] = [];
  private chans: Channel[] = [];
  private soundVol = 0.5;
  private musicVol = 0.5;
  private music: TrackerPlayer | null = null;
  private musicFade = 1;
  private musicFadeDelta = 0;
  private nextMusic: TrackerPlayer | null = null;
  private cubic = false;
  private mixL = new Float32Array(128);
  private mixR = new Float32Array(128);
  private sfxL = new Float32Array(128);
  private sfxR = new Float32Array(128);
  private thumps: Thump[] = [];

  constructor() {
    super();
    for (let i = 0; i < CHANNELS; i++) {
      this.chans.push({ data: null, pos: 0, step: 1, gainL: 1, gainR: 1, targetL: 1, targetR: 1, volume: 1, fade: 1, fadeDelta: 0, active: false });
    }
    this.port.onmessage = (e: MessageEvent) => this.onMessage(e.data);
  }

  private onMessage(m: { type: string; [k: string]: unknown }): void {
    try {
      switch (m.type) {
        case 'sounds':
          this.sounds = m.sounds as Float32Array[];
          break;
        case 'play': {
          const c = this.chans[m.ch as number];
          const d = this.sounds[m.id as number];
          if (!c || !d) break;
          c.data = d;
          c.pos = 0;
          c.step = (m.rate as number) / sampleRate;
          c.volume = (m.volume as number) / 128;
          const [l, r] = panGains(m.pan as number);
          c.gainL = c.targetL = l;
          c.gainR = c.targetR = r;
          const fadeIn = m.fadeInMs as number;
          if (fadeIn > 0) {
            c.fade = 0;
            c.fadeDelta = 1 / ((fadeIn / 1000) * sampleRate);
          } else {
            c.fade = 1;
            c.fadeDelta = 0;
          }
          c.active = true;
          break;
        }
        case 'stop': {
          const c = this.chans[m.ch as number];
          if (c) c.active = false;
          break;
        }
        case 'fade': {
          const c = this.chans[m.ch as number];
          if (c && c.active) c.fadeDelta = -1 / Math.max(1, ((m.ms as number) / 1000) * sampleRate);
          break;
        }
        case 'pan': {
          const c = this.chans[m.ch as number];
          if (c) [c.targetL, c.targetR] = panGains(m.pan as number);
          break;
        }
        case 'volume':
          this.soundVol = m.sound as number;
          this.musicVol = m.music as number;
          this.music?.setVolume(this.musicVol);
          break;
        case 'quality':
          this.cubic = m.quality === 'enhanced';
          this.music?.setInterpolation(this.cubic ? 'cubic' : 'linear');
          break;
        case 'music': {
          const mod = parsePSM(m.data as Uint8Array);
          const p = new TrackerPlayer(mod, sampleRate);
          p.setVolume(this.musicVol);
          p.setLoop(true);
          p.setInterpolation(this.cubic ? 'cubic' : 'linear');
          this.music = p;
          this.musicFade = 1;
          this.musicFadeDelta = 0;
          break;
        }
        case 'musicStop':
          this.music = null;
          break;
        case 'thump': {
          if (this.thumps.length >= MAX_THUMPS) this.thumps.shift();
          const [l, r] = panGains(m.pan as number);
          this.thumps.push({ t: 0, dur: m.dur as number, f0: m.f0 as number, f1: m.f1 as number, amp: m.amp as number, phase: 0, l, r });
          break;
        }
      }
    } catch (err) {
      this.port.postMessage({ type: 'error', message: String((err as Error)?.stack ?? err) });
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const L = out[0];
    const R = out[1] ?? out[0];
    const n = L.length;
    if (this.mixL.length < n) {
      this.mixL = new Float32Array(n);
      this.mixR = new Float32Array(n);
      this.sfxL = new Float32Array(n);
      this.sfxR = new Float32Array(n);
    }
    const ml = this.mixL, mr = this.mixR;
    ml.fill(0, 0, n);
    mr.fill(0, 0, n);
    // Sound effects are mixed apart first: they also feed the acoustics send.
    const sl = this.sfxL, sr = this.sfxR;
    sl.fill(0, 0, n);
    sr.fill(0, 0, n);
    if (this.music) {
      try {
        this.music.render(ml, mr, 0, n);
      } catch (err) {
        this.port.postMessage({ type: 'error', message: String((err as Error)?.stack ?? err) });
        this.music = null;
      }
    }
    // Sound effects (linear interpolation; source is 8-bit PCM at ~8-22 kHz).
    const sv = this.soundVol;
    for (const c of this.chans) {
      if (!c.active || !c.data) continue;
      const d = c.data;
      const len = d.length;
      for (let i = 0; i < n; i++) {
        const ip = c.pos | 0;
        if (ip >= len) {
          c.active = false;
          break;
        }
        const f = c.pos - ip;
        const s0 = d[ip];
        const s1 = ip + 1 < len ? d[ip + 1] : s0;
        const s = (s0 + (s1 - s0) * f) * c.volume * c.fade * sv;
        // Smooth pan changes (pan follows moving objects).
        c.gainL += (c.targetL - c.gainL) * 0.002;
        c.gainR += (c.targetR - c.gainR) * 0.002;
        sl[i] += s * c.gainL;
        sr[i] += s * c.gainR;
        c.pos += c.step;
        if (c.fadeDelta !== 0) {
          c.fade += c.fadeDelta;
          if (c.fade >= 1) {
            c.fade = 1;
            c.fadeDelta = 0;
          } else if (c.fade <= 0) {
            c.active = false;
            break;
          }
        }
      }
    }
    const send = outputs[1];
    if (send && send[0]) {
      send[0].set(sl.subarray(0, n));
      if (send[1]) send[1].set(sr.subarray(0, n));
    }
    // Impact thumps (dry: low frequencies would only muddy the reverb).
    const dt = 1 / sampleRate;
    for (let k = this.thumps.length - 1; k >= 0; k--) {
      const th = this.thumps[k];
      const decay = th.dur * 0.3, sweep = th.dur * 0.22;
      for (let i = 0; i < n; i++) {
        const t = th.t;
        const env = Math.min(1, t / 0.004) * Math.exp(-t / decay);
        const f = th.f1 + (th.f0 - th.f1) * Math.exp(-t / sweep);
        th.phase += 2 * Math.PI * f * dt;
        const s = (Math.sin(th.phase) + 0.3 * Math.sin(2 * th.phase) * Math.exp(-t / (decay * 0.5))) * env * th.amp * sv;
        sl[i] += s * th.l;
        sr[i] += s * th.r;
        th.t += dt;
      }
      if (th.t >= th.dur) this.thumps.splice(k, 1);
    }
    for (let i = 0; i < n; i++) {
      // Soft clip to avoid harsh distortion when many sources overlap.
      const l = ml[i] + sl[i], r = mr[i] + sr[i];
      L[i] = l > 1 || l < -1 ? Math.tanh(l) : l;
      if (R !== L) R[i] = r > 1 || r < -1 ? Math.tanh(r) : r;
    }
    return true;
  }
}

registerProcessor('omf-audio', OmfAudioProcessor);
