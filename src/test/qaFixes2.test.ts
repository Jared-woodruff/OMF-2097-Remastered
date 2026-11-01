// Regressions of the QA pass of 2026-11-01: mods that would take gigabytes as they load (sprites, zip entries, PNG
// data) are turned away, Studio keeps to sprites the game can open, texts named like an object's own properties are
// texts, the score's bonus texts stay on one line, old settings get special keys that clash with nothing, a language
// whose files did not come is tried again, the controls screen keeps the player's own keys in its cycle, and the audio
// thread gets songs ready to play, fades the one before and clips smoothly.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { parsePSM, type TrackerModule } from '../audio/psm';
import { TrackerPlayer } from '../audio/tracker';
import { saveAF } from '../formats/af';
import { encodeSprite, Sprite } from '../formats/sprite';
import { ACT_LEFT, ACT_PUNCH, CtrlType, SceneId } from '../game/constants';
import { detectKeyLayout } from '../game/controls';
import { ControlsMenu } from '../game/gui/controlsScreen';
import { ArenaPauseMenu, type PauseHost } from '../game/gui/pauseMenu';
import { TextSlider, type Menu } from '../game/gui/widgets';
import { ChrScore, scoreFormat } from '../game/score';
import { defaultSettings, loadSettings, settings } from '../game/settings';
import { loadLanguageData, setLanguageFetcher, tr, trn, trnText } from '../i18n/i18n';
import { EXTRAS_MOD_ID, reservedNumber } from '../mods/extras';
import { checkFighter } from '../mods/package';
import { ModError } from '../mods/types';
import { projectProblems, spriteFits } from '../studio/checks';
import { newProject } from '../studio/project';
import { blankRobot } from '../studio/robot/newRobot';
import { decodePng, PngError } from '../util/png';
import { crc32, unzip, zip, ZipError } from '../util/zip';
import { createGame, GAMEDATA_DIR, hasGameData, installBrowserShims, loadGameData } from './harness';

describe('files a mod brings', () => {
  it('a zip entry stored as it is must be as long as it says (a short claim slipped past the size limit)', async () => {
    const bytes = await zip([['a.txt', new TextEncoder().encode('hello')]]);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const cd = dv.getUint32(bytes.length - 22 + 16, true);
    expect(dv.getUint16(cd + 10, true)).toBe(0); // stored
    expect((await unzip(bytes)).get('a.txt')?.length).toBe(5);
    dv.setUint32(cd + 24, 0, true); // its uncompressed size: 0
    await expect(unzip(bytes)).rejects.toThrow(ZipError);
  });

  /** A PNG of `w` x `h` gray pixels (all 7) from its IDAT data, `extra` zero bytes after the rows. */
  function png(w: number, h: number, depth = 8, extra = 0): Uint8Array {
    const rows = Buffer.alloc((w + 1) * h + extra);
    for (let y = 0; y < h; y++) rows.fill(7, y * (w + 1) + 1, (y + 1) * (w + 1));
    const chunk = (type: string, data: Uint8Array) => {
      const out = Buffer.alloc(12 + data.length);
      out.writeUInt32BE(data.length, 0);
      out.write(type, 4, 'latin1');
      out.set(data, 8);
      out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)) >>> 0, 8 + data.length);
      return out;
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = depth;
    ihdr[9] = 0; // gray
    return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)),
      chunk('IEND', new Uint8Array(0))]));
  }

  it('a PNG is read as far as its rows go (a small file could inflate to gigabytes), with a bit depth it may have', async () => {
    const img = await decodePng(png(16, 16, 8, 32 * 1024 * 1024));
    expect([img.w, img.h, img.rgba[0], img.rgba[img.rgba.length - 2]]).toEqual([16, 16, 7, 7]);
    await expect(decodePng(png(16, 16, 3))).rejects.toThrow(PngError);
  });

  it('a text named like what every object has is a text (a mod arena called "constructor")', () => {
    expect(tr('constructor')).toBe('constructor');
    expect(tr('__proto__')).toBe('__proto__');
    expect(trn(2, 'toString', 'valueOf')).toBe('valueOf');
    expect(trnText('hasOwnProperty')).toBe('hasOwnProperty');
    // ... and a folder called so has no number of the new robots' (a function, before)
    expect(reservedNumber('robot', `${EXTRAS_MOD_ID}/constructor`)).toBeUndefined();
    expect(reservedNumber('arena', `${EXTRAS_MOD_ID}/toString`)).toBeUndefined();
  });
});

