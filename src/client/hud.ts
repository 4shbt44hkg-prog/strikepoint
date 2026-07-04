// DOM-based HUD: health/ammo, score/timer, killfeed, loadout picker,
// scoreboard, banners, pause overlay.

import { PRIMARIES, SECONDARIES, WEAPONS } from "../shared/weapons";
import { MAX_HP, ROUNDS_TO_WIN, TEAM_NAMES, type PlayerMeta, type Team } from "../shared/types";
import { settings, saveSettings } from "./settings";

const $ = (id: string) => document.getElementById(id)!;

export interface HudCallbacks {
  onLoadout: (primary: string, secondary: string) => void;
  onResume: () => void;
}

let cbs: HudCallbacks;
let selPrimary = localStorage.getItem("strikepoint_primary") ?? "raptor";
let selSecondary = localStorage.getItem("strikepoint_secondary") ?? "sidekick";
let bannerTimeout: ReturnType<typeof setTimeout> | null = null;

export function initHud(callbacks: HudCallbacks): void {
  cbs = callbacks;
  $("hud").classList.remove("hidden");
  buildLoadoutCards();

  $("loadoutok").addEventListener("click", () => {
    cbs.onLoadout(selPrimary, selSecondary);
    $("loadout").classList.add("hidden");
  });
  $("resumebtn").addEventListener("click", () => cbs.onResume());

  const af = $("set-autofire") as HTMLInputElement;
  const sens = $("set-sens") as HTMLInputElement;
  const vol = $("set-vol") as HTMLInputElement;
  af.checked = settings.autoFire;
  sens.value = String(settings.sens);
  vol.value = String(settings.volume);
  af.addEventListener("change", () => { settings.autoFire = af.checked; saveSettings(); });
  sens.addEventListener("input", () => { settings.sens = Number(sens.value); saveSettings(); });
  vol.addEventListener("input", () => { settings.volume = Number(vol.value); saveSettings(); });
}

function statBar(v: number, max: number): string {
  const n = Math.round((v / max) * 8);
  return "▮".repeat(n) + "▯".repeat(8 - n);
}

function buildLoadoutCards(): void {
  const build = (containerId: string, defs: typeof PRIMARIES, getSel: () => string, setSel: (id: string) => void) => {
    const el = $(containerId);
    el.innerHTML = "";
    for (const w of defs) {
      const card = document.createElement("div");
      card.className = "wpncard" + (getSel() === w.id ? " selected" : "");
      card.dataset.wpn = w.id;
      const dps = Math.round(w.dmg * w.pellets * ((w.rpm * (w.burst ?? 1)) / 60));
      card.innerHTML = `<b>${w.name}</b><span>${w.desc}</span>` +
        `<div class="stats">DMG ${statBar(w.dmg * w.pellets, 90)} &nbsp;DPS ${dps} &nbsp;MAG ${w.mag}</div>`;
      card.addEventListener("click", () => {
        setSel(w.id);
        el.querySelectorAll(".wpncard").forEach((c) => c.classList.toggle("selected", (c as HTMLElement).dataset.wpn === w.id));
      });
      el.appendChild(card);
    }
  };
  build("primarycards", PRIMARIES, () => selPrimary, (id) => {
    selPrimary = id;
    localStorage.setItem("strikepoint_primary", id);
  });
  build("secondarycards", SECONDARIES, () => selSecondary, (id) => {
    selSecondary = id;
    localStorage.setItem("strikepoint_secondary", id);
  });
}

export function getLoadout(): { primary: string; secondary: string } {
  return { primary: selPrimary, secondary: selSecondary };
}

export function showLoadout(show: boolean): void {
  $("loadout").classList.toggle("hidden", !show);
}

export function setLoadoutTimer(seconds: number): void {
  $("loadouttimer").textContent = `Round starts in ${seconds}s`;
}

export function setHp(hp: number): void {
  const fill = $("hpfill");
  fill.style.width = `${Math.max(0, (hp / MAX_HP) * 100)}%`;
  fill.classList.toggle("low", hp <= 35);
  $("hptext").textContent = String(Math.max(0, Math.ceil(hp)));
  $("vignette").style.opacity = hp <= 0 ? "0" : String(Math.max(0, 1 - hp / 60) * 0.9);
}

