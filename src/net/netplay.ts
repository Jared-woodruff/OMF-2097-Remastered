// A network game in the game: what a game can play (both must have the same), the host's rules, the players' network
// controllers, and the way back to the main menu when the game ends (see net/session.ts for the lockstep itself).
import { GamepadController } from '../controller/keyboard';
import type { Controller } from '../controller/controller';
import { NetController } from '../controller/net';
import { Pilot } from '../formats/pilot';
import { AiDifficulty, CtrlType, ORIGINAL_HAR_TYPES, SceneId } from '../game/constants';
import type { GameState } from '../game/gameState';
import { helpOverlayOpen } from '../game/gui/helpOverlay';
import { harData } from '../game/objects/har';
import { arenaList, extraHarIds, modPilotIds, pilotInfo, pilotNameOf } from '../game/roster';
import { settings } from '../game/settings';
import { toast } from '../platform/toast';
import { getFile } from '../resources/files';
import { getGenerated } from '../resources/generated';
import { harFileName } from '../resources/resources';
import type { NetContent, NetRules } from './protocol';
import type { NetEnd, NetSession } from './session';

/** The input delay of LAN games (ms): room for a frame's timing on both computers and the network's few milliseconds. */
export const LAN_DELAY_MS = 40;

/** FNV-1a over bytes, continuing from `h`. */
function fnv(h: number, bytes: Uint8Array): number {
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193);
  return h >>> 0;
}

/** A file's bytes as the engine loads them (a mod's or the workshop's first, then the original game's), or null. */
function fileBytes(name: string): Uint8Array | null {
  const generated = getGenerated(name);
  if (generated) return generated;
  try {
    return getFile(name);
  } catch {
    return null;
  }
}

/** What this game can play: the robots, arenas and pilots on, and a fingerprint of their files. */
export function netContent(): NetContent {
  const robots = [...Array.from({ length: ORIGINAL_HAR_TYPES }, (_, i) => i), ...extraHarIds()];
  const arenas = arenaList();
  const pilots = modPilotIds();
  let h = 0x811c9dc5;
  const text = (s: string) => (h = fnv(h, new TextEncoder().encode(s)));
  for (const r of robots) {
    text(`R${r}`);
    const b = fileBytes(harFileName(r));
    if (b) h = fnv(h, b);
  }
  for (const a of arenas) {
    text(`A${a}`);
    const b = fileBytes(`ARENA${a}.BK`);
    if (b) h = fnv(h, b);
  }
  // (a mod pilot's stats and colors play in the fights)
  for (const p of pilots) text(`P${p}${pilotNameOf(p)}${JSON.stringify(pilotInfo(p))}`);
  return { robots, arenas, pilots, files: h.toString(16).padStart(8, '0') };
}

/** The host's rules: its match settings and game speed. */
export function hostRules(gs: GameState): NetRules {
  const saved = gs.matchSettings;
  gs.matchSettingsReset();
  const match = { ...gs.matchSettings, sim: false };
  gs.matchSettings = saved;
  return { match, speed: settings().gameplay.speed, delayMs: LAN_DELAY_MS };
}

/** The local player's keyboard or gamepad: player 1's controls (OPTIONS > CONTROLS), whichever side they play. */
function localDevice(gs: GameState): Controller {
  const k = settings().keys;
  if (k.ctrlType1 === CtrlType.GAMEPAD && k.gamepad1 >= 0) return new GamepadController(gs, k.gamepad1);
  return gs.keyboardController(0, 0);
}

/** The fight's state as one number, compared between the two games now and then (both robots, the random generator). */
export function fightChecksum(gs: GameState): number {
  const f = new Float64Array(1);
  const w = new Uint32Array(f.buffer);
  let h = 0x811c9dc5;
  const int = (v: number) => (h = Math.imul(h ^ (v >>> 0), 0x01000193));
  const num = (v: number) => {
    f[0] = v;
    int(w[0]);
    int(w[1]);
  };
  int(gs.tick);
  int(gs.rand.seed);
  for (let i = 0; i < 2; i++) {
    const o = gs.findObject(gs.getPlayer(i).harObjId);
    if (!o) {
      int(0xffffffff);
      continue;
    }
    const har = harData(o);
    num(o.posX);
    num(o.posY);
    num(o.velX);
    num(o.velY);
    num(har.health);
    num(har.endurance);
    int(har.state);
    int(o.curAnimation?.id ?? -1);
    int(o.direction);
  }
  return h >>> 0;
}

export interface NetGameOptions {
  /** Hears when the game is over (after the game has gone back to the main menu). */
  onEnd?: (end: NetEnd) => void;
  /** The local player's controls (player 1's keyboard or gamepad when not given; the tests' scripted players). */
  device?: Controller;
}

/**
 * Starts a network game: both players get network controllers (the local one plays with player 1's controls), the
 * host's rules apply, and the robot select screen opens.
 */
export function startNetGame(gs: GameState, session: NetSession, opts: NetGameOptions = {}): void {
  gs.net = session;
  gs.paused = false;
  gs.hitPauseTicks = 0;
  gs.speedSlowdownTime = -1;
  gs.setSpeed(session.rules.speed + 5);
  gs.matchSettings = { ...session.rules.match, sim: false };
  gs.training = false;
  gs.modeRun = null;
  gs.credits = null;
  gs.modeLabel = 'LAN';
  const device = opts.device ?? localDevice(gs);
  for (let i = 0; i < 2; i++) {
    const p = gs.getPlayer(i);
    p.chr = null;
    p.pilot = new Pilot();
    p.spWins = 0;
    p.score.reset(true);
    p.score.resetWins();
    p.score.setDifficulty(AiDifficulty.CHAMPION);
    p.setCtrl(new NetController(gs, session, i, i === session.localPlayer ? device : null));
    p.selectable = true;
  }
  session.checksum = () => fightChecksum(gs);
  // (the local player stands still while a menu of their own is open: the pause menu, the help)
  session.suppressLocal = () => helpOverlayOpen() || (gs.sc as { menuVisible?: boolean }).menuVisible === true;
  session.onEnd = (end) => {
    netGameEnded(gs, session, end);
    opts.onEnd?.(end);
  };
  gs.setNext(SceneId.MELEE);
  if (session.ended) session.onEnd(session.ended);
}

/** The local player leaves the network game (the other player is told; both go back to the main menu). */
export function leaveNetGame(gs: GameState): void {
  gs.net?.leave();
}

/** The game is over: back to the main menu's MULTIPLAYER menu, saying why. */
function netGameEnded(gs: GameState, session: NetSession, end: NetEnd): void {
  if (gs.net !== session) return;
  gs.net = null;
  gs.paused = false;
  gs.menuReturn = 'multiplayer';
  // (now, even in the middle of a screen change: the next screen would be one of the network game's)
  if (gs.thisId !== SceneId.MENU || gs.nextId !== SceneId.MENU) {
    if (gs.nextWaitTicks > 0) gs.nextId = SceneId.MENU;
    else gs.setNext(SceneId.MENU);
  }
  if (end.kind !== 'left') toast(end.message, 6000);
}
