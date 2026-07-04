// First-person weapon models, built from boxes and attached to the camera.
// Also renders loadout-card thumbnails from the same models.

import * as THREE from "three";
import { WEAPONS } from "../shared/weapons";

const mat = (c: string, metal = 0.4) =>
  new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: metal });

const boxMesh = (w: number, h: number, d: number, m: THREE.Material): THREE.Mesh => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  return mesh;
};

/** Build a distinct low-poly gun for each weapon id. Muzzle tip at -Z. */
function buildGun(id: string): { group: THREE.Group; muzzle: THREE.Vector3 } {
  const g = new THREE.Group();
  const dark = mat("#2b2f36");
  const steel = mat("#4a525e", 0.7);
  const wood = mat("#6b4a30", 0.1);
  const accentByWpn: Record<string, string> = {
    raptor: "#c8a24a", hornet: "#4ac8b0", mauler: "#c85a4a", longshot: "#4a86c8",
    trident: "#9a4ac8", sidekick: "#c8c24a", judge: "#b0b6c0", wasp: "#c84a86",
  };
  const accent = mat(accentByWpn[id] ?? "#c8a24a");
  let muzzleZ = -0.5;

  const add = (m: THREE.Mesh, x: number, y: number, z: number) => {
    m.position.set(x, y, z);
    g.add(m);
  };

  switch (id) {
    case "mauler": { // shotgun: long twin tube + pump
      add(boxMesh(0.07, 0.09, 0.62, dark), 0, 0.02, -0.28);
      add(boxMesh(0.05, 0.05, 0.6, steel), 0, 0.09, -0.3);
      add(boxMesh(0.09, 0.09, 0.2, wood), 0, -0.02, -0.34); // pump
      add(boxMesh(0.08, 0.14, 0.24, wood), 0, -0.06, 0.12); // stock/grip
      add(boxMesh(0.06, 0.06, 0.06, accent), 0, 0.05, 0.02);
      muzzleZ = -0.6;
      break;
    }
    case "longshot": { // sniper: very long barrel + scope
      add(boxMesh(0.06, 0.08, 0.95, dark), 0, 0, -0.4);
      add(boxMesh(0.04, 0.04, 0.5, steel), 0, 0.02, -0.75);
      add(boxMesh(0.06, 0.07, 0.26, steel), 0, 0.11, -0.12); // scope tube
      add(boxMesh(0.08, 0.03, 0.03, accent), 0, 0.11, -0.26); // scope lens ring
      add(boxMesh(0.07, 0.16, 0.22, dark), 0, -0.08, 0.14);
      muzzleZ = -1.0;
      break;
    }
    case "hornet": { // SMG: stubby, big mag
      add(boxMesh(0.08, 0.1, 0.34, dark), 0, 0, -0.1);
      add(boxMesh(0.05, 0.05, 0.16, steel), 0, 0.01, -0.34);
      add(boxMesh(0.05, 0.2, 0.07, accent), 0, -0.14, -0.06); // mag
      add(boxMesh(0.07, 0.12, 0.08, dark), 0, -0.09, 0.1);
      muzzleZ = -0.42;
      break;
    }
    case "trident": { // burst rifle: angular, three vents
      add(boxMesh(0.07, 0.1, 0.55, dark), 0, 0, -0.2);
      add(boxMesh(0.09, 0.04, 0.14, accent), 0, 0.07, -0.36);
      add(boxMesh(0.05, 0.14, 0.06, steel), 0, -0.11, -0.04);
      add(boxMesh(0.07, 0.12, 0.16, dark), 0, -0.05, 0.16);
      muzzleZ = -0.5;
      break;
    }
    case "sidekick": { // pistol
      add(boxMesh(0.06, 0.08, 0.26, dark), 0, 0.02, -0.08);
      add(boxMesh(0.05, 0.14, 0.08, accent), 0, -0.08, 0.03);
      muzzleZ = -0.22;
      break;
    }
    case "judge": { // revolver: cylinder block + long barrel
      add(boxMesh(0.06, 0.07, 0.34, steel), 0, 0.03, -0.14);
      add(boxMesh(0.09, 0.1, 0.1, accent), 0, 0.01, 0.0); // cylinder
      add(boxMesh(0.05, 0.13, 0.07, wood), 0, -0.08, 0.08);
      muzzleZ = -0.32;
      break;
    }
    case "wasp": { // machine pistol
      add(boxMesh(0.06, 0.09, 0.24, dark), 0, 0.02, -0.06);
      add(boxMesh(0.04, 0.16, 0.06, accent), 0, -0.1, -0.02);
      add(boxMesh(0.04, 0.03, 0.1, steel), 0, 0.08, -0.1);
      muzzleZ = -0.2;
      break;
    }
    default: { // raptor AR
      add(boxMesh(0.07, 0.1, 0.5, dark), 0, 0, -0.16);
      add(boxMesh(0.045, 0.045, 0.28, steel), 0, 0.01, -0.5);
      add(boxMesh(0.05, 0.16, 0.07, accent), 0, -0.12, -0.02); // mag
      add(boxMesh(0.07, 0.12, 0.18, dark), 0, -0.04, 0.18);    // stock
      add(boxMesh(0.03, 0.05, 0.1, steel), 0, 0.09, -0.2);     // sight
      muzzleZ = -0.66;
      break;
    }
  }
  return { group: g, muzzle: new THREE.Vector3(0, 0.01, muzzleZ) };
}

