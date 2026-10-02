// The mods the game plays. When it starts, every mod that is on is read and its content joins the game: the mods that
// come with the game first (bundled.ts: the remaster's new robots and arenas), then the installed ones (store.ts). Each
// robot, arena and pilot gets its number (ids.ts), its files are provided under the names the engine loads (FIGHTRn.AF,
// ARENAn.BK / .WID, see resources/generated.ts) and its names and texts are registered; a robot built from the robot
// workshop's parts (robot.json's "workshop") joins the generator's robots too, for what the game draws from their 3D
// models (the mech lab's turning robot, HD pictures its package has none for). The rest of the game asks here what is
// there (roster.ts: the select screens, the arena rotation, the computer's opponents). A mod that cannot be loaded is
// left out with its reason (the MODS page shows it); turning mods on or off takes effect the next time the game starts
// (the engine keeps what it loaded).
import { HAR_NAMES } from '../game/constants';
import { registerGenRobot, unregisterGenRobot } from '../gen/roster';
import { workshopRobot } from '../gen/workshop';
import { APP_VERSION } from '../platform/versionLabel';
import { forgetGenerated, provideGenerated } from '../resources/generated';
import { forgetBk, forgetFighter, harFileName, setHarName } from '../resources/resources';
import { decodePng, type PngImage } from '../util/png';
import { bundledEnabled, bundledMods, fetchBundled, migrateNewContent, type BundledMod } from './bundled';
import { modContentId, setInstalledMods } from './ids';
import { readModPackage, type ModHd, type ModPackage } from './package';
import { listMods, testMod } from './store';
import { ModError, type ModArenaInfo, type ModHdFrame, type ModPilotInfo, type ModRobotInfo } from './types';

export interface ModRobot {
  /** "<mod id>/<robot id>" */
  key: string;
  mod: string;
  harId: number;
  info: ModRobotInfo;
  /** Its HD pictures (hdArt.ts), if it has any. */
  hd: ModHd | null;
}

export interface ModArena {
  key: string;
  mod: string;
  /** Arena number (scene SceneId.ARENA0 + index). */
  index: number;
  info: ModArenaInfo;
  hd: ModHd | null;
}

export interface ModPilot {
  key: string;
  mod: string;
  pilotId: number;
  info: ModPilotInfo;
  portrait: PngImage | null;
  /** The pilot select grid's face (else made from the portrait). */
  face: PngImage | null;
  hd: ModHd | null;
}

/** What became of an installed mod when the game started. */
export interface ModState {
  id: string;
  /** Its content plays in this session. */
  loaded: boolean;
  /** Why it could not be loaded. */
  error: string | null;
}

const robots = new Map<number, ModRobot>();
const arenas = new Map<number, ModArena>();
const pilots = new Map<number, ModPilot>();
const states = new Map<string, ModState>();
/** The id of the mod OMF Studio is testing, when it is loaded. */
let testId: string | null = null;

/** BK file ids of the original arenas (code keyed by them gives an arena their behavior, see ModArenaInfo.base). */
const ORIGINAL_FILE_IDS = [8, 16, 32, 64, 128];
/** File ids of mod arenas without an original's behavior: past the remaster's own (256..2048). */
const MOD_FILE_ID = 0x10000;

export const modRobot = (harId: number): ModRobot | undefined => robots.get(harId);
export const modArena = (index: number): ModArena | undefined => arenas.get(index);
export const modPilot = (pilotId: number): ModPilot | undefined => pilots.get(pilotId);
/** The mod robots, arenas and pilots, in the order they were loaded (mods by name, then as each lists them). */
export const modRobots = (): ModRobot[] => [...robots.values()];
export const modArenas = (): ModArena[] => [...arenas.values()];
export const modPilots = (): ModPilot[] => [...pilots.values()];
export const modState = (id: string): ModState | undefined => states.get(id);

