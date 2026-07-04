// Arena definitions. Everything is axis-aligned boxes (center + size) so the
// same data drives Three.js meshes on the client and AABB collision/LOS on
// both sides. Maps are symmetric across Z: team 0 spawns at -Z, team 1 at +Z.

export interface BoxDef {
  x: number; y: number; z: number; // center
  w: number; h: number; d: number; // full size
  color: string;
}

export interface MapDef {
  id: string;
  name: string;
  size: number;            // half-extent of the playable square
  sky: string;
  fog: string;
  ground: string;
  groundAccent: string;
  boxes: BoxDef[];
  /** [x, z, yawDegrees] per team, cycled through for spawns. */
  spawns: [[number, number, number][], [number, number, number][]];
}

const box = (x: number, y: number, z: number, w: number, h: number, d: number, color: string): BoxDef =>
  ({ x, y, z, w, h, d, color });

/** Mirror a set of boxes across z=0 (skipping boxes centered on the axis). */
function mirrorZ(boxes: BoxDef[]): BoxDef[] {
  const out = [...boxes];
  for (const b of boxes) {
    if (Math.abs(b.z) > 0.01) out.push({ ...b, z: -b.z });
  }
  return out;
}

/** Perimeter walls so nobody falls off the world. */
function walls(size: number, h: number, color: string): BoxDef[] {
  const t = 2;
  return [
    box(0, h / 2, -size - t / 2, size * 2 + t * 2, h, t, color),
    box(0, h / 2, size + t / 2, size * 2 + t * 2, h, t, color),
    box(-size - t / 2, h / 2, 0, t, h, size * 2, color),
    box(size + t / 2, h / 2, 0, t, h, size * 2, color),
  ];
}

// ── FOUNDRY: industrial arena. Crates, catwalk block, container lanes. ──
const foundryHalf: BoxDef[] = [
  // Mid structure (shared, on axis)
  box(0, 1.5, 0, 10, 3, 3, "#5a6472"),          // central wall block
  box(0, 3.6, 0, 6, 1.2, 5, "#6b7684"),          // roof slab over mid (jump-up perch)
  box(-8, 1, 0, 2.2, 2, 2.2, "#8a4a3a"),         // flank crates at mid line
  box(8, 1, 0, 2.2, 2, 2.2, "#8a4a3a"),

  // One side (mirrored to the other)
  box(0, 1.1, 9, 4.5, 2.2, 2.2, "#7c5a38"),      // cover wall mid-lane
  box(-6, 0.75, 13, 1.6, 1.5, 1.6, "#8a6a42"),   // scatter crates
  box(-4.4, 0.6, 14.2, 1.2, 1.2, 1.2, "#96744a"),
  box(6, 0.75, 13, 1.6, 1.5, 1.6, "#8a6a42"),
  box(4.6, 1.85, 13, 1.4, 1.0, 1.4, "#a07c50"),  // stacked crate (step-up)
  box(-13, 1.4, 8, 2.4, 2.8, 7, "#4f6b5a"),      // left container
  box(13, 1.4, 8, 2.4, 2.8, 7, "#6b4f5a"),       // right container
  box(-13, 3.1, 8, 2.4, 0.6, 7, "#3f574a"),      // container lids (walkable)
  box(13, 3.1, 8, 2.4, 0.6, 7, "#573f4a"),
];

const FOUNDRY: MapDef = {
  id: "foundry",
  name: "Foundry",
  size: 24,
  sky: "#1a2230",
  fog: "#232c3c",
  ground: "#39404c",
  groundAccent: "#2e3540",
  boxes: [
    ...walls(24, 5, "#2c333e"),
    ...mirrorZ(foundryHalf),
    // Stairs up onto each container, mirrored by hand (rise along z toward the container)
    ...mirrorZ([
      box(-13, 0.35, 12.6, 2.4, 0.7, 1.0, "#5c6670"),
      box(-13, 0.8, 11.9, 2.4, 1.6, 0.9, "#566070"),
      box(-13, 1.25, 11.2, 2.4, 2.5, 0.7, "#505a6a"),
      box(13, 0.35, 12.6, 2.4, 0.7, 1.0, "#5c6670"),
      box(13, 0.8, 11.9, 2.4, 1.6, 0.9, "#566070"),
      box(13, 1.25, 11.2, 2.4, 2.5, 0.7, "#505a6a"),
    ]),
  ],
  spawns: [
    [[-8, -20, 180], [0, -21, 180], [8, -20, 180], [-3, -19, 180], [3, -19, 180]],
    [[8, 20, 0], [0, 21, 0], [-8, 20, 0], [3, 19, 0], [-3, 19, 0]],
  ],
};

// ── MESA: open desert arena. Rocks, pillars, raised center. ──
const mesaHalf: BoxDef[] = [
  box(0, 0.9, 0, 12, 1.8, 8, "#7a5a44"),          // raised mesa center (walkable via ramps)
  box(0, 2.4, 0, 3.5, 1.2, 3.5, "#8a6a50"),       // block on top of mesa
  box(-15, 2, 4, 3, 4, 3, "#6e5240"),             // tall rock left
  box(15, 2, 4, 3, 4, 3, "#6e5240"),              // tall rock right

  box(0, 0.45, 7.2, 12, 0.9, 1.6, "#77573f"),     // mesa step (front, lets you climb up)
  box(-8, 1.1, 10, 2.6, 2.2, 2.6, "#7d5c46"),     // mid rocks
  box(8, 1.1, 10, 2.6, 2.2, 2.6, "#7d5c46"),
  box(-2.5, 0.8, 14, 2, 1.6, 2, "#86644c"),
  box(2.5, 0.8, 14, 2, 1.6, 2, "#86644c"),
  box(-16, 0.9, 14, 2.2, 1.8, 2.2, "#6e5240"),
  box(16, 0.9, 14, 2.2, 1.8, 2.2, "#6e5240"),
  box(-9, 2.2, 17, 1.6, 4.4, 1.6, "#5f4636"),     // pillars near spawns
  box(9, 2.2, 17, 1.6, 4.4, 1.6, "#5f4636"),
];

const MESA: MapDef = {
  id: "mesa",
  name: "Mesa",
  size: 26,
  sky: "#c98d52",
  fog: "#b8916a",
  ground: "#a3764f",
  groundAccent: "#8f6743",
  boxes: [...walls(26, 5, "#5c4534"), ...mirrorZ(mesaHalf)],
  spawns: [
    [[-9, -22, 180], [0, -23, 180], [9, -22, 180], [-4, -21, 180], [4, -21, 180]],
    [[9, 22, 0], [0, 23, 0], [-9, 22, 0], [4, 21, 0], [-4, 21, 0]],
  ],
};

export const MAPS: Record<string, MapDef> = { foundry: FOUNDRY, mesa: MESA };
export const MAP_ROTATION = ["foundry", "mesa"];
