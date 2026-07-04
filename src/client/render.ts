// Three.js world renderer: arena geometry, remote player avatars, tracers,
// muzzle flashes, and impact sparks. All art is generated in code.

import * as THREE from "three";
import { MAPS } from "../shared/maps";
import { EYE_HEIGHT, TEAM_COLORS, type Team } from "../shared/types";

interface Avatar {
  group: THREE.Group;
  torso: THREE.Group;   // pitches with aim
  legL: THREE.Mesh;
  legR: THREE.Mesh;
  gun: THREE.Mesh;
  name: THREE.Sprite;
  team: Team;
  walkPhase: number;
  deadT: number; // >0 while playing death fall
  alive: boolean;
}

interface Tracer {
  line: THREE.Line;
  life: number;
}

interface Spark {
  points: THREE.Points;
  vels: Float32Array;
  life: number;
}

function nameSprite(name: string, color: string): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.font = "bold 34px system-ui, sans-serif";
  g.textAlign = "center";
  g.lineWidth = 6;
  g.strokeStyle = "rgba(0,0,0,0.8)";
  g.strokeText(name, 128, 42);
  g.fillStyle = color;
  g.fillText(name, 128, 42);
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  spr.scale.set(1.8, 0.45, 1);
  return spr;
}

export class Renderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  private mapGroup = new THREE.Group();
  private avatars = new Map<number, Avatar>();
  private tracers: Tracer[] = [];
  private sparks: Spark[] = [];
  private currentMap = "";

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 400);
    this.camera.rotation.order = "YXZ";
    this.scene.add(this.camera);
    this.scene.add(this.mapGroup);
    this.resize();
    window.addEventListener("resize", () => this.resize());
    // Debug hook (used by automated smoke tests).
    (window as unknown as Record<string, unknown>).__sp = this;
  }

  /** Read back a pixel block after a forced render — smoke-test hook. */
  debugSample(): { nonBlack: number; total: number } {
    this.render();
    const gl = this.renderer.getContext();
    const w = 64, h = 64;
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(
      Math.floor(gl.drawingBufferWidth / 2 - w / 2),
      Math.floor(gl.drawingBufferHeight / 2 - h / 2),
      w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf,
    );
    let nonBlack = 0;
    for (let i = 0; i < buf.length; i += 4) {
      if (buf[i] + buf[i + 1] + buf[i + 2] > 24) nonBlack++;
    }
    return { nonBlack, total: w * h };
  }

  private resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  loadMap(mapId: string): void {
    if (this.currentMap === mapId) return;
    this.currentMap = mapId;
    const map = MAPS[mapId];
    this.mapGroup.clear();
    this.scene.fog = new THREE.Fog(map.fog, 40, 160);
    this.renderer.setClearColor(map.sky);

    // Lights
    const hemi = new THREE.HemisphereLight(map.sky, map.ground, 0.9);
    this.mapGroup.add(hemi);
    const sun = new THREE.DirectionalLight("#fff4e0", 1.6);
    sun.position.set(30, 50, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = map.size + 6;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.camera.far = 120;
    this.mapGroup.add(sun);

    // Ground: main slab + accent grid tiles for a sense of speed
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(map.size * 2 + 8, map.size * 2 + 8),
      new THREE.MeshStandardMaterial({ color: map.ground, roughness: 0.95 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.mapGroup.add(ground);
    const tileGeo = new THREE.PlaneGeometry(2.6, 2.6);
    const tileMat = new THREE.MeshStandardMaterial({ color: map.groundAccent, roughness: 0.95 });
    for (let x = -map.size + 2; x < map.size; x += 6) {
      for (let z = -map.size + 2; z < map.size; z += 6) {
        const t = new THREE.Mesh(tileGeo, tileMat);
        t.rotation.x = -Math.PI / 2;
        t.position.set(x + ((x * 7 + z * 13) % 3), 0.01, z + ((x * 3 + z * 5) % 3));
        t.receiveShadow = true;
        this.mapGroup.add(t);
      }
    }

    // Boxes
    for (const b of map.boxes) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(b.w, b.h, b.d),
        new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.85 }),
      );
      mesh.position.set(b.x, b.y, b.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.mapGroup.add(mesh);
    }

    // Distant backdrop blocks outside the walls for a skyline feel
    const rng = (i: number) => Math.abs(Math.sin(i * 127.1) * 43758.55) % 1;
    for (let i = 0; i < 26; i++) {
      const ang = (i / 26) * Math.PI * 2;
      const dist = map.size + 14 + rng(i) * 20;
      const h = 4 + rng(i + 40) * 16;
      const block = new THREE.Mesh(
        new THREE.BoxGeometry(4 + rng(i + 80) * 8, h, 4 + rng(i + 120) * 8),
        new THREE.MeshStandardMaterial({ color: map.groundAccent, roughness: 1 }),
      );
      block.position.set(Math.cos(ang) * dist, h / 2, Math.sin(ang) * dist);
      this.mapGroup.add(block);
    }
  }

  // ── Avatars ────────────────────────────────────────────────

  ensureAvatar(id: number, team: Team, name: string): void {
    if (this.avatars.has(id)) return;
    const color = TEAM_COLORS[team];
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
    const darkMat = new THREE.MeshStandardMaterial({ color: "#22262e", roughness: 0.6 });
    const skinMat = new THREE.MeshStandardMaterial({ color: "#d8b48c", roughness: 0.8 });

    const group = new THREE.Group();
    const torso = new THREE.Group();
    torso.position.y = 1.15;

    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.34), bodyMat);
    chest.position.y = 0.05;
    chest.castShadow = true;
    torso.add(chest);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), skinMat);
    head.position.y = 0.55;
    head.castShadow = true;
    torso.add(head);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.06), darkMat);
    visor.position.set(0, 0.58, -0.16);
    torso.add(visor);
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.16), bodyMat);
    armL.position.set(-0.42, -0.02, -0.1);
    armL.rotation.x = -0.9;
    torso.add(armL);
    const armR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.16), bodyMat);
    armR.position.set(0.42, -0.02, -0.1);
    armR.rotation.x = -0.9;
    torso.add(armR);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.7), darkMat);
    gun.position.set(0.22, -0.1, -0.42);
    torso.add(gun);

    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.85, 0.2), darkMat);
    legL.position.set(-0.16, 0.43, 0);
    legL.castShadow = true;
    const legR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.85, 0.2), darkMat);
    legR.position.set(0.16, 0.43, 0);
    legR.castShadow = true;

    const name3d = nameSprite(name, color);
    name3d.position.y = 2.15;

    group.add(torso, legL, legR, name3d);
    this.scene.add(group);
    this.avatars.set(id, {
      group, torso, legL, legR, gun, name: name3d, team,
      walkPhase: 0, deadT: 0, alive: true,
    });
  }

  removeAvatar(id: number): void {
    const a = this.avatars.get(id);
    if (a) {
      this.scene.remove(a.group);
      this.avatars.delete(id);
    }
  }

  updateAvatar(
    id: number,
    pos: { x: number; y: number; z: number },
    yaw: number, pitch: number,
    moving: boolean, sprint: boolean, alive: boolean,
    dt: number,
  ): void {
    const a = this.avatars.get(id);
    if (!a) return;
    a.group.position.set(pos.x, pos.y, pos.z);
    a.group.rotation.y = yaw;
    a.torso.rotation.x = -pitch * 0.6;

    if (alive && !a.alive) {
      // respawn
      a.alive = true;
      a.deadT = 0;
      a.group.rotation.x = 0;
      a.group.visible = true;
    } else if (!alive && a.alive) {
      a.alive = false;
      a.deadT = 0.001;
    }
    if (!a.alive) {
      a.deadT = Math.min(1, a.deadT + dt * 2.5);
      a.group.rotation.x = (-Math.PI / 2) * a.deadT; // topple backward
      a.group.visible = a.deadT < 1;
      return;
    }
    a.walkPhase += dt * (moving ? (sprint ? 14 : 9) : 0);
    const swing = moving ? Math.sin(a.walkPhase) * 0.55 : 0;
    a.legL.rotation.x = swing;
    a.legR.rotation.x = -swing;
  }

  hasAvatar(id: number): boolean {
    return this.avatars.has(id);
  }

  // ── Effects ────────────────────────────────────────────────

  tracer(from: THREE.Vector3, to: THREE.Vector3, color = "#ffd27a"): void {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 }),
    );
    this.scene.add(line);
    this.tracers.push({ line, life: 0.08 });
  }

  impact(at: THREE.Vector3, color = "#ffcf7a"): void {
    const n = 10;
    const posArr = new Float32Array(n * 3);
    const vels = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      posArr[i * 3] = at.x;
      posArr[i * 3 + 1] = at.y;
      posArr[i * 3 + 2] = at.z;
      vels[i * 3] = (Math.random() - 0.5) * 5;
      vels[i * 3 + 1] = Math.random() * 4;
      vels[i * 3 + 2] = (Math.random() - 0.5) * 5;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(posArr, 3));
    const points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color, size: 0.07, transparent: true, opacity: 1 }),
    );
    this.scene.add(points);
    this.sparks.push({ points, vels, life: 0.35 });
  }

  /** Third-person muzzle flash + tracer for a remote player's shot. */
  remoteShot(origin: [number, number, number], dir: [number, number, number], dist: number): void {
    const from = new THREE.Vector3(origin[0], origin[1], origin[2]);
    const d = new THREE.Vector3(dir[0], dir[1], dir[2]);
    const to = from.clone().addScaledVector(d, dist);
    this.tracer(from.clone().addScaledVector(d, 0.6), to);
    this.impact(to, "#c8c8c8");
  }

  update(dt: number): void {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      (t.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, t.life / 0.08) * 0.85;
      if (t.life <= 0) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        this.tracers.splice(i, 1);
      }
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      const attr = s.points.geometry.getAttribute("position") as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let j = 0; j < arr.length / 3; j++) {
        s.vels[j * 3 + 1] -= 12 * dt;
        arr[j * 3] += s.vels[j * 3] * dt;
        arr[j * 3 + 1] += s.vels[j * 3 + 1] * dt;
        arr[j * 3 + 2] += s.vels[j * 3 + 2] * dt;
      }
      attr.needsUpdate = true;
      (s.points.material as THREE.PointsMaterial).opacity = Math.max(0, s.life / 0.35);
      if (s.life <= 0) {
        this.scene.remove(s.points);
        s.points.geometry.dispose();
        this.sparks.splice(i, 1);
      }
    }
  }

  /** Position the camera for a living first-person player. */
  setFirstPerson(pos: { x: number; y: number; z: number }, yaw: number, pitch: number): void {
    this.camera.position.set(pos.x, pos.y + EYE_HEIGHT, pos.z);
    this.camera.rotation.y = yaw;
    this.camera.rotation.x = pitch;
    this.camera.rotation.z = 0;
  }

  /** Overhead spectator view of the whole arena. */
  setSpectator(mapId: string): void {
    const map = MAPS[mapId];
    this.camera.position.set(0, map.size * 1.6, map.size * 0.55);
    this.camera.rotation.set(-1.15, 0, 0);
  }

  setFov(fov: number): void {
    if (Math.abs(this.camera.fov - fov) > 0.1) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
