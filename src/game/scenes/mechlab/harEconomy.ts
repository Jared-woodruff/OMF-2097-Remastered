// HAR prices, upgrade prices and tournament winnings (port of the reference mechlab/har_economy.c + .h).
import type { Pilot } from '../../../formats/pilot';
import { globalRandom } from '../../../util/random';

export const enum HarUpgrade {
  ARM_POWER,
  ARM_SPEED,
  LEG_POWER,
  LEG_SPEED,
  ARMOR,
  STUN_RES,
  N_UPGRADES,
}

// The original eleven robots, then the remaster's four (GLACIER heavy, TEMPEST fast, HELIX even, SPECTRE quick) and the
// workshop's eight (even), so tournaments can field them too.
const WORKSHOP = (v: number) => new Array<number>(8).fill(v);
export const MAX_ARM_SPEED = [6, 8, 4, 6, 9, 7, 8, 6, 9, 6, 7, 5, 9, 7, 8, ...WORKSHOP(7)];
export const MAX_LEG_SPEED = [8, 9, 5, 6, 8, 8, 7, 6, 7, 5, 6, 5, 9, 7, 8, ...WORKSHOP(7)];
export const MAX_ARM_POWER = [5, 5, 9, 8, 4, 6, 6, 5, 5, 6, 7, 9, 5, 7, 6, ...WORKSHOP(7)];
export const MAX_LEG_POWER = [6, 6, 8, 4, 5, 7, 5, 7, 6, 7, 7, 8, 6, 7, 6, ...WORKSHOP(7)];
export const MAX_STUN_RES = [8, 6, 8, 6, 7, 6, 6, 7, 7, 7, 6, 8, 6, 7, 6, ...WORKSHOP(7)];
export const MAX_ARMOR = [5, 7, 7, 8, 6, 8, 6, 9, 6, 6, 7, 9, 5, 7, 6, ...WORKSHOP(7)];

export const HAR_PRICES = [20000, 36000, 26000, 28000, 29000, 32000, 25000, 30000, 24000, 22000, 75000, 34000, 31000, 30000, 33000,
  ...WORKSHOP(30000)];
export const HAR_UPGRADE_PRICE = [380, 400, 350, 400, 500, 330, 420, 370, 450, 360, 700, 420, 390, 400, 410, ...WORKSHOP(400)];
export const UPGRADE_LEVEL_MULTIPLIER = [0, 1, 3, 7, 12, 18, 30, 50, 75, 120];

export const ARM_LEG_MULTIPLIER = 2;
export const STUN_RES_MULTIPLIER = 3;
export const ARMOR_MULTIPLIER = 5;

/**
 * upgrade_level_multiplier[level]. The reference reads one element past the table when a stat is at level 9
 * (e.g. the "next level" price of a maxed-out Electra arm speed); those values are never used, 0 is returned here.
 */
export function upgradeLevelMultiplier(level: number): number {
  return UPGRADE_LEVEL_MULTIPLIER[level] ?? 0;
}

/** har_upgrade_price[har] * upgrade_level_multiplier[level] * multiplier (int32 arithmetic). */
export function upgradeCost(harId: number, level: number, multiplier: number): number {
  return ((HAR_UPGRADE_PRICE[harId] ?? 0) * upgradeLevelMultiplier(level) * multiplier) | 0;
}

export function harCanUpgrade(pilot: Pilot, upgrade: HarUpgrade): boolean {
  switch (upgrade) {
    case HarUpgrade.ARM_POWER:
      return pilot.armPower < MAX_ARM_POWER[pilot.harId];
    case HarUpgrade.ARM_SPEED:
      return pilot.armSpeed < MAX_ARM_SPEED[pilot.harId];
    case HarUpgrade.LEG_POWER:
      return pilot.legPower < MAX_LEG_POWER[pilot.harId];
    case HarUpgrade.LEG_SPEED:
      return pilot.legSpeed < MAX_LEG_SPEED[pilot.harId];
    case HarUpgrade.ARMOR:
      return pilot.armor < MAX_ARMOR[pilot.harId];
    case HarUpgrade.STUN_RES:
      return pilot.stunResistance < MAX_STUN_RES[pilot.harId];
    default:
      throw new Error(`bad HAR upgrade ${upgrade}`);
  }
}

/** Buys a random affordable HAR (Nova excluded) for a tournament pilot whose HAR is "random" (255). */
export function purchaseRandomHar(pilot: Pilot): void {
  const possiblePurchases: number[] = [];
  for (let i = 0; i < 10; ++i) {
    if (pilot.money >= HAR_PRICES[i]) possiblePurchases.push(i);
  }
  if (possiblePurchases.length === 0) throw new Error('Pilot does not have enough money to purchase any HAR');
  pilot.harId = possiblePurchases[globalRandom.int(possiblePurchases.length)];
  pilot.money -= HAR_PRICES[pilot.harId];
}

