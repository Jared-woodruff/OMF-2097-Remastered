// Network play (not in this port before; the reference has its own lobby and net controller): the messages two games
// send each other. They travel as JSON text over a link (net/link.ts) that keeps them in order, so nothing is lost and
// nothing needs resending: the LAN games' TCP connection (the desktop app, src-tauri/src/lan.rs), the development
// server's relay, or the tests' loopback.
import type { MatchSettings } from '../game/gameState';

/** Raised when the messages change: games speaking another version refuse each other. */
export const NET_PROTOCOL = 1;

/** The port LAN games are hosted on (TCP) and found on (UDP); the reference's network port. */
export const LAN_PORT = 2097;

/**
 * The rules of a network game, decided by the host and taken by the guest: the host's match settings (OPTIONS >
 * GAMEPLAY and its advanced page) and game speed, and the input delay.
 */
export interface NetRules {
  match: MatchSettings;
  /** OPTIONS > GAMEPLAY > SPEED (0..10; the game's speed is this plus 5). */
  speed: number;
  /** How far ahead each player's inputs are sent (ms): the lockstep's room for the network and the frame timing. */
  delayMs: number;
}

/** What a game can play: both games must have the same robots, arenas, pilots and game files. */
export interface NetContent {
  robots: number[];
  arenas: number[];
  pilots: number[];
  /** A fingerprint of the fighter and arena files (the original game's and the mods'). */
  files: string;
}

export type NetMessage =
  /** guest -> host, first: who is joining, and what its game can play. */
  | { t: 'hello'; proto: number; version: string; name: string; content: NetContent }
  /** host -> guest: the game starts, with these rules and the session's random seed; `you` is the guest's name in it. */
  | { t: 'welcome'; name: string; you: string; rules: NetRules; seed: number }
  /** host -> guest: the game cannot start (versions or content differ, the host is busy). */
  | { t: 'reject'; reason: string }
  /** The inputs of a player for step `s` of the phase `p` (a screen both games play in step: sc is its scene). */
  | { t: 'in'; p: number; s: number; sc: number; a: number[] }
  /** The fight's state at step `s` of phase `p` (desync detection). */
  | { t: 'sum'; p: number; s: number; h: number }
  | { t: 'ping'; n: number }
  | { t: 'pong'; n: number }
  /** Leaving the game. */
  | { t: 'bye'; reason: string };

/** Reads a message (anything else is dropped: the other end is another computer). */
export function parseMessage(text: string): NetMessage | null {
  let m: unknown;
  try {
    m = JSON.parse(text);
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  const int = (v: unknown) => typeof v === 'number' && Number.isInteger(v);
  const str = (v: unknown) => typeof v === 'string';
  switch (o.t) {
    case 'in':
      return int(o.p) && int(o.s) && int(o.sc) && Array.isArray(o.a) && o.a.length <= 16 && o.a.every(int) ? (o as NetMessage) : null;
    case 'sum':
      return int(o.p) && int(o.s) && int(o.h) ? (o as NetMessage) : null;
    case 'ping':
    case 'pong':
      return int(o.n) ? (o as NetMessage) : null;
    case 'bye':
    case 'reject':
      return str(o.reason) ? (o as NetMessage) : null;
    case 'hello': {
      const c = o.content as Record<string, unknown> | undefined;
      const ids = (v: unknown) => Array.isArray(v) && v.every(int);
      return int(o.proto) && str(o.version) && str(o.name) && !!c && ids(c.robots) && ids(c.arenas) && ids(c.pilots) && str(c.files)
        ? (o as NetMessage) : null;
    }
    case 'welcome': {
      const r = o.rules as Record<string, unknown> | undefined;
      return str(o.name) && str(o.you) && int(o.seed) && !!r && typeof r.match === 'object' && r.match !== null && int(r.speed) &&
        int(r.delayMs) ? (o as NetMessage) : null;
    }
  }
  return null;
}

/** A player's name as the game shows it: capitals, digits and a few marks, at most 12 characters. */
export function cleanName(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9 .\-!]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12);
}
