// Three.js world renderer: arena geometry, remote player avatars, tracers,
// muzzle flashes, and impact sparks. All art is generated in code.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { MAPS } from "../shared/maps";
import { EYE_HEIGHT, TEAM_COLORS, type Team } from "../shared/types";

/** Subtle grayscale grain texture — breaks up flat material colors. */
let noiseTex: THREE.CanvasTexture | null = null;
function getNoiseTex(): THREE.CanvasTexture {
  if (noiseTex) return noiseTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const img = g.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 218 + Math.random() * 37;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  noiseTex = new THREE.CanvasTexture(c);
  noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping;
  return noiseTex;
}

/** Vertical gradient texture for the sky dome. */
function skyTexture(top: THREE.Color, horizon: THREE.Color): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 2;
  c.height = 256;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, `#${top.getHexString()}`);
  grad.addColorStop(0.62, `#${horizon.getHexString()}`);
  grad.addColorStop(1, `#${horizon.clone().multiplyScalar(0.9).getHexString()}`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 2, 256);
  return new THREE.CanvasTexture(c);
}

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
  private pickupMeshes = new Map<number, { mesh: THREE.Group; baseY: number }>();
  private padMeshes: THREE.Mesh[] = [];
  private fxTime = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
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
    this.pickupMeshes.clear();
    this.padMeshes = [];
    this.scene.fog = new THREE.Fog(map.fog, 45, 180);
    this.renderer.setClearColor(map.sky);

    // Sky dome (gradient, unaffected by fog)
    const skyTop = new THREE.Color(map.sky).lerp(new THREE.Color("#ffffff"), 0.12);
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(260, 24, 12),
      new THREE.MeshBasicMaterial({
        map: skyTexture(skyTop, new THREE.Color(map.fog).lerp(new THREE.Color("#ffffff"), 0.08)),
        side: THREE.BackSide, fog: false, depthWrite: false,
      }),
    );
    this.mapGroup.add(dome);

    // Lights: bright hemisphere so shadow-side faces stay readable under
    // ACES tone mapping, sun with shadows, and a soft fill from the far side.
    const hemi = new THREE.HemisphereLight(
      new THREE.Color(map.sky).lerp(new THREE.Color("#ffffff"), 0.6),
      new THREE.Color(map.ground).lerp(new THREE.Color("#ffffff"), 0.3),
      1.6,
    );
    this.mapGroup.add(hemi);
    const fill = new THREE.DirectionalLight("#dfe8ff", 0.5);
    fill.position.set(-25, 30, -30);
    this.mapGroup.add(fill);
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
    const groundTex = getNoiseTex().clone();
    groundTex.needsUpdate = true;
    groundTex.repeat.set(10, 10);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(map.size * 2 + 8, map.size * 2 + 8),
      new THREE.MeshStandardMaterial({ color: map.ground, roughness: 0.95, map: groundTex }),
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

    // Boxes: rounded edges + grain so they read as objects, not voxels
    const boxTex = getNoiseTex();
    for (const b of map.boxes) {
      const bevel = Math.min(0.08, Math.min(b.w, b.h, b.d) * 0.18);
      const mesh = new THREE.Mesh(
        new RoundedBoxGeometry(b.w, b.h, b.d, 2, bevel),
        new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.82, map: boxTex }),
      );
      mesh.position.set(b.x, b.y, b.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.mapGroup.add(mesh);
    }

    // Launch pads: glowing rings that pulse
    for (const pad of map.pads) {
      const ring = new THREE.Mesh(
        new THREE.CylinderGeometry(1.25, 1.45, 0.14, 28),
        new THREE.MeshStandardMaterial({
          color: "#1a3c44", emissive: "#37e0ff", emissiveIntensity: 1.2, roughness: 0.4,
        }),
      );
      ring.position.set(pad.x, pad.y + 0.07, pad.z);
      this.mapGroup.add(ring);
      this.padMeshes.push(ring);
    }

    // Pickups
    for (let i = 0; i < map.pickups.length; i++) {
      const def = map.pickups[i];
      const g = new THREE.Group();
      if (def.kind === "health") {
        const body = new THREE.Mesh(
          new RoundedBoxGeometry(0.55, 0.55, 0.55, 2, 0.09),
          new THREE.MeshStandardMaterial({ color: "#f2f5f7", roughness: 0.5 }),
        );
        const crossMat = new THREE.MeshStandardMaterial({
          color: "#2ec96a", emissive: "#2ec96a", emissiveIntensity: 0.55, roughness: 0.5,
        });
        const barH = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.58), crossMat);
        const barV = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.4, 0.58), crossMat);
        g.add(body, barH, barV);
      } else {
        const shield = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.42),
          new THREE.MeshStandardMaterial({
            color: "#ffd24a", emissive: "#ffb62e", emissiveIntensity: 0.8,
            roughness: 0.25, metalness: 0.6,
          }),
        );
        g.add(shield);
      }
      const baseY = def.y + 0.75;
      g.position.set(def.x, baseY, def.z);
      this.mapGroup.add(g);
      this.pickupMeshes.set(i, { mesh: g, baseY });
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

  setPickupActive(id: number, active: boolean): void {
    const p = this.pickupMeshes.get(id);
    if (p) p.mesh.visible = active;
  }

  update(dt: number): void {
    this.fxTime += dt;
    for (const [, p] of this.pickupMeshes) {
      p.mesh.rotation.y += dt * 1.8;
      p.mesh.position.y = p.baseY + Math.sin(this.fxTime * 2.2) * 0.12;
    }
    for (const ring of this.padMeshes) {
      const m = ring.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = 0.9 + Math.sin(this.fxTime * 4) * 0.45;
    }
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
