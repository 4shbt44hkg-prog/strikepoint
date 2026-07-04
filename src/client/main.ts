// Entry point: menu + lobby flow, then hands off to Game when a match starts.

import { Net } from "./net";
import { Game } from "./game";
import { detectTouch, initTouch } from "./touch";
import { unlockAudio, playClick } from "./sound";
import { TEAM_NAMES } from "../shared/types";
import type { PlayerMeta } from "../shared/types";

const $ = (id: string) => document.getElementById(id)!;

const net = new Net();
let myId = -1;
let roomCode = "";
let mapId = "foundry";
let game: Game | null = null;
let inLobby = false;

const nameInput = $("playername") as HTMLInputElement;
nameInput.value = localStorage.getItem("strikepoint_name") ?? "";

function showError(msg: string): void {
  $("menuerror").textContent = msg;
}

async function join(code?: string): Promise<void> {
  const name = nameInput.value.trim() || "Player";
  localStorage.setItem("strikepoint_name", name);
  showError("");
  unlockAudio();
  try {
    await net.connect();
  } catch (e) {
    showError((e as Error).message);
    return;
  }
  net.send({ t: "join", room: code, name });
}

$("createbtn").addEventListener("click", () => {
  playClick();
  void join();
});
$("joinbtn").addEventListener("click", () => {
  playClick();
  const code = ($("roomcode") as HTMLInputElement).value.trim().toUpperCase();
  if (code.length !== 4) {
    showError("Room codes are 4 letters.");
    return;
  }
  void join(code);
});
$("roomcode").addEventListener("keydown", (e) => {
  if ((e as KeyboardEvent).key === "Enter") ($("joinbtn") as HTMLButtonElement).click();
});
nameInput.addEventListener("keydown", (e) => {
  if ((e as KeyboardEvent).key === "Enter") ($("createbtn") as HTMLButtonElement).click();
});

$("addbotbtn").addEventListener("click", () => {
  playClick();
  net.send({ t: "addbot" });
});
$("startbtn").addEventListener("click", () => {
  playClick();
  net.send({ t: "start" });
});

function renderLobby(players: PlayerMeta[], host: number): void {
  $("lobbycode").textContent = roomCode;
  for (const team of [0, 1] as const) {
    const ul = $(`team${team}list`);
    ul.innerHTML = "";
    for (const p of players.filter((q) => q.team === team)) {
      const li = document.createElement("li");
      li.textContent = p.name;
      if (p.bot) li.classList.add("bot");
      if (p.id === myId) li.classList.add("me");
      ul.appendChild(li);
    }
  }
  const isHost = host === myId;
  ($("addbotbtn") as HTMLButtonElement).disabled = !isHost;
  ($("startbtn") as HTMLButtonElement).disabled = !isHost;
  $("lobbyhint").textContent = isHost
    ? `First to 5 rounds wins. Playing solo? Add a bot, then start. ${TEAM_NAMES[0]} vs ${TEAM_NAMES[1]}.`
    : "Waiting for the host to start the match…";
}

function startGame(): void {
  if (game) return;
  if (detectTouch()) initTouch();
  game = new Game($("game") as HTMLCanvasElement, net, myId, mapId, roomCode);
}

net.on((msg) => {
  switch (msg.t) {
    case "joined":
      myId = msg.id;
      roomCode = msg.room;
      mapId = msg.map;
      inLobby = true;
      $("menu-main").classList.add("hidden");
      $("lobby").classList.remove("hidden");
      // Create the game immediately so no directed messages (spawn) are missed;
      // it stays behind the menu until the first non-lobby phase arrives.
      startGame();
      break;
    case "roster":
      if (inLobby) renderLobby(msg.players, msg.host);
      break;
    case "phase":
      if (msg.phase !== "lobby" && inLobby) {
        inLobby = false;
        $("menu").classList.add("hidden");
      }
      break;
    case "err":
      showError(msg.msg);
      break;
  }
});

net.onClose = () => {
  if (game) {
    $("menuerror").textContent = "Disconnected from server. Refresh to rejoin.";
    $("menu").classList.remove("hidden");
    $("menu-main").classList.remove("hidden");
    $("lobby").classList.add("hidden");
  }
};
