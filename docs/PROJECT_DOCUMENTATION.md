# snakee.io Project Documentation

## 1. Overview

`snakee.io` is a TypeScript monorepo for a real-time multiplayer snake game with:

- PixiJS client rendering
- Authoritative Node.js server simulation
- MessagePack websocket protocol (`msgpackr`)
- Shared constants/types package for client/server contract
- Optional Supabase auth, profiles, stats, and leaderboard APIs

## 2. Monorepo Structure

- `client/`: Vite + PixiJS frontend (`snakee-client`)
- `server/`: NodeNext TypeScript backend (`snakee-server`)
- `shared/`: shared constants and protocol types (`snakee-shared`)
- `scripts/`: environment checks + Supabase SQL bootstrap
- `dist/`: frontend/server build artifacts

Root workspace scripts:

- `npm run dev`: starts client + server concurrently
- `npm run build`: builds shared, client, then server
- `npm run start`: starts built server workspace
- `npm run doctor`: environment preflight checks

## 3. Runtime Architecture

### Client flow

1. `client/src/main.ts` creates `GameScene`.
2. `StartMenu` handles auth/guest + nickname.
3. On play:
   - `SocketClient` connects via websocket
   - `InputHandler` sends angle/boost input at 30 Hz
   - `HUD` + `DeathScreen` are mounted
4. Rendering loop interpolates server snapshots and draws:
   - arena/background
   - orbs (particle container)
   - snakes
   - UI overlays

### Server flow

1. HTTP + websocket upgrade handled in `server/src/index.ts`.
2. Matchmaking assigns player to room (`World` instance).
3. `World` runs fixed-tick simulation (`SERVER_TICK_RATE`).
4. Each tick updates:
   - snake movement + boost mass shedding
   - orb consumption/spawn
   - bot AI decisions
   - collisions/deaths
5. `Broadcaster` emits delta tick payloads per client.

## 4. Shared Game Contract

Shared protocol lives in `shared/types.ts`.

Server -> client:

- `welcome`
- `tick`
- `death`

Client -> server:

- `join`
- `input`

Key constants live in `shared/constants.ts`:

- world size/tick/input rates
- snake physics/boost parameters
- orb settings
- camera and visual constants

## 5. Core Gameplay Systems

### Snake simulation

- Managed by `server/src/game/Snake.ts`
- Smooth turn clamp using `SNAKE_TURN_SPEED`
- Boost activation gated by minimum segment count
- Energy drain/regen while boosting/not boosting
- Segment following via spacing correction

### Orb system

- Managed by `server/src/game/OrbManager.ts`
- Maintains baseline orb count
- Consumes orbs near snake head radius
- Spawns mass orbs on death and during boost shedding

### Collision system

- Managed by `server/src/game/Collision.ts`
- Spatial hash grid for head-vs-body checks
- Arena boundary death handling

### Bot AI

- Managed by `server/src/game/BotAI.ts`
- Stateful modes (collect/wander/recover/evade/etc.)
- Hazard-aware steering and threat response
- Short-horizon action scoring with proximity escape logic

## 6. Networking and Synchronization

- Transport: websocket server (`ws`)
- Serialization: MessagePack (`msgpackr`)
- Input cadence: client sends 30 Hz (`INPUT_SEND_RATE`)
- Render smoothing: client interpolates between snapshots
- Delta broadcasting:
  - changed snakes/orbs only
  - removed entity IDs tracked and sent

## 7. Authentication and Persistence

Client auth module: `client/src/auth/supabase.ts`

Server auth module: `server/src/auth/supabase.ts`

If Supabase env vars are present:

- websocket token can map a player to authenticated profile
- REST endpoints enabled:
  - `GET /api/me`
  - `PATCH /api/me`
  - `GET /api/leaderboard/all-time`
- On authenticated death, stats are persisted:
  - games played
  - total score
  - best score
  - best length
  - last played timestamp

Schema bootstrap: `scripts/supabase_schema.sql`

## 8. Environment Variables

Client:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_BASE_URL` (optional local, needed split-host deploys)
- `VITE_WS_URL` (optional local, needed split-host deploys)

Server:

- `PORT` (default `9001`)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CORS_ORIGIN` (default `*`)
- `MATCH_MAX_PLAYERS` (default `24`)
- `BOT_DEBUG_LOGS` (`1` enables AI mode diagnostics)

## 9. Build and Deployment Notes

- Client dev port: `5173`
- Server websocket/API port: `9001`
- Root Vite config serves from `client/`
- Vercel config currently builds frontend workspace and outputs `client/dist`

## 10. Current Known Deltas / Follow-up

- `Rules.md` specifies `uWebSockets.js`; implementation currently uses `ws`.
- `Rules.md` mentions viewport culling after step progression; current broadcaster sends global changed entities, not per-client view culling.
- Renderer/object lifecycle behavior should continue to be reviewed for pooling/reuse targets.

---

Last documentation refresh: 2026-03-24