/** Render each weapon model to a small image (data URL) for the loadout cards. */
export function generateWeaponThumbs(): Record<string, string> {
  const out: Record<string, string> = {};
  const canvas = document.createElement("canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  const W = 220, H = 110;
  renderer.setSize(W, H, false);
  renderer.setPixelRatio(1);
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight("#ffffff", 1.5));
  const key = new THREE.DirectionalLight("#fff8ec", 2.4);
  key.position.set(1.4, 2, 1.2);
  scene.add(key);
  const rim = new THREE.DirectionalLight("#9ecbff", 1.1);
  rim.position.set(-1.5, 0.6, -1);
  scene.add(rim);
  const cam = new THREE.PerspectiveCamera(26, W / H, 0.01, 20);

  for (const id of Object.keys(WEAPONS)) {
    const { group } = buildGun(id);
    const bb = new THREE.Box3().setFromObject(group);
    const center = bb.getCenter(new THREE.Vector3());
    const size = bb.getSize(new THREE.Vector3());
    group.position.sub(center);
    scene.add(group);
    const r = Math.max(size.x, size.y, size.z);
    cam.position.set(r * 1.05, r * 0.6, r * 1.35);
    cam.lookAt(0, 0, 0);
    renderer.render(scene, cam);
    out[id] = canvas.toDataURL("image/png");
    scene.remove(group);
  }
  renderer.dispose();
  return out;
}

export class ViewModel {
  root = new THREE.Group();
  private gun: THREE.Group | null = null;
  private muzzleLocal = new THREE.Vector3();
  private flash: THREE.Mesh;
  private flashT = 0;
  private kickT = 0;
  private bobPhase = 0;
  private raiseT = 0; // weapon swap raise animation

  constructor(camera: THREE.Camera) {
    this.root.position.set(0.26, -0.24, -0.45);
    camera.add(this.root);
    const flashMat = new THREE.MeshBasicMaterial({
      color: "#ffd27a", transparent: true, opacity: 0, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), flashMat);
    this.flash.rotation.z = Math.PI / 4;
  }

  setWeapon(id: string): void {
    if (this.gun) this.root.remove(this.gun);
    const { group, muzzle } = buildGun(id);
    this.gun = group;
    this.muzzleLocal = muzzle;
    this.flash.position.copy(muzzle);
    group.add(this.flash);
    this.root.add(group);
    this.raiseT = 0.25;
  }

  kick(amount: number): void {
    this.kickT = Math.min(1, this.kickT + amount);
    this.flashT = 0.05;
  }

  update(dt: number, moving: boolean, sprint: boolean, reloadFrac: number): void {
    this.bobPhase += dt * (sprint ? 13 : 8) * (moving ? 1 : 0);
    this.kickT = Math.max(0, this.kickT - dt * 8);
    this.raiseT = Math.max(0, this.raiseT - dt);
    this.flashT = Math.max(0, this.flashT - dt);

    const bobY = moving ? Math.abs(Math.sin(this.bobPhase)) * 0.014 : 0;
    const bobX = moving ? Math.sin(this.bobPhase * 0.5) * 0.01 : 0;
    const kickZ = this.kickT * 0.06;
    const raise = this.raiseT * 0.6;
    const reloadDip = reloadFrac > 0 ? Math.sin(Math.min(1, reloadFrac) * Math.PI) * 0.16 : 0;

    this.root.position.set(0.26 + bobX, -0.24 - bobY - raise - reloadDip, -0.45 + kickZ);
    this.root.rotation.x = this.kickT * 0.12 + (reloadDip + raise) * -0.8;
    this.root.rotation.z = sprint && moving ? 0.18 : 0;

    (this.flash.material as THREE.MeshBasicMaterial).opacity = this.flashT > 0 ? 0.9 : 0;
    if (this.flashT > 0) this.flash.rotation.z += dt * 30;
  }

  setVisible(v: boolean): void {
    this.root.visible = v;
  }
}
