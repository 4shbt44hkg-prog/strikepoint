// The in-match game loop: local movement/physics, firing + auto-fire,
// remote player interpolation, phase handling, HUD updates.

import * as THREE from "three";
import { MAPS } from "../shared/maps";
import { mapAABBs, groundHeight, collideMove, raycastWorld, rayBox, raySphere, type AABB } from "../shared/collide";
import {
  EYE_HEIGHT, GRAVITY, JUMP_VEL, MAX_HP, SPRINT_MULT, TEAM_NAMES, WALK_SPEED,
  type HitPart, type Phase, type PlayerMeta, type Team,
} from "../shared/types";
import { WEAPONS, fireInterval, type WeaponDef } from "../shared/weapons";
import type { S2C } from "../shared/protocol";
import type { Net } from "./net";
import { Renderer } from "./render";
import { ViewModel } from "./viewmodel";
import { input, pollKeys, pointerLocked, requestLock, initInput, isTouch } from "./input";
import * as hud from "./hud";
import { settings } from "./settings";
import {
  playShot, playHit, playKill, playHurt, playDeath, playReload, playSwap,
  playRoundStart, playRoundEnd, playPickup, playLaunch,
} from "./sound";

interface Remote {
  target: { x: number; y: number; z: number; yaw: number; pitch: number };
  disp: { x: number; y: number; z: number; yaw: number; pitch: number };
  hp: number;
  alive: boolean;
  wpn: string;
  moving: boolean;
  sprint: boolean;
}

const BASE_FOV = 75;

export class Game {
  private net: Net;
  private myId: number;
  private roomCode: string;
  private mapId: string;
  private aabbs: AABB[];
  private renderer: Renderer;
  private vm: ViewModel;

  private phase: Phase = "lobby";
  private timer = 0;
  private round = 0;
  private score: [number, number] = [0, 0];
  private roster: PlayerMeta[] = [];
  private remotes = new Map<number, Remote>();

  // Local player
  private pos = { x: 0, y: 0, z: 0 };
  private vel = { x: 0, y: 0, z: 0 };
  private yaw = 0;
  private pitch = 0;
  private hp = MAX_HP;
  private armor = 0;
  private alive = false;
  private grounded = true;
  private padCooldown = 0;
  private sprinting = false;
  private sprintBlock = 0;

  // Weapons
  private slots = hud.getLoadout();
  private cur: "primary" | "secondary" = "primary";
  private ammo = { primary: 30, secondary: 12 };
  private reloadT = 0;
  private cooldown = 0;
  private burstLeft = 0;
  private burstTimer = 0;
  private swapT = 0;
  private zoomed = false;

  private sendAcc = 0;
  private lastTime = 0;
  private fov = BASE_FOV;

