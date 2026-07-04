// Weapon roster. All numbers are shared so client (firing, HUD) and server
// (damage validation, bots) agree exactly.

export type WeaponSlot = "primary" | "secondary";

export interface WeaponDef {
  id: string;
  name: string;
  slot: WeaponSlot;
  desc: string;
  dmg: number;          // damage per bullet/pellet at close range
  headMult: number;     // headshot multiplier
  rpm: number;          // shots (or bursts) per minute
  mag: number;          // magazine size
  reload: number;       // seconds
  pellets: number;      // >1 = shotgun
  spread: number;       // base hip-fire spread in degrees (per pellet)
  range: number;        // max damage-dealing distance (m)
  falloffStart: number; // damage starts dropping past this distance
  falloffMin: number;   // fraction of dmg remaining at max range
  auto: boolean;        // holds fire vs. semi
  burst?: number;       // rounds per trigger pull (Trident)
  burstDelay?: number;  // seconds between rounds inside a burst
  speedMult: number;    // move-speed multiplier while held
  zoom?: number;        // right-click FOV divider (sniper)
  kick: number;         // camera recoil per shot, degrees
}

const W = (w: WeaponDef) => w;

export const WEAPONS: Record<string, WeaponDef> = {
  // ── Primaries ──────────────────────────────────────────────
  raptor: W({
    id: "raptor", name: "Raptor AR", slot: "primary",
    desc: "Reliable full-auto rifle. Good at every range.",
    dmg: 22, headMult: 1.5, rpm: 600, mag: 30, reload: 1.8,
    pellets: 1, spread: 1.1, range: 80, falloffStart: 35, falloffMin: 0.55,
    auto: true, speedMult: 0.95, kick: 0.55,
  }),
  hornet: W({
    id: "hornet", name: "Hornet SMG", slot: "primary",
    desc: "Shreds up close and you run faster with it.",
    dmg: 13, headMult: 1.5, rpm: 950, mag: 34, reload: 1.6,
    pellets: 1, spread: 2.3, range: 45, falloffStart: 16, falloffMin: 0.45,
    auto: true, speedMult: 1.06, kick: 0.4,
  }),
  mauler: W({
    id: "mauler", name: "Mauler Shotgun", slot: "primary",
    desc: "8 pellets of point-blank misery.",
    dmg: 11, headMult: 1.3, rpm: 78, mag: 6, reload: 2.6,
    pellets: 8, spread: 5.2, range: 28, falloffStart: 9, falloffMin: 0.3,
    auto: false, speedMult: 0.96, kick: 2.2,
  }),
  longshot: W({
    id: "longshot", name: "Longshot", slot: "primary",
    desc: "Bolt sniper. Two-tap body, one-tap head. Right-click to scope.",
    dmg: 85, headMult: 2.0, rpm: 42, mag: 5, reload: 2.8,
    pellets: 1, spread: 0.15, range: 250, falloffStart: 250, falloffMin: 1,
    auto: false, speedMult: 0.88, zoom: 3.2, kick: 3.0,
  }),
  trident: W({
    id: "trident", name: "Trident Burst", slot: "primary",
    desc: "3-round burst rifle. Deadly if you land all three.",
    dmg: 20, headMult: 1.6, rpm: 270, mag: 24, reload: 2.0,
    pellets: 1, spread: 0.7, range: 90, falloffStart: 45, falloffMin: 0.6,
    auto: false, burst: 3, burstDelay: 0.055, speedMult: 0.95, kick: 0.7,
  }),

  // ── Secondaries ────────────────────────────────────────────
  sidekick: W({
    id: "sidekick", name: "Sidekick", slot: "secondary",
    desc: "Dependable pistol. Fast swap, fast reload.",
    dmg: 20, headMult: 1.6, rpm: 320, mag: 12, reload: 1.3,
    pellets: 1, spread: 1.0, range: 55, falloffStart: 22, falloffMin: 0.5,
    auto: false, speedMult: 1.1, kick: 0.8,
  }),
  judge: W({
    id: "judge", name: "Judge Revolver", slot: "secondary",
    desc: "Hits like a truck, six times.",
    dmg: 52, headMult: 1.8, rpm: 130, mag: 6, reload: 2.2,
    pellets: 1, spread: 0.5, range: 75, falloffStart: 30, falloffMin: 0.6,
    auto: false, speedMult: 1.05, kick: 1.8,
  }),
  wasp: W({
    id: "wasp", name: "Wasp MP", slot: "secondary",
    desc: "Tiny full-auto buzzsaw for emergencies.",
    dmg: 10, headMult: 1.4, rpm: 1000, mag: 22, reload: 1.5,
    pellets: 1, spread: 3.0, range: 32, falloffStart: 12, falloffMin: 0.4,
    auto: true, speedMult: 1.1, kick: 0.35,
  }),
};

export const PRIMARIES = Object.values(WEAPONS).filter((w) => w.slot === "primary");
export const SECONDARIES = Object.values(WEAPONS).filter((w) => w.slot === "secondary");

/** Seconds between trigger pulls. */
export function fireInterval(def: WeaponDef): number {
  return 60 / def.rpm;
}

/** Damage for one bullet at a distance, before headshot multiplier. */
export function damageAt(def: WeaponDef, dist: number): number {
  if (dist <= def.falloffStart) return def.dmg;
  if (dist >= def.range) return 0;
  const t = (dist - def.falloffStart) / Math.max(0.001, def.range - def.falloffStart);
  return def.dmg * (1 - t * (1 - def.falloffMin));
}
