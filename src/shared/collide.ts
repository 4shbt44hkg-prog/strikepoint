// AABB collision + raycasting shared by client movement, client hit detection,
// and server bots / line-of-sight checks.

import type { BoxDef, MapDef } from "./maps";
import { PLAYER_HEIGHT, PLAYER_RADIUS, STEP_UP } from "./types";

export interface AABB {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

export function boxToAABB(b: BoxDef): AABB {
  return {
    minX: b.x - b.w / 2, maxX: b.x + b.w / 2,
    minY: b.y - b.h / 2, maxY: b.y + b.h / 2,
    minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2,
  };
}

export function mapAABBs(map: MapDef): AABB[] {
  return map.boxes.map(boxToAABB);
}

/** Does a player cylinder at (x, feetY, z) overlap this box horizontally + vertically? */
function overlaps(a: AABB, x: number, y: number, z: number, r: number): boolean {
  if (y + PLAYER_HEIGHT <= a.minY + 0.001 || y >= a.maxY - 0.001) return false;
  const cx = Math.max(a.minX, Math.min(x, a.maxX));
  const cz = Math.max(a.minZ, Math.min(z, a.maxZ));
  const dx = x - cx, dz = z - cz;
  return dx * dx + dz * dz < r * r;
}

/** Highest walkable surface under the player at (x,z) that is at or below y+STEP_UP. */
export function groundHeight(aabbs: AABB[], x: number, y: number, z: number, r: number): number {
  let g = 0;
  const rr = r * 0.7;
  for (const a of aabbs) {
    if (x + rr < a.minX || x - rr > a.maxX || z + rr < a.minZ || z - rr > a.maxZ) continue;
    if (a.maxY <= y + STEP_UP + 0.001 && a.maxY > g) g = a.maxY;
  }
  return g;
}

/**
 * Move a player cylinder, resolving collisions axis-by-axis with step-up.
 * Mutates and returns pos. `pos.y` is feet height.
 */
export function collideMove(
  aabbs: AABB[],
  pos: { x: number; y: number; z: number },
  dx: number,
  dz: number,
): void {
  const r = PLAYER_RADIUS;
  // X axis
  let nx = pos.x + dx;
  if (aabbs.some((a) => overlaps(a, nx, pos.y + 0.05, pos.z, r))) {
    // try stepping up (stairs / low crates)
    if (!aabbs.some((a) => overlaps(a, nx, pos.y + STEP_UP + 0.05, pos.z, r))) {
      pos.y = groundHeight(aabbs, nx, pos.y + STEP_UP, pos.z, r);
      pos.x = nx;
    }
  } else {
    pos.x = nx;
  }
  // Z axis
  let nz = pos.z + dz;
  if (aabbs.some((a) => overlaps(a, pos.x, pos.y + 0.05, nz, r))) {
    if (!aabbs.some((a) => overlaps(a, pos.x, pos.y + STEP_UP + 0.05, nz, r))) {
      pos.y = groundHeight(aabbs, pos.x, pos.y + STEP_UP, nz, r);
      pos.z = nz;
    }
  } else {
    pos.z = nz;
  }
}

/** Ray vs AABB (slab method). Returns hit distance or Infinity. */
export function rayBox(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  a: AABB,
): number {
  let tmin = 0, tmax = Infinity;
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  const mins = [a.minX, a.minY, a.minZ];
  const maxs = [a.maxX, a.maxY, a.maxZ];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < mins[i] || o[i] > maxs[i]) return Infinity;
    } else {
      let t1 = (mins[i] - o[i]) / d[i];
      let t2 = (maxs[i] - o[i]) / d[i];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

/** Nearest world-geometry hit along a ray, capped at maxDist. */
export function raycastWorld(
  aabbs: AABB[],
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDist: number,
): number {
  let best = maxDist;
  for (const a of aabbs) {
    const t = rayBox(ox, oy, oz, dx, dy, dz, a);
    if (t < best) best = t;
  }
  // ground plane at y=0
  if (dy < -1e-9) {
    const t = -oy / dy;
    if (t > 0 && t < best) best = t;
  }
  return best;
}

/** True if a straight line between two eye points is unobstructed. */
export function hasLOS(
  aabbs: AABB[],
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
): boolean {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 0.001) return true;
  const hit = raycastWorld(aabbs, ax, ay, az, dx / dist, dy / dist, dz / dist, dist);
  return hit >= dist - 0.05;
}

/** Ray vs sphere. Returns distance or Infinity. */
export function raySphere(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  cx: number, cy: number, cz: number,
  r: number,
): number {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return Infinity;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  if (d2 > r * r) return Infinity;
  return tca - Math.sqrt(Math.max(0, r * r - d2));
}