  constructor(canvas: HTMLCanvasElement, net: Net, myId: number, mapId: string, roomCode: string) {
    this.net = net;
    this.myId = myId;
    this.roomCode = roomCode;
    this.mapId = mapId;
    this.aabbs = mapAABBs(MAPS[mapId]);
    this.renderer = new Renderer(canvas);
    this.renderer.loadMap(mapId);
    this.vm = new ViewModel(this.renderer.camera);
    this.vm.setWeapon(this.slots.primary);

    hud.initHud({
      onLoadout: (primary, secondary) => {
        this.net.send({ t: "loadout", primary, secondary });
        this.slots = { primary, secondary };
        if (this.phase === "loadout") this.resetAmmo();
        this.vm.setWeapon(this.slots[this.cur]);
        requestLock(canvas);
      },
      onResume: () => requestLock(canvas),
    });

    initInput(canvas, (locked) => {
      if (isTouch) return;
      const loadoutOpen = this.phase === "loadout";
      hud.showPause(!locked && !loadoutOpen, this.roomCode);
    });
    canvas.addEventListener("click", () => {
      if (this.phase !== "loadout") requestLock(canvas);
    });

    net.on((msg) => this.onMsg(msg));
    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  private def(): WeaponDef {
    return WEAPONS[this.slots[this.cur]];
  }

  private resetAmmo(): void {
    this.ammo.primary = WEAPONS[this.slots.primary].mag;
    this.ammo.secondary = WEAPONS[this.slots.secondary].mag;
    this.reloadT = 0;
    this.cooldown = 0;
    this.burstLeft = 0;
  }

  private nameOf(id: number): string {
    return this.roster.find((p) => p.id === id)?.name ?? "???";
  }

  private teamOf(id: number): Team {
    return this.roster.find((p) => p.id === id)?.team ?? 0;
  }

  private myTeam(): Team {
    return this.teamOf(this.myId);
  }

  // ── Network messages ───────────────────────────────────────

  private onMsg(msg: S2C): void {
    switch (msg.t) {
      case "roster": {
        this.roster = msg.players;
        const ids = new Set(msg.players.map((p) => p.id));
        for (const p of msg.players) {
          if (p.id !== this.myId && !this.renderer.hasAvatar(p.id)) {
            this.renderer.ensureAvatar(p.id, p.team, p.name);
          }
        }
        for (const id of [...this.remotes.keys()]) {
          if (!ids.has(id)) {
            this.remotes.delete(id);
            this.renderer.removeAvatar(id);
          }
        }
        break;
      }
      case "snap": {
        this.timer = msg.timer;
        const active = new Set(msg.pickups);
        for (let i = 0; i < MAPS[this.mapId].pickups.length; i++) {
          this.renderer.setPickupActive(i, active.has(i));
        }
        for (const s of msg.players) {
          if (s.id === this.myId) {
            this.hp = s.hp;
            this.armor = s.armor;
            hud.trackHp(this.hp);
            hud.setArmor(this.armor);
            if (!s.alive && this.alive) this.alive = false;
            continue;
          }
          let r = this.remotes.get(s.id);
          if (!r) {
            r = {
              target: { x: s.pos[0], y: s.pos[1], z: s.pos[2], yaw: s.yaw, pitch: s.pitch },
              disp: { x: s.pos[0], y: s.pos[1], z: s.pos[2], yaw: s.yaw, pitch: s.pitch },
              hp: s.hp, alive: s.alive, wpn: s.wpn, moving: s.moving, sprint: s.sprint,
            };
            this.remotes.set(s.id, r);
          }
          r.target = { x: s.pos[0], y: s.pos[1], z: s.pos[2], yaw: s.yaw, pitch: s.pitch };
          r.hp = s.hp;
          r.alive = s.alive;
          r.wpn = s.wpn;
          r.moving = s.moving;
          r.sprint = s.sprint;
        }
        break;
      }
      case "phase": {
        const prevPhase = this.phase;
        this.phase = msg.phase;
        this.round = msg.round;
        this.score = msg.score;
        if (msg.map !== this.mapId) {
          this.mapId = msg.map;
          this.aabbs = mapAABBs(MAPS[msg.map]);
          this.renderer.loadMap(msg.map);
        }
        if (msg.phase === "loadout") {
          hud.showSpectate(false);
          hud.showLoadout(true);
          hud.showPause(false, this.roomCode);
          this.net.send({ t: "loadout", ...hud.getLoadout() });
          if (!isTouch) document.exitPointerLock?.();
        } else if (msg.phase === "live") {
          hud.showLoadout(false);
          if (prevPhase === "loadout") {
            playRoundStart();
            hud.banner("FIGHT!", -1, 1200);
          }
        } else if (msg.phase === "roundend" && msg.winner !== undefined) {
          if (msg.winner === -1) {
            hud.banner("ROUND DRAW", -1);
          } else {
            hud.banner(`${TEAM_NAMES[msg.winner].toUpperCase()} TAKES THE ROUND`, msg.winner);
            playRoundEnd(msg.winner === this.myTeam());
          }
        } else if (msg.phase === "matchend" && msg.winner !== undefined && msg.winner !== -1) {
          hud.banner(
            `${TEAM_NAMES[msg.winner].toUpperCase()} WINS THE MATCH!\nnext arena loading…`,
            msg.winner, 8000,
          );
          playRoundEnd(msg.winner === this.myTeam());
        }
        break;
      }
      case "spawn": {
        this.pos = { x: msg.pos[0], y: msg.pos[1], z: msg.pos[2] };
        this.vel = { x: 0, y: 0, z: 0 };
        this.yaw = msg.yaw;
        this.pitch = 0;
        this.alive = true;
        this.hp = MAX_HP;
        this.armor = 0;
        hud.trackHp(this.hp);
        hud.setArmor(0);
        hud.showSpectate(false);
        this.cur = "primary";
        this.slots = hud.getLoadout();
        this.resetAmmo();
        this.vm.setWeapon(this.slots.primary);
        break;
      }
      case "fireFx": {
        const dist = raycastWorld(this.aabbs, msg.origin[0], msg.origin[1], msg.origin[2],
          msg.dir[0], msg.dir[1], msg.dir[2], 120);
        this.renderer.remoteShot(msg.origin, msg.dir, dist);
        const d = Math.hypot(
          msg.origin[0] - this.pos.x, msg.origin[1] - (this.pos.y + EYE_HEIGHT), msg.origin[2] - this.pos.z);
        playShot(msg.wpn, Math.max(0, 1 - d / 70));
        break;
      }
      case "dmg": {
        if (msg.target === this.myId) {
          this.hp = msg.hp;
          hud.trackHp(this.hp);
          hud.damageFlash();
          playHurt();
        }
        if (msg.from === this.myId) {
          hud.hitmarker(msg.part === "head");
          playHit(msg.part === "head");
        }
        break;
      }
      case "kill": {
        hud.killfeed(this.nameOf(msg.from), this.teamOf(msg.from), msg.wpn, this.nameOf(msg.target), this.teamOf(msg.target));
        if (msg.target === this.myId) {
          this.alive = false;
          playDeath();
          hud.showSpectate(true, this.nameOf(msg.from));
        } else if (msg.from === this.myId) {
          playKill();
        }
        break;
      }
      case "pickup": {
        this.renderer.setPickupActive(msg.id, false);
        if (msg.by === this.myId) playPickup(msg.kind);
        break;
      }
      case "err":
        console.warn("[server]", msg.msg);
        break;
    }
  }

  // ── Frame loop ─────────────────────────────────────────────

  private frame(t: number): void {
    const dt = Math.min(0.05, (t - this.lastTime) / 1000);
    this.lastTime = t;
    this.update(dt);
    requestAnimationFrame((tt) => this.frame(tt));
  }

  private update(dt: number): void {
    pollKeys();
    const def = this.def();
    const canAct = this.phase === "live" && this.alive && (pointerLocked() || isTouch);

    // Look
    if (pointerLocked() || isTouch) {
      const sens = 0.0022 * settings.sens * (this.zoomed ? 0.45 : 1);
      this.yaw -= input.lookX * sens;
      this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - input.lookY * sens));
    }
    input.lookX = 0;
    input.lookY = 0;