/** Spends a tournament pilot's money on random affordable upgrades until nothing is affordable. */
export function purchaseRandomHarUpgrades(pilot: Pilot): void {
  let n: number;
  do {
    const possibleUpgrades: HarUpgrade[] = [];
    for (let u = HarUpgrade.ARM_POWER; u < HarUpgrade.N_UPGRADES; ++u) {
      if (harCanUpgrade(pilot, u) && pilot.money >= upgradePrice(pilot, u)) possibleUpgrades.push(u);
    }
    n = possibleUpgrades.length;
    if (n === 0) break;
    const chosenUpgrade = possibleUpgrades[globalRandom.int(n)];
    upgradeHar(pilot, chosenUpgrade);
  } while (n > 0);
}

export function upgradePrice(pilot: Pilot, upgrade: HarUpgrade): number {
  const harId = pilot.harId;
  switch (upgrade) {
    case HarUpgrade.ARM_POWER:
      return upgradeCost(harId, pilot.armPower + 1, ARM_LEG_MULTIPLIER);
    case HarUpgrade.ARM_SPEED:
      return upgradeCost(harId, pilot.armSpeed + 1, ARM_LEG_MULTIPLIER);
    case HarUpgrade.LEG_POWER:
      return upgradeCost(harId, pilot.legPower + 1, ARM_LEG_MULTIPLIER);
    case HarUpgrade.LEG_SPEED:
      return upgradeCost(harId, pilot.legSpeed + 1, ARM_LEG_MULTIPLIER);
    case HarUpgrade.ARMOR:
      return upgradeCost(harId, pilot.armor + 1, ARMOR_MULTIPLIER);
    case HarUpgrade.STUN_RES:
      return upgradeCost(harId, pilot.stunResistance + 1, STUN_RES_MULTIPLIER);
    default:
      throw new Error(`bad HAR upgrade ${upgrade}`);
  }
}

export function upgradeHar(pilot: Pilot, upgrade: HarUpgrade): void {
  const price = upgradePrice(pilot, upgrade);
  pilot.money -= price;
  switch (upgrade) {
    case HarUpgrade.ARM_POWER:
      pilot.armPower++;
      break;
    case HarUpgrade.ARM_SPEED:
      pilot.armSpeed++;
      break;
    case HarUpgrade.LEG_POWER:
      pilot.legPower++;
      break;
    case HarUpgrade.LEG_SPEED:
      pilot.legSpeed++;
      break;
    case HarUpgrade.ARMOR:
      pilot.armor++;
      break;
    case HarUpgrade.STUN_RES:
      pilot.stunResistance++;
      break;
    default:
      throw new Error(`bad HAR upgrade ${upgrade}`);
  }
}

function updateTotalValue(pilot: Pilot): void {
  const harId = pilot.harId;
  let value = HAR_PRICES[harId];
  for (let i = 1; i < pilot.armPower; i++) value += upgradeCost(harId, i, ARM_LEG_MULTIPLIER);
  for (let i = 1; i < pilot.armSpeed; i++) value += upgradeCost(harId, i, ARM_LEG_MULTIPLIER);
  for (let i = 1; i < pilot.legPower; i++) value += upgradeCost(harId, i, ARM_LEG_MULTIPLIER);
  for (let i = 1; i < pilot.legSpeed; i++) value += upgradeCost(harId, i, ARM_LEG_MULTIPLIER);
  for (let i = 1; i < pilot.armor; i++) value += upgradeCost(harId, i, ARMOR_MULTIPLIER);
  for (let i = 1; i < pilot.stunResistance; i++) value += upgradeCost(harId, i, STUN_RES_MULTIPLIER);
  pilot.totalValue = Math.trunc((value * 70) / 100) >>> 0; // uint32_t field
}

const RANK_ADDITIONS = [
  500, 200, 160, 120, 100, 90, 80, 70, 60, 55, 50, 45, 40, 35, 30, 25, 20,
  17, 15, 14, 13, 12, 11, 11, 10, 9, 8, 8, 7, 7, 6, 6, 5, 0,
];

const f32 = Math.fround;

function rankScale(rank: number): number {
  // (the reference asserts rank >= 1)
  rank = (rank - 1) >>> 0; // unsigned
  const a = f32(rank * 0.1 + 1.0);
  const b = f32(rank * 0.2 + 1.0);
  return f32(f32(b * a) * a);
}

function rankBonus(rank: number): number {
  rank = (rank - 1) >>> 0;
  if (rank < RANK_ADDITIONS.length) return RANK_ADDITIONS[rank];
  return 5.0;
}

/**
 * Prize money of a tournament win. Also refreshes both pilots' total_value. Float math mirrors the reference
 * (float variables, double literals).
 */
