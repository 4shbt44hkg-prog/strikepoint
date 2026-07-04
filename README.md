# Strikepoint

A round-based multiplayer arena shooter for the browser. Create a match, share
the 4-letter code with friends (or add bots), and fight team-elimination
rounds — first team to 5 rounds wins, then the arena rotates.

Inspired by round-based arena shooters: pick a **primary + secondary weapon**
each round, **auto-fire** triggers when your crosshair is on an enemy
(toggleable), and hold **Shift to sprint**.

## Features

- **Online multiplayer** with 4-letter room codes (up to 8 players), plus bots to fill teams
- **Team elimination rounds** — no respawns mid-round, first to 5 round wins
- **5 primaries** (AR, SMG, shotgun, sniper, burst rifle) + **3 secondaries** (pistol, revolver, machine pistol)
- **Auto-fire on aim** (Rivals-style) — fires automatically when your crosshair is on an enemy; toggle it in the pause menu
- Two arenas (Foundry, Mesa) that rotate between matches
- Touch controls on phones (virtual joystick + buttons); desktop and mobile share rooms
- 100% code-generated art and audio — no asset files

## Controls

| Action | Key |
|---|---|
| Move | WASD |
| Look / fire | Mouse / Left click (auto-fire also on by default) |
| Scope (sniper) | Right click |
| Sprint | Shift |
| Jump | Space |
| Reload | R |
| Swap weapon | Q / 1 / 2 / scroll |
| Scoreboard | Tab |

## Development

```bash
npm install
npm run dev        # client on :5174, server on :8081
```

## Production / deploy

One Node process serves the built client and the websocket:

```bash
npm run build
npm start          # honors $PORT
```

Deploys to Render free tier via `render.yaml` (blueprint) — push to main to
redeploy.
