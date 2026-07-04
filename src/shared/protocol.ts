// Client <-> server message protocol (JSON over WebSocket at /ws).

import type { HitPart, Phase, PlayerMeta, PlayerSnap, Team } from "./types";

export type C2S =
  | { t: "join"; room?: string; name: string }
  | { t: "addbot" }
  | { t: "start" } // host only, from lobby
  | { t: "loadout"; primary: string; secondary: string }
  | {
      t: "input";
      pos: [number, number, number];
      yaw: number;
      pitch: number;
      moving: boolean;
      sprint: boolean;
      wpn: string;
    }
  | { t: "fire"; wpn: string; origin: [number, number, number]; dir: [number, number, number] }
  | { t: "hit"; target: number; wpn: string; part: HitPart; dist: number; pellets: number };

export type S2C =
  | { t: "joined"; room: string; id: number; map: string }
  | { t: "err"; msg: string }
  | { t: "roster"; players: PlayerMeta[]; host: number }
  | {
      t: "phase";
      phase: Phase;
      timer: number;
      round: number;
      score: [number, number];
      map: string;
      winner?: Team | -1; // round/match winner; -1 = draw
    }
  | { t: "spawn"; pos: [number, number, number]; yaw: number } // directed at one player
  | { t: "snap"; players: PlayerSnap[]; timer: number; pickups: number[] } // active pickup ids
  | { t: "pickup"; id: number; by: number; kind: "health" | "shield" }
  | { t: "fireFx"; id: number; wpn: string; origin: [number, number, number]; dir: [number, number, number] }
  | { t: "dmg"; target: number; from: number; hp: number; amount: number; part: HitPart }
  | { t: "kill"; target: number; from: number; wpn: string };
