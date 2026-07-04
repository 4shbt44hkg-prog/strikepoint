// Strikepoint server: serves the built client (production) and runs
// room-based match simulation over WebSockets at /ws.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import type { C2S } from "../shared/protocol";
import { MAX_PLAYERS } from "../shared/types";
import { Room } from "./room";

const argPortIdx = process.argv.indexOf("--port");
const PORT = argPortIdx >= 0 ? Number(process.argv[argPortIdx + 1]) : Number(process.env.PORT ?? 8081);
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DIST = join(__dirname, "..", "..", "dist");

const MIME: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json",
  ".svg": "image/svg+xml", ".woff2": "font/woff2",
};

const server = createServer(async (req, res) => {
  if (!existsSync(DIST)) {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("Strikepoint server running. In dev, open the Vite client (http://localhost:5174). For production, run `npm run build` first.");
    return;
  }
  try {
    let path = normalize(decodeURIComponent((req.url ?? "/").split("?")[0])).replace(/^([/\\])+/, "");
    if (path === "" || path === ".") path = "index.html";
    const file = join(DIST, path);
    if (!file.startsWith(DIST)) throw new Error("bad path");
    const s = await stat(file).catch(() => null);
    const target = s?.isFile() ? file : join(DIST, "index.html");
    const data = await readFile(target);
    res.writeHead(200, { "content-type": MIME[extname(target)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});

const wss = new WebSocketServer({ server, path: "/ws" });
const rooms = new Map<string, Room>();
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

function newCode(): string {
  let code = "";
  do {
    code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
  } while (rooms.has(code));
  return code;
}

wss.on("connection", (ws: WebSocket) => {
  let room: Room | null = null;

  ws.on("message", (raw) => {
    let msg: C2S;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.t === "join") {
      const code = (msg.room || "").toUpperCase().trim();
      if (code && rooms.has(code)) {
        room = rooms.get(code)!;
      } else if (code && !rooms.has(code)) {
        ws.send(JSON.stringify({ t: "err", msg: `Match "${code}" not found.` }));
        return;
      } else {
        room = new Room(newCode());
        rooms.set(room.code, room);
        console.log(`[room ${room.code}] created`);
      }
      if (room.humanCount() >= MAX_PLAYERS) {
        ws.send(JSON.stringify({ t: "err", msg: `That match is full (${MAX_PLAYERS} players max).` }));
        room = null;
        return;
      }
      room.addHuman(ws, msg.name);
      return;
    }
    if (room) room.handle(ws, msg);
  });

  ws.on("close", () => {
    if (room) {
      room.removeHuman(ws);
      if (room.humanCount() === 0) {
        // Keep empty rooms for 10 minutes so a disconnect doesn't kill the match.
        const r = room;
        setTimeout(() => {
          if (r.humanCount() === 0) {
            rooms.delete(r.code);
            console.log(`[room ${r.code}] closed`);
          }
        }, 10 * 60 * 1000);
      }
    }
  });
});

const TICK = 1 / 20;
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.humanCount() > 0) room.tick(TICK);
  }
}, TICK * 1000);

server.listen(PORT, () => {
  console.log(`Strikepoint server listening on http://localhost:${PORT} (ws at /ws)`);
});