/** Registers a package's content (a mod's content that is already there is replaced). Throws ModError. */
export async function registerModPackage(pkg: ModPackage): Promise<void> {
  const m = pkg.manifest;
  unregisterMod(m.id);
  const portraits = await Promise.all(pkg.pilots.map((p) => (p.portrait ? decodePng(p.portrait) : Promise.resolve(null))));
  const faces = await Promise.all(pkg.pilots.map((p) => (p.face ? decodePng(p.face) : Promise.resolve(null))));
  // Numbers first, so a mod that does not fit adds nothing.
  const take = (kind: 'robot' | 'arena' | 'pilot', key: string, used: Map<number, unknown>, extra: Set<number>): number => {
    const id = modContentId(kind, key, new Set([...used.keys(), ...extra]));
    if (id === null) throw new ModError(`There is no room for more mod ${kind}s: turn another mod off.`);
    extra.add(id);
    return id;
  };
  const hars = new Set<number>(), idx = new Set<number>(), pids = new Set<number>();
  const harIds = pkg.robots.map((r) => take('robot', `${m.id}/${r.id}`, robots, hars));
  const arenaIds = pkg.arenas.map((a) => take('arena', `${m.id}/${a.id}`, arenas, idx));
  const pilotIds = pkg.pilots.map((p) => take('pilot', `${m.id}/${p.id}`, pilots, pids));

  pkg.robots.forEach((r, i) => {
    const harId = harIds[i];
    // The fighter file names its robot by number (the engine keys effects and the move list by it).
    const af = r.af.slice();
    af[0] = harId & 0xff;
    af[1] = harId >> 8;
    provideGenerated(harFileName(harId), af);
    forgetFighter(harId);
    HAR_NAMES[harId] = r.info.name;
    setHarName(harId, r.info.name);
    robots.set(harId, { key: `${m.id}/${r.id}`, mod: m.id, harId, info: r.info, hd: r.hd });
    if (r.info.workshop) registerGenRobot(workshopRobot(r.info.workshop, harId));
    pictured.delete(harId);
  });
  pkg.arenas.forEach((a, i) => {
    const index = arenaIds[i];
    const bk = a.bk.slice();
    const fileId = a.info.base >= 0 ? ORIGINAL_FILE_IDS[a.info.base] : MOD_FILE_ID + index;
    new DataView(bk.buffer).setUint32(0, fileId, true);
    provideGenerated(`ARENA${index}.BK`, bk);
    forgetBk(`ARENA${index}.BK`);
    // (an arena without a widescreen picture must not keep one an earlier registration of it had: a Studio test)
    if (a.wid) provideGenerated(`ARENA${index}.WID`, a.wid);
    else forgetGenerated(`ARENA${index}.WID`);
    arenas.set(index, { key: `${m.id}/${a.id}`, mod: m.id, index, info: a.info, hd: a.hd });
  });
  pkg.pilots.forEach((p, i) => {
    const pilotId = pilotIds[i];
    pilots.set(pilotId, { key: `${m.id}/${p.id}`, mod: m.id, pilotId, info: p.info, portrait: portraits[i], face: faces[i], hd: p.hd });
  });
  states.set(m.id, { id: m.id, loaded: true, error: null });
}

/** Forgets a mod's content (its files stay provided: a new registration replaces them). */
function unregisterMod(id: string): void {
  for (const [k, v] of robots) if (v.mod === id && v.info.workshop) unregisterGenRobot(k);
  for (const map of [robots, arenas, pilots] as Map<number, { mod: string }>[]) {
    for (const [k, v] of map) if (v.mod === id) map.delete(k);
  }
}

const pictured = new Map<number, Set<string>>();

/** A mod robot's pictures of its mechlab turning robot (by their frames' fingerprints), if its package has them. */
export function modMech(harId: number): ModHdFrame[] {
  return robots.get(harId)?.hd?.info.mech ?? [];
}

/** The fingerprints of a mod robot's sprites its package has HD pictures for (the game renders no others for them). */
export function modPictured(harId: number): Set<string> {
  let set = pictured.get(harId);
  if (!set) {
    set = new Set((robots.get(harId)?.hd?.info.sprites ?? []).map((e) => e.hash).filter((h): h is string => !!h));
    pictured.set(harId, set);
  }
  return set;
}