describe.skipIf(!hasGameData)('sprites a mod brings', () => {
  beforeAll(() => {
    installBrowserShims();
    loadGameData();
  });

  /** A sprite of `w` x `h` with one pixel drawn. */
  function sprite(w: number, h: number): Sprite {
    const px = new Uint8Array(w * h);
    px[0] = 1;
    const s = new Sprite();
    s.setData(encodeSprite(px, w, h), w, h);
    return s;
  }

  it('Studio keeps to 1024 pixels a side: the game would not open more', () => {
    expect(spriteFits(new Uint8Array(1100 * 40), 1100, 40)).toBe(false);
    expect(spriteFits(new Uint8Array(1024 * 40), 1024, 40)).toBe(true);
    const af = blankRobot();
    af.moves[11]!.animation.sprites.push(sprite(1100, 40));
    const bytes = saveAF(af);
    expect(() => checkFighter(bytes, 'robot')).toThrow(/1100 x 40 pixels is too big/);
    // A project saved so by an earlier Studio opens, its checks naming the sprite.
    expect(() => checkFighter(bytes, 'robot', true)).not.toThrow();
    const p = newProject();
    p.robots.push({ id: 'x', af, hd: null, info: { name: 'RONIN', description: '', moves: {}, ai: { projectile: [], charge: [], push: [] }, workshop: null } });
    expect(projectProblems(p).some((x) => x.level === 'error' && /1100 x 40 pixels/.test(x.text))).toBe(true);
  });

  it('a robot whose sprites hold too many pixels together is turned away (one at a time they fit)', () => {
    const af = blankRobot();
    for (let i = 0; i < 33; i++) af.moves[11]!.animation.sprites.push(sprite(1024, 1024));
    expect(() => checkFighter(saveAF(af), 'robot')).toThrow(ModError);
    expect(() => checkFighter(saveAF(af), 'robot')).toThrow(/too big together/);
    af.moves[11]!.animation.sprites.splice(-3);
    expect(() => checkFighter(saveAF(af), 'robot')).not.toThrow();
  });
});

describe.skipIf(!hasGameData)('the game', () => {
  beforeAll(() => {
    installBrowserShims();
    loadGameData();
  });

  it('a bonus wider than the score counter stays on one line ("DESTRUCTION BONUS 2,000,0" and "00" below)', () => {
    const s = new ChrScore();
    s.setDifficulty(4); // x1.0
    s.stageMultiplier = 10;
    s.setDestruction();
    s.setDone();
    const t = s.texts[0].text;
    expect(scoreFormat(2000000)).toBe('2,000,000');
    expect(t.width()).toBeGreaterThan(155);
    expect(t.height()).toBeLessThan(12);
  });

  it('old settings get the special keys no other action has (a kick on "/" fired the special move too)', () => {
    localStorage.setItem('omf2097r.settings', JSON.stringify({ revision: 6, keys: { layout: 'classic', p1: { kick: ['Slash'] }, p2: { punch: ['KeyH'] } } }));
    try {
      loadSettings();
      expect(settings().keys.p1.special).toEqual(['NumpadSubtract']);
      expect(settings().keys.p2.special).toEqual([]);
      localStorage.setItem('omf2097r.settings', JSON.stringify({ revision: 6, keys: { layout: 'classic', p1: { kick: ['ShiftRight'] } } }));
      loadSettings();
      expect(settings().keys.p1.special).toEqual(['Slash', 'NumpadSubtract']);
    } finally {
      localStorage.removeItem('omf2097r.settings');
      loadSettings();
    }
  });

  it("the pause menu's SOUND, MUSIC and SPEED are saved as they change (closing the window with it open lost them)", () => {
    localStorage.removeItem('omf2097r.settings');
    const gs = createGame(SceneId.MENU);
    const host: PauseHost = { quitFight() {}, menuVisible: false, training: false, trainingDummy: () => 0, robot: () => null };
    const menu = (new ArenaPauseMenu(gs, host) as unknown as { menu: Menu }).menu;
    const sliders = menu.items.filter((c): c is TextSlider => c instanceof TextSlider);
    expect(sliders.map((c) => c.title)).toEqual(['SOUND', 'MUSIC', 'SPEED']);
    const s = settings();
    const before = [s.sound.soundVol, s.sound.musicVol, s.gameplay.speed];
    try {
      for (const c of sliders) c.action(ACT_LEFT);
      const saved = JSON.parse(localStorage.getItem('omf2097r.settings')!);
      expect([saved.sound.soundVol, saved.sound.musicVol, saved.gameplay.speed]).toEqual(before.map((v) => v - 1));
    } finally {
      [s.sound.soundVol, s.sound.musicVol, s.gameplay.speed] = before;
      localStorage.removeItem('omf2097r.settings');
    }
  });

  it("ENTER on the controls screen keeps the players' own keys in the cycle: CUSTOM, CLASSIC, MODERN, CUSTOM", () => {
    const k = settings().keys;
    const saved = structuredClone(k);
    try {
      Object.assign(k, structuredClone(defaultSettings().keys));
      k.p1.punch = ['KeyM'];
      const menu = new ControlsMenu();
      const seen: string[] = [detectKeyLayout()];
      for (let i = 0; i < 4; i++) {
        menu.action(ACT_PUNCH, CtrlType.KEYBOARD);
        seen.push(detectKeyLayout());
      }
      expect(seen).toEqual(['custom', 'classic', 'modern', 'custom', 'classic']);
      menu.action(ACT_PUNCH, CtrlType.KEYBOARD);
      menu.action(ACT_PUNCH, CtrlType.KEYBOARD);
      expect(k.p1.punch).toEqual(['KeyM']);
    } finally {
      Object.assign(k, saved);
    }
  });
});

