// Starting a network game: the guest says who it is and what its game can play; the host checks that both games are
// the same version with the same content and answers with the game's rules and random seed (or why it cannot start).
import { KnockDownMode } from '../game/constants';
import type { MatchSettings } from '../game/gameState';
import type { NetLink } from './link';
import { cleanName, NET_PROTOCOL, parseMessage, type NetContent, type NetMessage, type NetRules } from './protocol';

/** How long either side waits for the other's answer (ms). */
const ANSWER_MS = 10000;

/** Why two games' content cannot play together (null: it can). */
export function contentMismatch(host: NetContent, guest: NetContent): string | null {
  const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);
  const mods = 'Turn on the same mods in both games (EXTRAS > MODS).';
  if (!same(host.robots, guest.robots)) return `The two games have different robots. ${mods}`;
  if (!same(host.arenas, guest.arenas)) return `The two games have different arenas. ${mods}`;
  if (!same(host.pilots, guest.pilots)) return `The two games have different pilots. ${mods}`;
  if (host.files !== guest.files) return "The two games' robot or arena files differ (another version of the original game, or of a mod).";
  return null;
}

/** The host's match settings as the guest takes them: known fields only, each in its range. */
export function readMatchSettings(m: unknown): MatchSettings | null {
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  const num = (k: string, lo: number, hi: number) => {
    const v = o[k];
    return typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.trunc(v))) : null;
  };
  const bool = (k: string) => (typeof o[k] === 'boolean' ? (o[k] as boolean) : null);
  const s = {
    throwRange: num('throwRange', 0, 1000), hitPause: num('hitPause', 0, 100), blockDamage: num('blockDamage', 0, 100),
    vitality: num('vitality', 1, 1000), jumpHeight: num('jumpHeight', 0, 1000), knockDown: num('knockDown', KnockDownMode.NONE, KnockDownMode.BOTH),
    rehit: bool('rehit'), defensiveThrows: bool('defensiveThrows'), power1: num('power1', 1, 8), power2: num('power2', 1, 8),
    hazards: bool('hazards'), rounds: num('rounds', 0, 3), fightMode: num('fightMode', 0, 1),
  };
  if (Object.values(s).some((v) => v === null)) return null;
  return { ...(s as Omit<MatchSettings, 'sim'>), sim: false } as MatchSettings;
}

/** Waits for one message on a link (the link is detached afterwards: what follows waits for the game). */
function answer(link: NetLink, ms = ANSWER_MS): Promise<NetMessage> {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      link.detach();
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new Error('The other game did not answer.'))), ms);
    link.setHandlers(
      (text) => {
        const m = parseMessage(text);
        if (m) finish(() => resolve(m));
      },
      () => finish(() => reject(new Error('The other game closed the connection.'))),
    );
  });
}

export interface HostOffer {
  name: string;
  version: string;
  content: NetContent;
  rules: NetRules;
  seed: number;
}

/** The host's side: reads the guest's hello and starts the game, or turns it away. Resolves to the guest's name. */
export async function hostHandshake(link: NetLink, offer: HostOffer): Promise<string> {
  const m = await answer(link);
  if (m.t !== 'hello') throw new Error('The other game sent something unexpected.');
  let reason: string | null = null;
  if (m.proto !== NET_PROTOCOL || m.version !== offer.version) {
    reason = `The two games are different versions (${offer.version} and ${m.version}): update both to the same one.`;
  } else {
    reason = contentMismatch(offer.content, m.content);
  }
  if (reason) {
    link.send(JSON.stringify({ t: 'reject', reason } satisfies NetMessage));
    throw new Error(reason);
  }
  // (two players of the same name are told apart)
  let guest = cleanName(m.name) || 'PLAYER 2';
  if (guest === offer.name) guest = `${guest.slice(0, 10)} 2`;
  link.send(JSON.stringify({ t: 'welcome', name: offer.name, you: guest, rules: offer.rules, seed: offer.seed >>> 0 } satisfies NetMessage));
  return guest;
}

export interface GuestJoined {
  hostName: string;
  /** The guest's name in the game (the host's game may have told two of the same name apart). */
  name: string;
  rules: NetRules;
  seed: number;
}

/** The guest's side: says hello and waits for the game to start (rejects with the host's reason when it does not). */
export async function guestHandshake(link: NetLink, name: string, version: string, content: NetContent): Promise<GuestJoined> {
  const waiting = answer(link);
  link.send(JSON.stringify({ t: 'hello', proto: NET_PROTOCOL, version, name, content } satisfies NetMessage));
  const m = await waiting;
  if (m.t === 'reject') throw new Error(m.reason.slice(0, 200));
  if (m.t !== 'welcome') throw new Error('The other game sent something unexpected.');
  const match = readMatchSettings(m.rules.match);
  if (!match) throw new Error("The other game's rules could not be read.");
  return {
    hostName: cleanName(m.name) || 'PLAYER 1',
    name: cleanName(m.you) || cleanName(name) || 'PLAYER 2',
    rules: { match, speed: Math.max(0, Math.min(10, m.rules.speed)), delayMs: Math.max(0, Math.min(300, m.rules.delayMs)) },
    seed: m.seed >>> 0,
  };
}