export function damageFlash(): void {
  const v = $("vignette");
  v.style.opacity = "1";
  setTimeout(() => setHpVignetteOnly(), 120);
}

let lastHp = MAX_HP;
function setHpVignetteOnly(): void {
  $("vignette").style.opacity = lastHp <= 0 ? "0" : String(Math.max(0, 1 - lastHp / 60) * 0.9);
}

export function trackHp(hp: number): void {
  lastHp = hp;
  setHp(hp);
}

export function setAmmo(mag: number, reloading: boolean, wpnId: string): void {
  $("magcount").textContent = reloading ? "--" : String(mag);
  $("ammo").classList.toggle("reloading", reloading);
  $("wpnname").textContent = WEAPONS[wpnId]?.name ?? wpnId;
}

export function setScore(score: [number, number], round: number, timer: number): void {
  $("score0").textContent = String(score[0]);
  $("score1").textContent = String(score[1]);
  $("roundlabel").textContent = `ROUND ${Math.max(1, round)} · FIRST TO ${ROUNDS_TO_WIN}`;
  const m = Math.floor(timer / 60);
  const s = Math.floor(timer % 60);
  $("timer").textContent = `${m}:${s.toString().padStart(2, "0")}`;
}

export function killfeed(fromName: string, fromTeam: Team, wpn: string, targetName: string, targetTeam: Team): void {
  const feed = $("killfeed");
  const div = document.createElement("div");
  div.innerHTML = `<span class="t${fromTeam}">${fromName}</span>` +
    `<span class="wpn">[${WEAPONS[wpn]?.name ?? wpn}]</span>` +
    `<span class="t${targetTeam}">${targetName}</span>`;
  feed.appendChild(div);
  while (feed.children.length > 6) feed.removeChild(feed.firstChild!);
  setTimeout(() => div.remove(), 6100);
}

export function hitmarker(head: boolean): void {
  const hm = $("hitmarker");
  hm.classList.remove("pop");
  hm.classList.toggle("head", head);
  void hm.offsetWidth; // restart animation
  hm.classList.add("pop");
}

export function setOnTarget(on: boolean): void {
  $("crosshair").classList.toggle("on-target", on);
}

export function banner(text: string, team: Team | -1, ms = 2600): void {
  const b = $("centerbanner");
  b.textContent = text;
  b.className = team === 0 ? "team0" : team === 1 ? "team1" : "";
  b.classList.remove("hidden");
  if (bannerTimeout) clearTimeout(bannerTimeout);
  bannerTimeout = setTimeout(() => b.classList.add("hidden"), ms);
}

export function showSpectate(show: boolean, killerName?: string): void {
  $("spectate").classList.toggle("hidden", !show);
  if (killerName) $("specmsg").textContent = `Taken down by ${killerName}`;
}

export function showPause(show: boolean, roomCode: string): void {
  $("pauseoverlay").classList.toggle("hidden", !show);
  $("pauseroom").textContent = roomCode;
}

export function updateScoreboard(
  roster: PlayerMeta[],
  aliveById: Map<number, boolean>,
  myId: number,
  show: boolean,
): void {
  const sb = $("scoreboard");
  sb.classList.toggle("hidden", !show);
  if (!show) return;
  const rows = [...roster]
    .sort((a, b) => a.team - b.team || b.kills - a.kills)
    .map((p) => {
      const dead = aliveById.get(p.id) === false;
      return `<tr class="t${p.team}${dead ? " dead" : ""}">` +
        `<td>${p.name}${p.id === myId ? " ★" : ""}</td>` +
        `<td>${TEAM_NAMES[p.team]}</td><td>${p.kills}</td><td>${p.deaths}</td></tr>`;
    })
    .join("");
  sb.innerHTML = `<table><tr><th>PLAYER</th><th>TEAM</th><th>K</th><th>D</th></tr>${rows}</table>`;
}

export function hideMenu(): void {
  $("menu").classList.add("hidden");
}
