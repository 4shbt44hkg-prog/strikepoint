// Desktop input: pointer lock mouse-look + WASD. Touch controls (touch.ts)
// write into the same InputState so the game loop reads one source of truth.

export interface InputState {
  // movement axes -1..1 (touch joystick writes fractional values)
  moveX: number;
  moveZ: number; // +1 = forward
  jump: boolean;      // edge-triggered, consumed by game
  sprint: boolean;
  fire: boolean;      // held
  zoom: boolean;      // held (right mouse)
  // accumulated look deltas since last frame
  lookX: number;
  lookY: number;
  swapTo: "primary" | "secondary" | "toggle" | null; // consumed
  reload: boolean;    // consumed
  scoreboard: boolean;
}

export const input: InputState = {
  moveX: 0, moveZ: 0, jump: false, sprint: false, fire: false, zoom: false,
  lookX: 0, lookY: 0, swapTo: null, reload: false, scoreboard: false,
};
// Debug hook (used by automated smoke tests).
(window as unknown as Record<string, unknown>).__spInput = input;

const keys = new Set<string>();
let locked = false;
export let isTouch = false;

export function setTouchMode(v: boolean): void {
  isTouch = v;
}

export function pointerLocked(): boolean {
  return locked || isTouch;
}

export function requestLock(canvas: HTMLCanvasElement): void {
  if (!isTouch) canvas.requestPointerLock?.();
}

export function initInput(canvas: HTMLCanvasElement, onLockChange: (locked: boolean) => void): void {
  document.addEventListener("pointerlockchange", () => {
    locked = document.pointerLockElement === canvas;
    if (!locked) keys.clear();
    onLockChange(locked);
  });

  document.addEventListener("mousemove", (e) => {
    if (!locked) return;
    input.lookX += e.movementX;
    input.lookY += e.movementY;
  });

  canvas.addEventListener("mousedown", (e) => {
    if (!locked) return;
    if (e.button === 0) input.fire = true;
    if (e.button === 2) input.zoom = true;
  });
  document.addEventListener("mouseup", (e) => {
    if (e.button === 0) input.fire = false;
    if (e.button === 2) input.zoom = false;
  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("wheel", () => {
    if (locked) input.swapTo = "toggle";
  });

  document.addEventListener("keydown", (e) => {
    if (!locked) return;
    if (e.code === "Tab") e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === "Space") input.jump = true;
    if (e.code === "KeyR") input.reload = true;
    if (e.code === "KeyQ") input.swapTo = "toggle";
    if (e.code === "Digit1") input.swapTo = "primary";
    if (e.code === "Digit2") input.swapTo = "secondary";
  });
  document.addEventListener("keyup", (e) => keys.delete(e.code));
}

/** Refresh continuous states from held keys. Call once per frame (desktop). */
export function pollKeys(): void {
  if (isTouch) return; // touch.ts owns the axes
  input.moveZ = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
  input.moveX = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
  input.sprint = keys.has("ShiftLeft") || keys.has("ShiftRight");
  input.scoreboard = keys.has("Tab");
}
