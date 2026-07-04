// Mobile touch controls: virtual joystick (left), look-drag (right half),
// and action buttons. Auto-fire does the shooting; a FIRE button exists too.

import { input, setTouchMode } from "./input";

export function detectTouch(): boolean {
  const forced = localStorage.getItem("strikepoint_touch");
  if (forced === "1") return true;
  if (forced === "0") return false;
  return window.matchMedia("(pointer: coarse)").matches;
}

export function initTouch(): void {
  setTouchMode(true);
  const ui = document.getElementById("touchui")!;
  ui.classList.remove("hidden");

  const joy = document.getElementById("joystick")!;
  const knob = document.getElementById("joyknob")!;
  let joyId: number | null = null;
  let joyCX = 0, joyCY = 0;
  const JOY_R = 55;

  joy.addEventListener("pointerdown", (e) => {
    joyId = e.pointerId;
    const r = joy.getBoundingClientRect();
    joyCX = r.left + r.width / 2;
    joyCY = r.top + r.height / 2;
    joy.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  joy.addEventListener("pointermove", (e) => {
    if (e.pointerId !== joyId) return;
    let dx = (e.clientX - joyCX) / JOY_R;
    let dy = (e.clientY - joyCY) / JOY_R;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    input.moveX = dx;
    input.moveZ = -dy;
    knob.style.transform = `translate(calc(-50% + ${dx * JOY_R * 0.6}px), calc(-50% + ${dy * JOY_R * 0.6}px))`;
  });
  const joyEnd = (e: PointerEvent) => {
    if (e.pointerId !== joyId) return;
    joyId = null;
    input.moveX = 0;
    input.moveZ = 0;
    knob.style.transform = "translate(-50%, -50%)";
  };
  joy.addEventListener("pointerup", joyEnd);
  joy.addEventListener("pointercancel", joyEnd);

  // Look: drag anywhere on the right half of the screen (outside buttons).
  const canvas = document.getElementById("game")!;
  let lookId: number | null = null;
  let lastX = 0, lastY = 0;
  canvas.addEventListener("pointerdown", (e) => {
    if (e.clientX < window.innerWidth * 0.45 || lookId !== null) return;
    lookId = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerId !== lookId) return;
    input.lookX += (e.clientX - lastX) * 2.2;
    input.lookY += (e.clientY - lastY) * 2.2;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  const lookEnd = (e: PointerEvent) => {
    if (e.pointerId === lookId) lookId = null;
  };
  canvas.addEventListener("pointerup", lookEnd);
  canvas.addEventListener("pointercancel", lookEnd);

  const hold = (id: string, on: () => void, off: () => void) => {
    const el = document.getElementById(id)!;
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      el.classList.add("held");
      on();
    });
    const end = () => { el.classList.remove("held"); off(); };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("pointerleave", end);
  };

  hold("tb-jump", () => { input.jump = true; }, () => {});
  hold("tb-sprint", () => { input.sprint = true; }, () => { input.sprint = false; });
  hold("tb-fire", () => { input.fire = true; }, () => { input.fire = false; });
  hold("tb-reload", () => { input.reload = true; }, () => {});
  hold("tb-swap", () => { input.swapTo = "toggle"; }, () => {});
}