    // Movement
    this.sprintBlock = Math.max(0, this.sprintBlock - dt);
    this.sprinting = canAct && input.sprint && input.moveZ > 0.1 && !this.zoomed && this.sprintBlock <= 0;
    if (canAct) {
      const speed = WALK_SPEED * def.speedMult * (this.sprinting ? SPRINT_MULT : 1);
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
      let wx = fx * input.moveZ + rx * input.moveX;
      let wz = fz * input.moveZ + rz * input.moveX;
      const wl = Math.hypot(wx, wz);
      if (wl > 1) { wx /= wl; wz /= wl; }
      const k = 1 - Math.exp(-(this.grounded ? 12 : 2.5) * dt);
      this.vel.x += (wx * speed - this.vel.x) * k;
      this.vel.z += (wz * speed - this.vel.z) * k;
      if (input.jump && this.grounded) {
        this.vel.y = JUMP_VEL;
        this.grounded = false;
      }
    } else {
      const k = 1 - Math.exp(-12 * dt);
      this.vel.x -= this.vel.x * k;
      this.vel.z -= this.vel.z * k;
    }
    input.jump = false;

    if (this.alive) {
      collideMove(this.aabbs, this.pos, this.vel.x * dt, this.vel.z * dt);
      this.vel.y -= GRAVITY * dt;
      this.pos.y += this.vel.y * dt;
      const g = groundHeight(this.aabbs, this.pos.x, this.pos.y + 0.1, this.pos.z, 0.42);
      if (this.pos.y <= g && this.vel.y <= 0) {
        this.pos.y = g;
        this.vel.y = 0;
        this.grounded = true;
      } else {
        this.grounded = false;
      }
      // Launch pads
      this.padCooldown = Math.max(0, this.padCooldown - dt);
      if (this.grounded && this.padCooldown <= 0 && this.phase === "live") {
        for (const pad of MAPS[this.mapId].pads) {
          const dx = this.pos.x - pad.x, dz = this.pos.z - pad.z;
          if (dx * dx + dz * dz < 1.3 * 1.3 && Math.abs(this.pos.y - pad.y) < 0.6) {
            this.vel.y = pad.boost;
            this.grounded = false;
            this.padCooldown = 0.5;
            playLaunch();
            this.renderer.impact(new THREE.Vector3(pad.x, pad.y + 0.3, pad.z), "#37e0ff");
          }
        }
      }
    }

