// The workshop's robots while the game runs: their descriptions are kept in the browser's storage, and each is built
// into a fighter file (HAR 15 and up) when first needed, then registered like the generated robots (names, move list,
// remastered artwork).
import { buildWorkshopFighter, readSpec, WORKSHOP_FIRST_ID, WORKSHOP_SLOTS, workshopRobot, type WorkshopSpec } from '../../gen/workshop';
import { registerGenRobot, unregisterGenRobot } from '../../gen/roster';
import { provideGenerated } from '../../resources/generated';
import { forgetFighter, harFileName, setHarName } from '../../resources/resources';
import { HAR_NAMES } from '../constants';

const STORAGE_KEY = 'omf2097r.workshop';

/** Slot -> description (null: empty). */
let specs: (WorkshopSpec | null)[] | null = null;
/** What each slot's fighter file was built from (JSON), when built. */
const built = new Map<number, string>();

function load(): (WorkshopSpec | null)[] {
  if (!specs) {
    specs = new Array<WorkshopSpec | null>(WORKSHOP_SLOTS).fill(null);
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      const list = raw ? (JSON.parse(raw) as unknown[]) : [];
      list.slice(0, WORKSHOP_SLOTS).forEach((x, i) => (specs![i] = x ? readSpec(x) : null));
    } catch {
      // unreadable: no robots
    }
    specs.forEach((s, slot) => s && name(slot, s));
  }
  return specs;
}

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(load()));
  } catch {
    // storage unavailable: kept for this session
  }
}

export const harIdOf = (slot: number): number => WORKSHOP_FIRST_ID + slot;

export function isWorkshopHar(harId: number): boolean {
  return harId >= WORKSHOP_FIRST_ID && harId < WORKSHOP_FIRST_ID + WORKSHOP_SLOTS;
}

function name(slot: number, spec: WorkshopSpec): void {
  const id = harIdOf(slot);
  HAR_NAMES[id] = spec.name;
  setHarName(id, spec.name);
}

/** The slots' robots (null: empty). */
export function workshopSpecs(): readonly (WorkshopSpec | null)[] {
  return load();
}

/** Stores a robot in a slot (it is built again when next needed). */
export function setWorkshopSpec(slot: number, spec: WorkshopSpec | null): void {
  const list = load();
  list[slot] = spec;
  save();
  if (spec) name(slot, spec);
  else {
    unregisterGenRobot(harIdOf(slot));
    built.delete(slot);
  }
}

/** Builds a slot's robot if it is not built as it is now; returns false for an empty slot or a failure. */
export function ensureWorkshopRobot(slot: number): boolean {
  const spec = load()[slot];
  if (!spec) return false;
  const key = JSON.stringify(spec);
  if (built.get(slot) === key) return true;
  const id = harIdOf(slot);
  try {
    provideGenerated(harFileName(id), buildWorkshopFighter(spec, id));
    forgetFighter(id);
    registerGenRobot(workshopRobot(spec, id));
    name(slot, spec);
    built.set(slot, key);
    return true;
  } catch (err) {
    console.error(`[workshop] ${spec.name} could not be built:`, err);
    return false;
  }
}

/** Whether a HAR id is a workshop robot that is built and ready. */
export function workshopReady(harId: number): boolean {
  if (!isWorkshopHar(harId)) return false;
  const slot = harId - WORKSHOP_FIRST_ID;
  const spec = load()[slot];
  return !!spec && built.get(slot) === JSON.stringify(spec);
}

/** The built workshop robots' HAR ids. */
export function readyWorkshopHars(): number[] {
  return load().map((_, slot) => harIdOf(slot)).filter(workshopReady);
}

/** Builds every stored robot in the background, one at a time (so they are ready to pick). */
export function buildWorkshopInBackground(): void {
  const list = load();
  let slot = 0;
  const next = () => {
    while (slot < list.length && !list[slot]) slot++;
    if (slot >= list.length) return;
    ensureWorkshopRobot(slot++);
    setTimeout(next, 50);
  };
  setTimeout(next, 1500);
}

/** Forgets the stored robots (tests). */
export function resetWorkshop(): void {
  specs = null;
  built.clear();
}