export function calculateWinnings(winner: Pilot, loser: Pilot, winningsMultiplier: number): number {
  updateTotalValue(winner);
  updateTotalValue(loser);

  // uint32 total_value minus ints, converted back to int
  const adjustedValue = (winner.totalValue - Math.trunc((HAR_PRICES[0] * 85) / 100) - 500) | 0;
  // (uint32 + int32) is unsigned arithmetic in C; (int)winnings
  const loserValue = f32(((loser.totalValue + loser.money) >>> 0) / 45.0 + (loser.winnings | 0));
  let winnings = f32(loserValue + f32(f32(adjustedValue) / rankScale(winner.rank)) / 30.0);

  winnings = f32(winnings + f32(f32(winner.trnRankMoney) * rankBonus(winner.rank)));
  winnings = f32(winnings * f32(0.7));
  winnings = f32(winnings * f32(winningsMultiplier));
  return winnings;
}

// ---------------------------------------------------------------------------------------------------------------
// The following are defined in the reference's mechlab/lab_menu_customize.c. They are kept here (deliberate
// structural deviation) so that the VS, arena and CHR code depend on this pure module and not on the mechlab GUI.

/** calculate_trade_value(): 85% of the value of the HAR and its upgrades (int * double, truncated on return). */
export function calculateTradeValue(pilot: Pilot): number {
  const harId = pilot.harId;
  let tradeValue = HAR_PRICES[harId] ?? 0;
  for (let i = 1; i < pilot.armPower; i++) tradeValue += upgradeCost(harId, i, ARM_LEG_MULTIPLIER);
  for (let i = 1; i < pilot.legPower; i++) tradeValue += upgradeCost(harId, i, ARM_LEG_MULTIPLIER);
  for (let i = 1; i < pilot.armSpeed; i++) tradeValue += upgradeCost(harId, i, ARM_LEG_MULTIPLIER);
  for (let i = 1; i < pilot.legSpeed; i++) tradeValue += upgradeCost(harId, i, ARM_LEG_MULTIPLIER);
  for (let i = 1; i < pilot.armor; i++) tradeValue += upgradeCost(harId, i, ARMOR_MULTIPLIER);
  for (let i = 1; i < pilot.stunResistance; i++) tradeValue += upgradeCost(harId, i, STUN_RES_MULTIPLIER);
  return Math.trunc(tradeValue * 0.85);
}

/** har_price() */
export function harPrice(harId: number): number {
  return HAR_PRICES[harId] ?? 0;
}

/** fight_stats.sold buffer size (fight_stats.h). */
export const SOLD_BUF_SIZE = 24;

/**
 * sell_highest_value_upgrade(): Plug sells the most valuable upgrade of a pilot in debt. Returns the "sold" text
 * (the reference writes it into fight_stats.sold and returns 1), or null when there is nothing to sell.
 * Quirk kept: the text names the level *above* the one that was sold (level + 1 is printed before decrementing).
 */
export function sellHighestValueUpgrade(pilot: Pilot): string | null {
  const harId = pilot.harId;
  const prices = [
    upgradeCost(harId, pilot.armPower, ARM_LEG_MULTIPLIER),
    upgradeCost(harId, pilot.armSpeed, ARM_LEG_MULTIPLIER),
    upgradeCost(harId, pilot.legPower, ARM_LEG_MULTIPLIER),
    upgradeCost(harId, pilot.legSpeed, ARM_LEG_MULTIPLIER),
    upgradeCost(harId, pilot.stunResistance, STUN_RES_MULTIPLIER),
    upgradeCost(harId, pilot.armor, ARMOR_MULTIPLIER),
  ];
  let maxIdx = -1;
  let maxPrice = 0;
  for (let i = 0; i < prices.length; ++i) {
    if (prices[i] > maxPrice) {
      maxPrice = prices[i];
      maxIdx = i;
    }
  }
  let sold: string;
  switch (maxIdx) {
    case 0:
      pilot.money += Math.trunc(prices[maxIdx] * 0.85);
      sold = `LEVEL ${pilot.armPower + 1} ARM POWER`;
      pilot.armPower--;
      break;
    case 1:
      pilot.money += Math.trunc(prices[maxIdx] * 0.85);
      sold = `LEVEL ${pilot.armSpeed + 1} ARM SPEED`;
      pilot.armSpeed--;
      break;
    case 2:
      pilot.money += Math.trunc(prices[maxIdx] * 0.85);
      sold = `LEVEL ${pilot.legPower + 1} LEG POWER`;
      pilot.legPower--;
      break;
    case 3:
      pilot.money += Math.trunc(prices[maxIdx] * 0.85);
      sold = `LEVEL ${pilot.legSpeed + 1} LEG SPEED`;
      pilot.legSpeed--;
      break;
    case 4:
      pilot.money += Math.trunc(prices[maxIdx] * 0.85);
      sold = `LEVEL ${pilot.stunResistance + 1} STUN RES.`;
      pilot.stunResistance--;
      break;
    case 5:
      pilot.money += Math.trunc(prices[maxIdx] * 0.85);
      sold = `LEVEL ${pilot.armor + 1} ARMOR PLATE`;
      pilot.armor--;
      break;
    default:
      return null;
  }
  return sold.slice(0, SOLD_BUF_SIZE - 1); // snprintf(sold, SOLD_BUF_SIZE, ...)
}
