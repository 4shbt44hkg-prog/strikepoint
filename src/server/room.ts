// One match room: lobby -> rounds of team elimination -> match end -> next map.
// The server owns phase/HP/score and simulates bots; human positions are
// client-reported (trusted, friends-only game) with server-side sanity checks
// on damage (rate limits, real distances, team rules).

import type { WebSocket } from "ws";
import type { C2S, S2C } from "../shared/protocol";
import {
  ARMOR_ABSORB, EYE_HEIGHT, HEALTH_PICKUP, HEALTH_RESPAWN, LOADOUT_TIME,
  MATCHEND_TIME, MAX_ARMOR, MAX_HP, MAX_PLAYERS, PICKUP_RADIUS, ROUNDEND_TIME,
  ROUNDS_TO_WIN, ROUND_TIME, SHIELD_PICKUP, SHIELD_RESPAWN, SPRINT_MULT, START_ARMOR, WALK_SPEED,
  type HitPart, type Phase, type PlayerMeta, type PlayerSnap, type Team,
} from "../shared/types";
import { WEAPONS, PRIMARIES, SECONDARIES, damageAt, fireInterval } from "../shared/weapons";
import { MAPS, MAP_ROTATION, type MapDef, type PickupDef } from "../shared/maps";
import { collideMove, groundHeight, hasLOS, mapAABBs, type AABB } from "../shared/collide";

const BOT_NAMES = ["Rex", "Ivy", "Juno", "Blitz", "Nova", "Tank", "Echo", "Zip"];

interface SPlayer {
  id: number;
  ws: WebSocket | null; // null = bot
  name: string;
  team: Team;
  bot: boolean;
  pos: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  hp: number;
  armor: number;
  alive: boolean;
  wpn: string;
  moving: boolean;
  sprint: boolean;
  kills: number;
  deaths: number;
  primary: string;
  secondary: string;
  fireBudget: number; // token bucket for hit-rate validation
  // Bot brain
  botCd: number;        // seconds until next shot
  botAmmo: number;
  botReload: number;    // seconds left reloading
  botStrafe: number;    // -1 | 0 | 1
  botStrafeT: number;   // time until strafe change
  botAcc: number;       // base accuracy 0..1
}

interface SPickup {
  id: number;
  def: PickupDef;
  active: boolean;
  timer: number; // seconds until respawn while inactive
}

export class Room {
  code: string;
  private nextId = 1;
  private players = new Map<number, SPlayer>();
  private byWs = new Map<WebSocket, SPlayer>();
  private phase: Phase = "lobby";
  private timer = 0;
  private round = 0;
  private score: [number, number] = [0, 0];
  private mapIdx = 0;
  private map: MapDef;
  private aabbs: AABB[];
  private pickups: SPickup[] = [];

  constructor(code: string) {
    this.code = code;
    this.map = MAPS[MAP_ROTATION[0]];
    this.aabbs = mapAABBs(this.map);
    this.buildPickups();
  }

  private buildPickups(): void {
    this.pickups = this.map.pickups.map((def, i) => ({ id: i, def, active: true, timer: 0 }));
  }

  humanCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (!p.bot) n++;
    return n;
  }

  // ── Join / leave ────────────────────────────────────────────

  addHuman(ws: WebSocket, name: string): void {
    const p = this.makePlayer(name?.slice(0, 16) || "Player", false);
    p.ws = ws;
    this.byWs.set(ws, p);
    this.send(p, { t: "joined", room: this.code, id: p.id, map: this.map.id });
    this.sendRoster();
    this.send(p, this.phaseMsg());
    console.log(`[room ${this.code}] ${p.name} joined team ${p.team} (${this.players.size} total)`);
  }

  removeHuman(ws: WebSocket): void {
    const p = this.byWs.get(ws);
    if (!p) return;
    this.byWs.delete(ws);
    this.players.delete(p.id);
    console.log(`[room ${this.code}] ${p.name} left`);
    if (this.humanCount() === 0) return;
    this.sendRoster();
    if (this.phase === "live") this.checkRoundEnd();
  }

  private makePlayer(name: string, bot: boolean): SPlayer {
    // Join the smaller team.
    const counts: [number, number] = [0, 0];
    for (const q of this.players.values()) counts[q.team]++;
    const team: Team = counts[0] <= counts[1] ? 0 : 1;
    const p: SPlayer = {
      id: this.nextId++, ws: null, name, team, bot,
      pos: { x: 0, y: 0, z: team === 0 ? -this.map.size + 2 : this.map.size - 2 },
      yaw: 0, pitch: 0, hp: MAX_HP, armor: 0,
      alive: false, // deploys at next round start
      wpn: "raptor", moving: false, sprint: false,
      kills: 0, deaths: 0,
      primary: "raptor", secondary: "sidekick",
      fireBudget: 3,
      botCd: 0, botAmmo: 30, botReload: 0, botStrafe: 1, botStrafeT: 1,
      botAcc: 0.55 + Math.random() * 0.2,
    };
    this.players.set(p.id, p);
    return p;
  }

  private addBot(): void {
    if (this.players.size >= MAX_PLAYERS) return;
    const used = new Set([...this.players.values()].map((p) => p.name));
    const base = BOT_NAMES.find((n) => !used.has(`Bot ${n}`)) ?? `X${this.nextId}`;
    const p = this.makePlayer(`Bot ${base}`, true);
    this.botPickLoadout(p);
    if (this.phase === "loadout" || this.phase === "live") this.spawnPlayer(p);
    this.sendRoster();
  }

  private botPickLoadout(p: SPlayer): void {
    p.primary = PRIMARIES[Math.floor(Math.random() * PRIMARIES.length)].id;
    p.secondary = SECONDARIES[Math.floor(Math.random() * SECONDARIES.length)].id;
    p.wpn = p.primary;
    p.botAmmo = WEAPONS[p.wpn].mag;
  }

  private hostId(): number {
    let min = Infinity;
    for (const p of this.players.values()) if (!p.bot && p.id < min) min = p.id;
    return min === Infinity ? -1 : min;
  }

  // ── Message handling ────────────────────────────────────────

  handle(ws: WebSocket, msg: C2S): void {
    const p = this.byWs.get(ws);
    if (!p) return;
    switch (msg.t) {
      case "addbot":
        if (this.phase === "lobby" && p.id === this.hostId()) this.addBot();
        break;
      case "start":
        if (this.phase === "lobby" && p.id === this.hostId()) this.startMatch();
        break;
      case "loadout": {
        if (WEAPONS[msg.primary]?.slot === "primary") p.primary = msg.primary;
        if (WEAPONS[msg.secondary]?.slot === "secondary") p.secondary = msg.secondary;
        break;
      }
      case "input": {
        const s = this.map.size + 2;
        p.pos.x = Math.max(-s, Math.min(s, msg.pos[0]));
        p.pos.y = Math.max(0, Math.min(30, msg.pos[1]));
        p.pos.z = Math.max(-s, Math.min(s, msg.pos[2]));
        p.yaw = msg.yaw;
        p.pitch = msg.pitch;
        p.moving = msg.moving;
        p.sprint = msg.sprint;
        if (msg.wpn === p.primary || msg.wpn === p.secondary) p.wpn = msg.wpn;
        break;
      }
      case "fire":
        // Visual only — rebroadcast to everyone else for tracers/sound.
        if (p.alive && this.phase === "live") {
          this.broadcast({ t: "fireFx", id: p.id, wpn: msg.wpn, origin: msg.origin, dir: msg.dir }, p.id);
        }
        break;
      case "hit":
        this.handleHit(p, msg.target, msg.wpn, msg.part, msg.pellets);
        break;
    }
  }

  private handleHit(attacker: SPlayer, targetId: number, wpnId: string, part: HitPart, pellets: number): void {
    if (this.phase !== "live" || !attacker.alive) return;
    const target = this.players.get(targetId);
    const def = WEAPONS[wpnId];
    if (!target || !target.alive || !def || target.team === attacker.team) return;
    if (wpnId !== attacker.primary && wpnId !== attacker.secondary) return;
    // Rate limit: one token per bullet (pellets of one shotgun blast share a token).
    if (attacker.fireBudget < 1) return;
    attacker.fireBudget -= 1;
    const dx = target.pos.x - attacker.pos.x;
    const dy = target.pos.y - attacker.pos.y;
    const dz = target.pos.z - attacker.pos.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > def.range * 1.25 + 4) return;
    const n = Math.max(1, Math.min(pellets || 1, def.pellets));
    const dmg = Math.round(damageAt(def, dist) * n * (part === "head" ? def.headMult : 1));
    if (dmg <= 0) return;
    this.applyDamage(attacker, target, dmg, part, wpnId);
  }

  private applyDamage(from: SPlayer, target: SPlayer, dmg: number, part: HitPart, wpnId: string): void {
    // UT-style shield: armor eats a fraction of incoming damage until it breaks.
    const absorbed = Math.min(target.armor, Math.round(dmg * ARMOR_ABSORB));
    target.armor -= absorbed;
    target.hp = Math.max(0, target.hp - (dmg - absorbed));
    this.broadcast({ t: "dmg", target: target.id, from: from.id, hp: target.hp, amount: dmg, part });
    if (target.hp <= 0 && target.alive) {
      target.alive = false;
      target.deaths++;
      from.kills++;
      this.broadcast({ t: "kill", target: target.id, from: from.id, wpn: wpnId });
      this.sendRoster();
      this.checkRoundEnd();
    }
  }

  // ── Match flow ──────────────────────────────────────────────

  private startMatch(): void {
    // Make sure both teams have at least one combatant.
    const counts: [number, number] = [0, 0];
    for (const p of this.players.values()) counts[p.team]++;
    if (this.players.size < 2 || counts[0] === 0 || counts[1] === 0) this.addBot();
    this.score = [0, 0];
    this.round = 0;
    this.startRound();
  }

  private startRound(): void {
    this.round++;
    this.phase = "loadout";
    this.timer = LOADOUT_TIME;
    const idx: [number, number] = [0, 0];
    for (const p of this.players.values()) {
      if (p.bot) this.botPickLoadout(p);
      const spawns = this.map.spawns[p.team];
      const [x, z, yawDeg] = spawns[idx[p.team]++ % spawns.length];
      p.pos = { x, y: 0, z };
      p.yaw = (yawDeg * Math.PI) / 180;
      p.pitch = 0;
      p.hp = MAX_HP;
      p.armor = START_ARMOR;
      p.alive = true;
      p.fireBudget = 3;
      p.botCd = 0.5 + Math.random();
      p.botReload = 0;
      if (p.ws) this.send(p, { t: "spawn", pos: [x, 0, z], yaw: p.yaw });
    }
    for (const pk of this.pickups) { pk.active = true; pk.timer = 0; }
    this.broadcast(this.phaseMsg());
    this.sendRoster();
  }

  private checkRoundEnd(): void {
    if (this.phase !== "live") return;
    const alive: [number, number] = [0, 0];
    for (const p of this.players.values()) if (p.alive) alive[p.team]++;
    if (alive[0] > 0 && alive[1] > 0) return;
    const winner: Team | -1 = alive[0] > 0 ? 0 : alive[1] > 0 ? 1 : -1;
    this.endRound(winner);
  }

  private endRound(winner: Team | -1): void {
    if (winner !== -1) this.score[winner]++;
    this.phase = "roundend";
    this.timer = ROUNDEND_TIME;
    this.broadcast(this.phaseMsg(winner));
  }

  private phaseMsg(winner?: Team | -1): S2C {
    return {
      t: "phase", phase: this.phase, timer: this.timer, round: this.round,
      score: [...this.score] as [number, number], map: this.map.id,
      ...(winner !== undefined ? { winner } : {}),
    };
  }

  // ── Tick ────────────────────────────────────────────────────

  tick(dt: number): void {
    // Refill hit-rate tokens.
    for (const p of this.players.values()) {
      const def = WEAPONS[p.wpn];
      if (def) {
        const perSec = (def.rpm / 60) * (def.burst ?? 1) * 1.3 + 1;
        p.fireBudget = Math.min((def.burst ?? 1) * 1.5 + 2, p.fireBudget + perSec * dt);
      }
    }

    if (this.phase === "lobby") return;

    this.timer -= dt;
    if (this.phase === "loadout" && this.timer <= 0) {
      this.phase = "live";
      this.timer = ROUND_TIME;
      this.broadcast(this.phaseMsg());
    } else if (this.phase === "live" && this.timer <= 0) {
      // Time out: team with more players alive takes the round.
      const alive: [number, number] = [0, 0];
      for (const p of this.players.values()) if (p.alive) alive[p.team]++;
      this.endRound(alive[0] > alive[1] ? 0 : alive[1] > alive[0] ? 1 : -1);
    } else if (this.phase === "roundend" && this.timer <= 0) {
      if (this.score[0] >= ROUNDS_TO_WIN || this.score[1] >= ROUNDS_TO_WIN) {
        this.phase = "matchend";
        this.timer = MATCHEND_TIME;
        this.broadcast(this.phaseMsg(this.score[0] > this.score[1] ? 0 : 1));
      } else {
        this.startRound();
      }
    } else if (this.phase === "matchend" && this.timer <= 0) {
      // Next match on the next map, same party.
      this.mapIdx = (this.mapIdx + 1) % MAP_ROTATION.length;
      this.map = MAPS[MAP_ROTATION[this.mapIdx]];
      this.aabbs = mapAABBs(this.map);
      this.buildPickups();
      this.score = [0, 0];
      this.round = 0;
      for (const p of this.players.values()) { p.kills = 0; p.deaths = 0; }
      this.startRound();
    }

    if (this.phase === "live") {
      for (const p of this.players.values()) if (p.bot && p.alive) this.tickBot(p, dt);
      this.tickPickups(dt);
    }

    this.broadcastSnap();
  }

  // ── Pickups ─────────────────────────────────────────────────

  private tickPickups(dt: number): void {
    for (const pk of this.pickups) {
      if (!pk.active) {
        pk.timer -= dt;
        if (pk.timer <= 0) pk.active = true;
        continue;
      }
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        const dx = p.pos.x - pk.def.x;
        const dz = p.pos.z - pk.def.z;
        if (dx * dx + dz * dz > PICKUP_RADIUS * PICKUP_RADIUS) continue;
        if (Math.abs(p.pos.y - pk.def.y) > 1.7) continue;
        if (pk.def.kind === "health") {
          if (p.hp >= MAX_HP) continue; // full — leave it for someone who needs it
          p.hp = Math.min(MAX_HP, p.hp + HEALTH_PICKUP);
          pk.timer = HEALTH_RESPAWN;
        } else {
          if (p.armor >= MAX_ARMOR) continue;
          p.armor = Math.min(MAX_ARMOR, p.armor + SHIELD_PICKUP);
          pk.timer = SHIELD_RESPAWN;
        }
        pk.active = false;
        this.broadcast({ t: "pickup", id: pk.id, by: p.id, kind: pk.def.kind });
        break;
      }
    }
  }

  // ── Bot AI ──────────────────────────────────────────────────

  private tickBot(bot: SPlayer, dt: number): void {
    const def = WEAPONS[bot.wpn];
    // Find nearest living enemy, preferring visible ones.
    let target: SPlayer | null = null;
    let bestScore = Infinity;
    const eyeY = bot.pos.y + EYE_HEIGHT;
    for (const q of this.players.values()) {
      if (!q.alive || q.team === bot.team) continue;
      const d = Math.hypot(q.pos.x - bot.pos.x, q.pos.z - bot.pos.z);
      const visible = hasLOS(this.aabbs, bot.pos.x, eyeY, bot.pos.z, q.pos.x, q.pos.y + EYE_HEIGHT, q.pos.z);
      const score = d - (visible ? 40 : 0);
      if (score < bestScore) { bestScore = score; target = q; }
    }
    if (!target) return;

    const tdx = target.pos.x - bot.pos.x;
    const tdz = target.pos.z - bot.pos.z;
    const dist = Math.hypot(tdx, tdz);
    const desiredYaw = Math.atan2(-tdx, -tdz); // matches client convention: forward = (-sin yaw, -cos yaw)
    // Turn toward the target smoothly.
    let dyaw = desiredYaw - bot.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    bot.yaw += Math.max(-4 * dt, Math.min(4 * dt, dyaw));
    const dyTarget = target.pos.y + EYE_HEIGHT - eyeY;
    bot.pitch = Math.atan2(dyTarget, Math.max(1, dist)) * 0.9;

    // Movement: push until we can SEE the target, then hold preferred range.
    const visible = hasLOS(this.aabbs, bot.pos.x, eyeY, bot.pos.z,
      target.pos.x, target.pos.y + EYE_HEIGHT * 0.8, target.pos.z);
    const preferred = def.pellets > 1 || def.id === "wasp" || def.id === "hornet" ? 8 : def.zoom ? 24 : 14;
    bot.botStrafeT -= dt;
    if (bot.botStrafeT <= 0) {
      bot.botStrafe = ([-1, 0, 1] as const)[Math.floor(Math.random() * 3)];
      bot.botStrafeT = 0.7 + Math.random() * 1.3;
    }
    const fwdX = -Math.sin(bot.yaw), fwdZ = -Math.cos(bot.yaw);
    const rightX = Math.cos(bot.yaw), rightZ = -Math.sin(bot.yaw);
    let mx = 0, mz = 0;
    if (!visible && dist > 2) { mx += fwdX; mz += fwdZ; } // hunt for line of sight
    else if (dist > preferred + 2) { mx += fwdX; mz += fwdZ; }
    else if (dist < preferred * 0.55) { mx -= fwdX; mz -= fwdZ; }
    mx += rightX * bot.botStrafe * 0.8;
    mz += rightZ * bot.botStrafe * 0.8;
    const mlen = Math.hypot(mx, mz);
    bot.moving = mlen > 0.1;
    bot.sprint = dist > preferred + 8;
    if (mlen > 0.1) {
      const speed = WALK_SPEED * def.speedMult * (bot.sprint ? SPRINT_MULT : 1) * 0.85;
      collideMove(this.aabbs, bot.pos, (mx / mlen) * speed * dt, (mz / mlen) * speed * dt);
    }
    // Stick to the ground (bots don't jump).
    bot.pos.y = groundHeight(this.aabbs, bot.pos.x, bot.pos.y + 0.1, bot.pos.z, 0.42);

    // Shooting.
    if (bot.botReload > 0) {
      bot.botReload -= dt;
      if (bot.botReload <= 0) bot.botAmmo = def.mag;
      return;
    }
    bot.botCd -= dt;
    if (bot.botCd <= 0 && visible && dist <= def.range) {
      bot.botCd = fireInterval(def);
      bot.botAmmo -= 1;
      if (bot.botAmmo <= 0) bot.botReload = def.reload;
      const rangeFactor = Math.max(0.25, 1 - (dist / def.range) * 0.65);
      const moveFactor = target.sprint ? 0.8 : target.moving ? 0.9 : 1;
      const hitChance = bot.botAcc * rangeFactor * moveFactor;
      const hits = Math.random() < hitChance;
      // Tracer: aimed at the target, offset when it's a miss.
      const missX = hits ? 0 : (Math.random() - 0.5) * 1.6;
      const missY = hits ? 0 : (Math.random() - 0.5) * 1.2;
      let dirX = target.pos.x + missX - bot.pos.x;
      let dirY = target.pos.y + EYE_HEIGHT * 0.7 + missY - eyeY;
      let dirZ = target.pos.z + missX * 0.5 - bot.pos.z;
      const dl = Math.hypot(dirX, dirY, dirZ) || 1;
      this.broadcast({
        t: "fireFx", id: bot.id, wpn: bot.wpn,
        origin: [bot.pos.x, eyeY, bot.pos.z],
        dir: [dirX / dl, dirY / dl, dirZ / dl],
      });
      if (hits) {
        const part: HitPart = Math.random() < 0.14 ? "head" : "body";
        const pellets = def.pellets > 1 ? Math.max(1, Math.round(def.pellets * rangeFactor * 0.8)) : 1;
        const dmg = Math.round(damageAt(def, dist) * pellets * (part === "head" ? def.headMult : 1));
        if (dmg > 0) this.applyDamage(bot, target, dmg, part, bot.wpn);
      }
    }
  }

  // ── Broadcast helpers ───────────────────────────────────────

  private send(p: SPlayer, msg: S2C): void {
    if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(msg));
  }

  private broadcast(msg: S2C, exceptId?: number): void {
    const raw = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (p.ws && p.ws.readyState === 1 && p.id !== exceptId) p.ws.send(raw);
    }
  }

  private sendRoster(): void {
    const players: PlayerMeta[] = [...this.players.values()].map((p) => ({
      id: p.id, name: p.name, team: p.team, kills: p.kills, deaths: p.deaths, bot: p.bot,
    }));
    this.broadcast({ t: "roster", players, host: this.hostId() });
  }

  private broadcastSnap(): void {
    const players: PlayerSnap[] = [...this.players.values()].map((p) => ({
      id: p.id,
      pos: [Math.round(p.pos.x * 100) / 100, Math.round(p.pos.y * 100) / 100, Math.round(p.pos.z * 100) / 100],
      yaw: Math.round(p.yaw * 1000) / 1000,
      pitch: Math.round(p.pitch * 1000) / 1000,
      hp: p.hp, armor: p.armor, alive: p.alive, wpn: p.wpn, moving: p.moving, sprint: p.sprint,
    }));
    this.broadcast({
      t: "snap", players, timer: Math.max(0, Math.round(this.timer)),
      pickups: this.pickups.filter((pk) => pk.active).map((pk) => pk.id),
    });
  }

  private spawnPlayer(p: SPlayer): void {
    const spawns = this.map.spawns[p.team];
    const [x, z, yawDeg] = spawns[Math.floor(Math.random() * spawns.length)];
    p.pos = { x, y: 0, z };
    p.yaw = (yawDeg * Math.PI) / 180;
    p.hp = MAX_HP;
    p.armor = START_ARMOR;
    p.alive = true;
  }
}