    // Weapon housekeeping
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.swapT = Math.max(0, this.swapT - dt);
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        this.ammo[this.cur] = def.mag;
        this.reloadT = 0;
      }
    }
    if (input.swapTo) {
      const to = input.swapTo === "toggle" ? (this.cur === "primary" ? "secondary" : "primary") : input.swapTo;
      input.swapTo = null;
      if (to !== this.cur) {
        this.cur = to;
        this.swapT = 0.3;
        this.reloadT = 0;
        this.burstLeft = 0;
        this.vm.setWeapon(this.slots[this.cur]);
        playSwap();
      }
    }
    if (input.reload) {
      input.reload = false;
      if (canAct && this.reloadT <= 0 && this.ammo[this.cur] < def.mag) {
        this.reloadT = def.reload;
        playReload();
      }
    }

    // Zoom (sniper)
    this.zoomed = canAct && input.zoom && !!def.zoom && this.reloadT <= 0;
    const targetFov = (this.zoomed ? BASE_FOV / def.zoom! : BASE_FOV) + (this.sprinting ? 6 : 0);
    this.fov += (targetFov - this.fov) * Math.min(1, 12 * dt);
    this.renderer.setFov(this.fov);

    // Targeting + firing
    const onTarget = canAct ? this.crosshairOnEnemy(def) : false;
    hud.setOnTarget(onTarget);
    // continue an in-progress burst
    if (this.burstLeft > 0) {
      this.burstTimer -= dt;
      if (this.burstTimer <= 0 && this.ammo[this.cur] > 0) {
        this.fireOneShot(def);
        this.burstLeft--;
        this.burstTimer = def.burstDelay ?? 0.05;
      }
      if (this.ammo[this.cur] <= 0) this.burstLeft = 0;
    } else {
      const wantFire = canAct && (input.fire || (settings.autoFire && onTarget));
      const ready = this.cooldown <= 0 && this.swapT <= 0 && this.reloadT <= 0 && this.ammo[this.cur] > 0;
      if (wantFire && ready) {
        this.cooldown = fireInterval(def);
        this.sprintBlock = 0.25;
        if (def.burst) {
          this.fireOneShot(def);
          this.burstLeft = def.burst - 1;
          this.burstTimer = def.burstDelay ?? 0.05;
        } else {
          this.fireOneShot(def);
        }
      }
    }
    if (canAct && this.ammo[this.cur] <= 0 && this.reloadT <= 0 && this.burstLeft <= 0) {
      this.reloadT = def.reload;
      playReload();
    }

    // Send input to the server at 20 Hz
    this.sendAcc += dt;
    if (this.sendAcc >= 0.05) {
      this.sendAcc = 0;
      this.net.send({
        t: "input",
        pos: [this.pos.x, this.pos.y, this.pos.z],
        yaw: this.yaw,
        pitch: this.pitch,
        moving: Math.hypot(this.vel.x, this.vel.z) > 0.5,
        sprint: this.sprinting,
        wpn: this.slots[this.cur],
      });
    }

    // Remote interpolation + avatars
    const k = 1 - Math.exp(-14 * dt);
    for (const [id, r] of this.remotes) {
      r.disp.x += (r.target.x - r.disp.x) * k;
      r.disp.y += (r.target.y - r.disp.y) * k;
      r.disp.z += (r.target.z - r.disp.z) * k;
      let dy = r.target.yaw - r.disp.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      r.disp.yaw += dy * k;
      r.disp.pitch += (r.target.pitch - r.disp.pitch) * k;
      this.renderer.updateAvatar(id, r.disp, r.disp.yaw, r.disp.pitch, r.moving, r.sprint, r.alive, dt);
    }

    // Camera
    if (this.alive || this.phase === "loadout") {
      this.renderer.setFirstPerson(this.pos, this.yaw, this.pitch);
      this.vm.setVisible(true);
    } else {
      this.renderer.setSpectator(this.mapId);
      this.vm.setVisible(false);
    }

    // HUD
    const moving = Math.hypot(this.vel.x, this.vel.z) > 0.5;
    this.vm.update(dt, moving && this.grounded, this.sprinting, this.reloadT > 0 ? 1 - this.reloadT / def.reload : 0);
    hud.setAmmo(this.ammo[this.cur], this.reloadT > 0, this.slots[this.cur]);
    hud.setScore(this.score, this.round, this.timer);
    if (this.phase === "loadout") hud.setLoadoutTimer(this.timer);
    const aliveById = new Map<number, boolean>();
    for (const [id, r] of this.remotes) aliveById.set(id, r.alive);
    aliveById.set(this.myId, this.alive);
    hud.updateScoreboard(this.roster, aliveById, this.myId, input.scoreboard || this.phase === "matchend");

    this.renderer.update(dt);
    this.renderer.render();
  }

  // ── Firing ─────────────────────────────────────────────────

  /** Is the crosshair ray on a visible living enemy within weapon range? */
  private crosshairOnEnemy(def: WeaponDef): boolean {
    const dir = new THREE.Vector3();
    this.renderer.camera.getWorldDirection(dir);
    const hit = this.pickEnemy(dir.x, dir.y, dir.z, 1.35);
    return hit !== null && hit.dist <= def.range;
  }

  /**
   * Nearest living enemy hit by a ray from the eye, or null. `inflate` widens
   * hitboxes (used for auto-fire target acquisition, Rivals-style aim assist).
   */
  private pickEnemy(dx: number, dy: number, dz: number, inflate = 1): { id: number; dist: number; part: HitPart } | null {
    const ox = this.pos.x, oy = this.pos.y + EYE_HEIGHT, oz = this.pos.z;
    const myTeam = this.myTeam();
    let best: { id: number; dist: number; part: HitPart } | null = null;
    for (const [id, r] of this.remotes) {
      if (!r.alive || this.teamOf(id) === myTeam) continue;
      const p = r.disp;
      const headT = raySphere(ox, oy, oz, dx, dy, dz, p.x, p.y + 1.6, p.z, 0.3 * inflate);
      const half = 0.45 * inflate;
      const bodyT = rayBox(ox, oy, oz, dx, dy, dz, {
        minX: p.x - half, maxX: p.x + half,
        minY: p.y, maxY: p.y + 1.55,
        minZ: p.z - half, maxZ: p.z + half,
      });
      const t = Math.min(headT, bodyT);
      if (t === Infinity) continue;
      if (best && t >= best.dist) continue;
      const wall = raycastWorld(this.aabbs, ox, oy, oz, dx, dy, dz, t);
      if (wall < t - 0.02) continue; // blocked by geometry
      best = { id, dist: t, part: headT <= bodyT ? "head" : "body" };
    }
    return best;
  }

  private fireOneShot(def: WeaponDef): void {
    this.ammo[this.cur]--;
    const camDir = new THREE.Vector3();
    this.renderer.camera.getWorldDirection(camDir);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.renderer.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.renderer.camera.quaternion);
    const moving = Math.hypot(this.vel.x, this.vel.z) > 0.5;
    const spreadDeg = def.spread
      * (moving ? 1.35 : 1)
      * (this.grounded ? 1 : 1.6)
      * (this.zoomed ? 0.2 : 1);
    const eye = new THREE.Vector3(this.pos.x, this.pos.y + EYE_HEIGHT, this.pos.z);

    const perTarget = new Map<number, { pellets: number; head: number; dist: number }>();
    for (let i = 0; i < def.pellets; i++) {
      const gauss = () => (Math.random() + Math.random() + Math.random()) / 1.5 - 1;
      const rad = (spreadDeg * Math.PI) / 180;
      const dir = camDir.clone()
        .addScaledVector(right, Math.tan(rad) * gauss())
        .addScaledVector(up, Math.tan(rad) * gauss())
        .normalize();
      const enemy = this.pickEnemy(dir.x, dir.y, dir.z, 1);
      const wall = raycastWorld(this.aabbs, eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, def.range + 30);
      if (enemy && enemy.dist <= def.range && enemy.dist <= wall) {
        const rec = perTarget.get(enemy.id) ?? { pellets: 0, head: 0, dist: enemy.dist };
        rec.pellets++;
        if (enemy.part === "head") rec.head++;
        perTarget.set(enemy.id, rec);
        this.renderer.tracer(eye.clone().addScaledVector(dir, 0.8), eye.clone().addScaledVector(dir, enemy.dist), "#ff9a6a");
      } else {
        const end = eye.clone().addScaledVector(dir, wall);
        this.renderer.tracer(eye.clone().addScaledVector(dir, 0.8), end);
        if (wall < def.range + 29) this.renderer.impact(end, "#c8c8c8");
      }
    }

    this.net.send({
      t: "fire", wpn: def.id,
      origin: [eye.x, eye.y, eye.z],
      dir: [camDir.x, camDir.y, camDir.z],
    });
    for (const [id, rec] of perTarget) {
      this.net.send({
        t: "hit", target: id, wpn: def.id,
        part: rec.head > 0 ? "head" : "body",
        dist: rec.dist, pellets: rec.pellets,
      });
    }

    this.pitch = Math.min(1.55, this.pitch + def.kick * 0.008);
    this.vm.kick(def.kick * 0.35);
    playShot(def.id, 1);
  }
}
