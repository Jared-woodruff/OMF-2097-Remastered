// AudioWorklet mixer: 3 sound-effect channels (8-bit PCM at Sound Blaster rates) plus the PSM music player.
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
    }
    const ml = this.mixL, mr = this.mixR;
    ml.fill(0, 0, n);
    mr.fill(0, 0, n);
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
        ml[i] += s * c.gainL;
        mr[i] += s * c.gainR;
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
    for (let i = 0; i < n; i++) {
      // Soft clip to avoid harsh distortion when many sources overlap.
      const l = ml[i], r = mr[i];
      L[i] = l > 1 || l < -1 ? Math.tanh(l) : l;
      if (R !== L) R[i] = r > 1 || r < -1 ? Math.tanh(r) : r;
    }
    return true;
  }
}

registerProcessor('omf-audio', OmfAudioProcessor);