describe('languages', () => {
  it('one whose files could not be had is fetched again the next time (it stayed English until a restart)', async () => {
    let online = false;
    setLanguageFetcher(async (p) => {
      if (!online) throw new Error('offline');
      return p.startsWith('lang/ui/') ? { LANGUAGE: 'LANGUE' } : p.startsWith('lang/trn/') ? {} : [];
    });
    expect((await loadLanguageData('fr')).ui).toEqual({});
    online = true;
    expect((await loadLanguageData('fr')).ui).toEqual({ LANGUAGE: 'LANGUE' });
  });
});

describe('the audio thread', () => {
  /** The worklet's mixer, run here: its processor class, made with a port the test talks through. */
  async function mixer(): Promise<{ send: (m: Record<string, unknown>) => void; block: () => Float32Array; softClip: (x: number) => number }> {
    let ctor: (new () => { port: { onmessage: (e: { data: unknown }) => void }; process: (i: unknown[], o: Float32Array[][]) => boolean }) | null = null;
    vi.stubGlobal('sampleRate', 48000);
    vi.stubGlobal('registerProcessor', (_name: string, c: typeof ctor) => (ctor = c));
    vi.stubGlobal('AudioWorkletProcessor', class {
      port = { onmessage: null as unknown, postMessage: () => undefined };
    });
    vi.resetModules();
    const mod = await import('../audio/worklet');
    const proc = new ctor!();
    return {
      send: (m) => proc.port.onmessage({ data: m }),
      block: () => {
        const L = new Float32Array(128), R = new Float32Array(128);
        proc.process([], [[L, R]]);
        return L;
      },
      softClip: mod.softClip,
    };
  }

  it('clips smoothly: no step where the mix reaches full scale (1.001 came out as 0.762, a crackle)', async () => {
    const { softClip } = await mixer();
    let last = 0;
    for (let x = 0; x <= 4; x += 0.0005) {
      const y = softClip(x);
      expect(y - last).toBeGreaterThanOrEqual(0);
      expect(y - last).toBeLessThanOrEqual(0.0005 + 1e-9);
      expect(y).toBeLessThan(1);
      expect(softClip(-x)).toBe(-y);
      last = y;
    }
    vi.unstubAllGlobals();
  });

  it.skipIf(!hasGameData)('gets a song read on the main thread, and fades the song out when it stops (it was cut: a click)', async () => {
    const data = new Uint8Array(fs.readFileSync(path.join(GAMEDATA_DIR, 'MENU.PSM')));
    const module: TrackerModule = structuredClone(parsePSM(data));
    // (the song as the audio thread gets it plays the same)
    const a = new TrackerPlayer(parsePSM(data), 48000), b = new TrackerPlayer(module, 48000);
    const al = new Float32Array(48000), ar = new Float32Array(48000), bl = new Float32Array(48000), br = new Float32Array(48000);
    a.render(al, ar, 0, 48000);
    b.render(bl, br, 0, 48000);
    expect(bl).toEqual(al);
    const m = await mixer();
    m.send({ type: 'volume', sound: 0.5, music: 0.5 });
    m.send({ type: 'music', name: 'MENU', module });
    let level = 0;
    for (let i = 0; i < 400; i++) level = Math.max(level, ...m.block().map(Math.abs));
    expect(level).toBeGreaterThan(0.01);
    m.send({ type: 'musicStop' });
    const after = m.block();
    expect(Math.max(...after.map(Math.abs))).toBeGreaterThan(0);
    for (let i = 0; i < 12; i++) m.block();
    expect(Math.max(...m.block().map(Math.abs))).toBe(0);
    vi.unstubAllGlobals();
  });
});