/** Reads and registers a mod that comes with the game; its state tells how it went. */
async function loadBundledMod(b: BundledMod): Promise<void> {
  try {
    await registerModPackage(await readModPackage(await fetchBundled(b), APP_VERSION));
  } catch (err) {
    unregisterMod(b.id);
    states.set(b.id, { id: b.id, loaded: false, error: err instanceof ModError ? err.message : `It could not be loaded (${(err as Error)?.message ?? err}).` });
    console.error(`[mods] ${b.id}:`, err);
  }
}

/**
 * Loads a mod that comes with the game now, if it is on and not loaded (the first start's setup turns the new robots
 * and arenas on before the game begins).
 */
export async function loadBundled(id: string): Promise<void> {
  if (modState(id)?.loaded || !bundledEnabled(id)) return;
  if ((await listMods()).some((m) => m.id === id)) return;
  const b = (await bundledMods()).find((x) => x.id === id);
  if (b) await loadBundledMod(b);
}

/**
 * Loads the installed mods that are on (at start-up), and with `test` the package OMF Studio is testing (over an
 * installed mod with its id) and the mods that come with the game it names (`bundled`: OMF Studio's test in one of the
 * new arenas, say, even with their mod off; the setting stays as it is). Never throws: a mod that fails is left out
 * with its reason (the test package's is returned).
 */
export async function loadMods(test = false, bundled: string[] = []): Promise<string | null> {
  const installed = await listMods();
  setInstalledMods(installed.map((m) => m.id));
  migrateNewContent();
  // The mods that come with the game, first (their robots and arenas right after the game's own), unless the player
  // installed a version of their own.
  for (const b of await bundledMods()) {
    if (installed.some((m) => m.id === b.id)) continue;
    states.set(b.id, { id: b.id, loaded: false, error: null });
    if (bundledEnabled(b.id) || (test && bundled.includes(b.id))) await loadBundledMod(b);
  }
  for (const rec of installed) {
    const state: ModState = { id: rec.id, loaded: false, error: null };
    states.set(rec.id, state);
    if (!rec.enabled) continue;
    try {
      await registerModPackage(await readModPackage(rec.bytes, APP_VERSION));
    } catch (err) {
      unregisterMod(rec.id);
      states.set(rec.id, { id: rec.id, loaded: false, error: err instanceof ModError ? err.message : `It could not be loaded (${(err as Error)?.message ?? err}).` });
      console.error(`[mods] ${rec.id}:`, err);
    }
  }
  if (!test) return null;
  const bytes = await testMod();
  if (!bytes) return 'There is no mod to test.';
  try {
    const pkg = await readModPackage(bytes, APP_VERSION);
    await registerModPackage(pkg);
    testId = pkg.manifest.id;
    return null;
  } catch (err) {
    console.error('[mods] the tested mod:', err);
    return err instanceof ModError ? err.message : `It could not be loaded (${(err as Error)?.message ?? err}).`;
  }
}

/**
 * The number of a robot, arena or pilot of the mod being tested ("mod:<folder name>" in OMF Studio's test address),
 * or of the game's own ("3"); null when there is none.
 */
export function testContent(kind: 'robot' | 'arena' | 'pilot', ref: string | null): number | null {
  if (ref === null) return null;
  if (!ref.startsWith('mod:')) return Number.isInteger(Number(ref)) ? Number(ref) : null;
  const key = `${testId}/${ref.slice(4)}`;
  const list: { key: string }[] = kind === 'robot' ? modRobots() : kind === 'arena' ? modArenas() : modPilots();
  const found = list.find((x) => x.key === key);
  if (!found) return null;
  return kind === 'robot' ? (found as ModRobot).harId : kind === 'arena' ? (found as ModArena).index : (found as ModPilot).pilotId;
}

/** Forgets every mod, and the files it provided (tests). */
export function resetMods(): void {
  for (const [k, v] of robots) {
    if (v.info.workshop) unregisterGenRobot(k);
    forgetGenerated(harFileName(k));
    forgetFighter(k);
  }
  for (const k of arenas.keys()) {
    for (const f of [`ARENA${k}.BK`, `ARENA${k}.WID`]) forgetGenerated(f);
    forgetBk(`ARENA${k}.BK`);
  }
  pictured.clear();
  robots.clear();
  arenas.clear();
  pilots.clear();
  states.clear();
}
