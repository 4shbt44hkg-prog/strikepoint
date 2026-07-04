// Shared core types and tuning constants for Strikepoint.

export type Team = 0 | 1;
export type Phase = "lobby" | "loadout" | "live" | "roundend" | "matchend";
export type HitPart = "head" | "body";

export const MAX_HP = 100;
export const MAX_ARMOR = 100;
export const START_ARMOR = 50;  // everyone spawns with this much shield
export const ARMOR_ABSORB = 0.6;   // fraction of damage the shield eats
export const HEALTH_PICKUP = 40;
export const SHIELD_PICKUP = 75;
export const HEALTH_RESPAWN = 20;  // seconds
export const SHIELD_RESPAWN = 30;
export const PICKUP_RADIUS = 1.25;
export const ROUNDS_TO_WIN = 5;
export const ROUND_TIME = 90; // seconds of live combat per round
export const LOADOUT_TIME = 8; // seconds to pick weapons between rounds
export const ROUNDEND_TIME = 4;
export const MATCHEND_TIME = 10;
export const MAX_PLAYERS = 8;

// Player capsule / movement (client simulates, server trusts positions).
export const PLAYER_HEIGHT = 1.7;
export const EYE_HEIGHT = 1.55;
export const PLAYER_RADIUS = 0.42;
export const HEAD_RADIUS = 0.26;
export const WALK_SPEED = 5.2;
export const SPRINT_MULT = 1.45;
export const JUMP_VEL = 7.6;
export const GRAVITY = 21;
export const STEP_UP = 0.55;

export const TEAM_NAMES = ["Azure", "Ember"] as const;
export const TEAM_COLORS = ["#3aa0ff", "#ff8a3a"] as const;

/** Per-player snapshot broadcast ~20x/sec while in a match. */
export interface PlayerSnap {
  id: number;
  pos: [number, number, number];
  yaw: number;
  pitch: number;
  hp: number;
  armor: number;
  alive: boolean;
  wpn: string;
  moving: boolean;
  sprint: boolean;
}

/** Slow-changing player info, sent on roster changes and phase changes. */
export interface PlayerMeta {
  id: number;
  name: string;
  team: Team;
  kills: number;
  deaths: number;
  bot: boolean;
}
