# snakee.io — Project Context & Change Log

## What This Project Is
A browser-based multiplayer snake game (Slither.io reskin) named **snakee.io**.
Monorepo with three packages:
- `client/` — PIXI.js v8 frontend (Vite, TypeScript)
- `server/` — Node.js WebSocket game server (uWebSockets.js, TypeScript)
- `shared/` — constants + types shared by both

**Deployment**: Client on Vercel free tier, Server on Render free tier (0.1 CPU).

---

## Architecture Summary

### Network
- Binary MessagePack protocol via `msgpackr`
- Server ticks at 20 Hz (`SERVER_TICK_RATE = 20`)
- Client renders at 60 fps, 300 ms behind server (`INTERPOLATION_DELAY_MS = 300`)
- Delta-encoded snapshots — only changed entities sent per tick
- Client interpolates between two snapshots (no extrapolation — was tried, caused rubber-band jumping, reverted)

### Server Game Loop (`server/src/game/World.ts`)
- `MIN_ACTIVE_SNAKES = 6` bots maintained
- `SUB_STEPS = 2` physics sub-steps per tick
- Orb spatial grid built **once per tick**, shared across sub-steps
- Bot AI staggered: even-index bots update on even ticks, odd on odd ticks (~10 Hz per bot)
- `BOT_ORB_VISION_RADIUS = 1200`
- `findNearbyThreats()` excludes bot's **own** segments (line 306) — own body never appears in `segmentHazards`
- `findNearbySnakes()` excludes own snake (line 382) — own snake never in `nearbySnakes`
- Execution order per sub-step: Bot AI → snake movement → orb collection → collision

### Client Rendering (`client/src/game/`)
- `GameScene.ts` — main scene, snapshot buffer, interpolation
- `SnakeRenderer.ts` — PIXI Graphics per snake
- `OrbRenderer.ts` — PIXI ParticleContainer for orbs
- `Camera.ts` — lerp camera with EMA-smoothed look-ahead
- `InputHandler.ts` — mouse/touch/keyboard with bound refs for proper cleanup

---

## Key Constants (`shared/constants.ts`)
```
ARENA_RADIUS = 3000
MAX_ORBS = 1500
SERVER_TICK_RATE = 20
SNAKE_START_LENGTH = 3       ← bots AND players spawn at 3 segments
SEGMENT_SPACING = 12
SNAKE_BASE_SPEED = 220       ← 11 units/tick, 17.6 boosted
SNAKE_HEAD_RADIUS = 14
SNAKE_BODY_RADIUS = 10       ← kill radius = 14+10 = 24 units
BOOST_MULTIPLIER = 1.6
BOOST_ENERGY_MAX = 100
BOOST_ENERGY_DRAIN_PER_SEC = 40   ← 2.5s max continuous boost
BOOST_ENERGY_REGEN_PER_SEC = 22
BOT_BOOST_START_MIN_SEGMENTS = 3  ← bots can boost from spawn
BOOST_START_MIN_SEGMENTS = 6      ← humans need 6 segments
SNAKE_TURN_SPEED = 4.5 rad/sec    ← 90° turn takes ~350ms
CAMERA_LERP = 0.1
```

---

## Kill Mechanics (how deaths actually work)
- **Collision.ts** checks every alive snake's HEAD against all other snakes' BODY SEGMENTS
- Kill fires when: `distanceSq(victim.head, killer.segment) < (HEAD_RADIUS + BODY_RADIUS)² = 576`
- Kill radius = **24 units**; SEGMENT_SPACING = 12 → segments overlap in kill detection (no gaps)
- Own segments are excluded from checks (can't self-collide)
- Body-on-body collisions are NOT checked — only head-into-body kills
- To kill: get your BODY in front of the prey's HEAD (prey runs into you)
- Collision runs after movement each sub-step (40Hz effective collision rate)

---

## BotAI Architecture (`server/src/game/BotAI.ts` — ~1200 lines)

### BotMode states
```
seek_orb | wander | recover | body_avoid | trapped_survival | evade_threat | pursue_prey | coil_trap
```

### BotPersonality ratios (getBrain, line ~1231)
- **Aggressive** 40%: hunts snakes up to 110% own size, chases 1.3× further, boosts 76% during hunt
- **Defensive** 38%: hunts snakes up to 95% own size, wider threat radius (1.35×), 40% skip if no human nearby
- **Passive** 22%: never hunts, occasionally zones out, low threat sensitivity (0.55×)

### Key BotBrain fields (added session 2)
- `preyId: string | null` — ID of current hunt target; used to suppress threat/escape responses against own prey
- `coilPivot: Vec2 | null` — center of coil orbit (tracks prey head each tick)
- `coilRadius: number` — current orbit radius (shrinks 22 units/sec, 280→90)
- `coilDirection: 1 | -1` — CCW (+1) or CW (-1), chosen by cross-product of prey heading vs bot position

### Key radii (BotAI.ts constants)
```
THREAT_ALERT_RADIUS     = 780    (was 1100 — reduced to stop constant hunt cancellation)
THREAT_PANIC_RADIUS     = 450
PREY_CHASE_RADIUS       = 900    (×1.45 for humans = 1305)
PROXIMITY_ESCAPE_RADIUS = 500
ANCHOR_SOFT_LEASH       = 760
ANCHOR_HARD_LEASH       = 1050
COIL_ENGAGE_RADIUS      = 360    (switch to coil_trap when this close to prey)
COIL_ORBIT_START        = 280    (initial orbit radius)
COIL_ORBIT_MIN          = 90     (tightest orbit)
COIL_SHRINK_RATE        = 22     (units/sec)
```

### update() control flow (order matters)
1. Critical boundary → recover
2. `findImmediateThreat` → if dangerous AND not hunting same prey → evade_threat
3. Anchor leash (SKIPPED during `coil_trap`)
4. Stuck detection (SKIPPED during `coil_trap`)
5. Handle recover (return early)
6. Handle body_avoid / trapped_survival / evade_threat (return early if modeUntilMs active)
7. Handle `coil_trap` (return early if prey still close + not near boundary)
8. `computeProximityEscape` → short-circuit evade (passes `brain.preyId` to skip prey)
9. `planLightModelAction` → returns PlannedAction {angle, boost, reason}

### coil_trap mechanics
- Entered when `preyDist < 360` and not passive
- `computeCoilAngle()`: tangential + radial correction orbital steering
- Commits directly to orbit angle — NO `computeSafeHeading` filter (own body already excluded from hazards by World.ts; other hazards would break the coil)
- Boosts with 88% chance per tick, 1100ms hold
- Duration: 2000–3500ms
- Pivot updates to track prey's current head each tick
- Exits if: prey escapes > COIL_ORBIT_START×3.2=896 units, modeUntilMs expires, or near arena boundary
- After exit → wander mode, preyId cleared

---

## All Bugs Fixed (chronological)

### 1–12 (previous sessions — see git log)
Covers: OrbManager iterator, null head guard, collision doomed set, InputHandler listener leak, WebSocket reconnect loop, SnakeRenderer fill color, BackgroundMusic listener leak, CPU stutter (MAX_ORBS/SUB_STEPS/MIN_ACTIVE_SNAKES cuts), extrapolation revert, draw call reduction, camera jerk, proximity escape fleeing own prey.

### 13. BotAI — Complete Kill System Overhaul (session 2, 2026-03-26)
**File**: `server/src/game/BotAI.ts`

Three independent root causes all confirmed by 3-agent parallel audit:

**Root cause A — Spawn lock** (kills literally impossible at game start):
- All bots spawn at 3 segments. Old `preyLengthThreshold = 0.90` → prey must be < `3×0.90 = 2.7` segments. 3 is not < 2.7 → `selectPreyTarget` returned `null` for EVERY bot on EVERY tick. No hunting ever fired.
- Fix: threshold → `1.10` (aggressive) / `0.95` (defensive). Same-size snakes are now valid prey.

**Root cause B — Score gate**:
- Score formula: `(myLength-prey.length)×2.5 - dist×0.7 - penalty`. At 430 units with 1-seg diff: `-298.5 < -280` threshold → null. Most realistic hunt distances produced scores below the gate.
- Fix: distance penalty `×0.7` → `×0.30`, threshold `-280` → `-500`.

**Root cause C — Prey flagged as immediate threat**:
- `findImmediateThreat` checked all nearby snakes including the current prey. With same-size hunting now allowed, the prey (same size = ≥1.05× threshold) was flagged as a threat and aborted the hunt.
- Fix: `findImmediateThreat` now accepts `skipId: string | null = null`, skips `brain.preyId`. Both call sites pass `brain.preyId`.

**Supporting fixes also applied**:
- `THREAT_ALERT_RADIUS`: 1100 → 780 (was always firing with 6 snakes in 3000-radius arena)
- Threat override skips abort when `brain.mode === pursue_prey || coil_trap` unless truly dangerous (`dist < THREAT_PANIC_RADIUS` or `closingStrength > 0.35`)
- `computeProximityEscape`: added `skipId` param, skips current prey (aggressive bots hunted 80-90% size range — same range that triggered flee)
- `selectPreyTarget`: return type changed `Vec2 | null` → `NearbySnake | null`; `brain.preyId` set on each call
- Added `coil_trap` BotMode + `"coil"` PlannedAction reason
- Added `preyId`, `coilPivot`, `coilRadius`, `coilDirection` to BotBrain
- `computeCoilAngle()` new function: tangential+radial orbital steering
- `computePreyAimPoint()` new function: replaces inline intercept logic
- Stuck-detection and anchor-leash both skip `coil_trap` mode
- Coil uses raw angle (no `computeSafeHeading`); only boundary-aborts
- `rolloutScore`: preyId-aware threat penalty (doesn't penalise moving toward own prey); hunt/coil proximity bonus 18 → 26/42
- Defensive bots: hunt skip chance 55% → 40%

---

## Session 3 — Code Audit (2026-03-26, no code changes)

### What was done
Full parallel agent audit of `BotAI.ts` (~1200 lines), `World.ts`, and `Collision.ts`.
No code was changed. This session produced a verified picture of actual bot behaviour.

### Confirmed working correctly
- `preyId` skip in `findImmediateThreat()` and `computeProximityEscape()` — bots never flee own prey ✓
- Coil direction set via cross-product of prey heading (correct orbital geometry) ✓
- Boost during coil: 88% chance / 1.1s hold ✓
- Bot spawn always near human (320–900 units) ✓
- Collision kill condition: distSq < 576 (24-unit radius), 40Hz rate ✓
- `findNearbyThreats()` correctly excludes own segments (no self-flee) ✓

### Minor bugs — all fixed (session 4, 2026-03-26)
- **preyId race** (Medium): Fixed — `selectPreyTarget` now called and `brain.preyId` updated before `computeProximityEscape`, eliminating the 1-tick stale lag. Pre-computed prey passed into `planLightModelAction` to avoid double call.
- **Coil state leak** (Low): Fixed — `coilRadius` and `coilDirection` explicitly cleared to defaults on coil exit.
- **Steering noise in recovery** (Low): Fixed — `applySteeringNoise()` now skipped during `trapped_survival` and `body_avoid` modes so the escape angle isn't perturbed.
- **Coil pivot jitter** (Low): Fixed — pivot now lerps toward prey head at 6× rate per second (≈50% per tick at 20Hz) instead of snapping, smoothing orbit when prey zigzags.

### Dead code identified (safe to remove, not urgent)
- `lastTargetDistance`, `bestTargetDistance`, `noProgressSeconds` on `BotBrain` — initialized, never read
- `buildMassQueue()` result (`massQueue`) — built but never consumed by planner
- `selectTargetOrb()` function — defined but never called

### Balance notes from audit
- Coil tighten: 280 → 90 at 22 units/sec = 8.6s to full tighten, but max coil duration is 3.5s → orbit only reaches ~204 radius before timer expires
- Boost energy drain during coil: 40/sec drain, 2.5s max → bot likely runs dry mid-coil on long coils
- Defensive bots: threat threshold ≥ 0.85 size ratio → at game start (all 3 segments) almost every snake triggers flee
- Passive bots: 4% chance per frame for ±90° hard turn ≈ erratic direction change every ~1.7s

---

## Session 3 — Live Testing + Hunt Preference System (2026-03-26)

### Live testing (headless observer)
Built and ran a `bot-observer.mjs` Node.js script (now deleted — was a test tool only) that:
- Connected to local server as a human player (auto-reconnected on death)
- Decoded msgpack tick snapshots and tracked all bot positions/headings
- Inferred bot behaviour per-frame: COILING, CHASING, FLEEING, wandering
- Logged all kills with timestamps and killer names

**Findings from 3 runs (120s each):**
- Kills firing at ~5–6/min — confirmed kill mechanic works ✓
- Coiling detected from tick 2 (within 2 seconds of game start) ✓
- Bot-on-bot kills: 0 across all runs — root cause: 5 bots in 3000-radius arena rarely come within 1200 units of each other once they spread out; all kills were on the human observer respawning nearby
- Discovered: `World.ts` line 154 `hasAliveHumanSnake()` pauses the entire game loop when no human alive — intentional CPU save, not a bug

### 14. BotAI — Hunt Preference System (session 3, 2026-03-26)
**File**: `server/src/game/BotAI.ts`

**Problem**: All bots anchored to human player and strongly preferred killing humans (+380/+160 score bonus). No bot-on-bot kills ever occurred.

**Changes made:**

Added `huntPreference: "human" | "bot" | "any"` to `BotBrain` type.

Assigned in `getBrain()` on spawn:
- **Aggressive** (40% of bots): 50% `"human"`, 50% `"bot"`
- **Defensive** (38%): 70% `"any"`, 30% `"bot"`
- **Passive** (22%): always `"any"` (irrelevant — passive bots never hunt)

`selectPreyTarget()` updated with `huntPreference` param:
- `"human"` bots: skip bot targets entirely, keep existing +380/+160 human bonus
- `"bot"` bots: skip human targets, get +200 score bonus for bot targets, 1.6× chase radius (bots spread out), no anchor pull penalty
- `"any"` bots: consider both, reduced human bonus (+120/+80 instead of +380/+160)

`anchorHead` override at top of `update()`:
```typescript
const anchorHead = brain.huntPreference === "bot" ? null : context.anchorHead;
```
Bot-hunters get `null` anchor everywhere — wander angle, orb selection, safe heading, rollout scoring — so they roam the arena freely instead of clustering around the human.

Anchor leash check also skipped for bot-hunters (line 228).

Build: clean (`tsc` passes).

**Note on bot-on-bot kill frequency**: With 5 bots and `findNearbySnakes()` radius = 1200 units in a 3000-radius arena, inter-bot encounters remain infrequent in solo play. With multiple real players, bot density near players increases and bot-on-bot kills will occur naturally.

---

## Current State (as of 2026-03-26, end of session 3)

### Committed (not yet deployed)
All session 2 + session 3 changes are committed. Latest commit: `f61d5ed` — "Add hunt preference system: bots now split between hunting humans and other bots". `World.ts` is unchanged. Build is clean.

### What should now work
- Bots hunt from game start (same-size hunting unlocked)
- Aggressive bots enter `coil_trap` when within 360 units of prey, spiral inward to trap
- Bots don't flee from their own prey (preyId suppression in proximity escape + immediate threat)
- Bots commit to hunt even when other snakes are nearby (hunt-mode threat leniency)
- Kills fire when coiled prey's head runs into the bot's body (standard collision mechanic)
- ~50% of aggressive bots hunt other bots; ~20% of defensive bots hunt other bots
- Bot-hunters roam freely (no human anchor) to find targets across the arena

### Still needs verification (deploy + observe)
- Are aggressive bots visibly circling prey?
- Bot-on-bot kills visible with multiple real players in the same room
- Boost energy drain during coil — may drain too fast on long coils
- Feel of mixed hunt targets: does it create variety or just reduce human threat?

### Known limitations
- No persistence / accounts — scores are session-only
- Passive bots (10%) never hunt — by design
- Bots can be outrun: same boost speed = coil wins by geometry not raw chase
- Bot-hunters may grow large unchecked (no human targeting them, other bots too spread out to kill them)

---

## Session 4 — Behavior Alignment + Sensor Intensification (2026-03-26)

### Context
User requested stronger “real-bot-like” behavior:
- Aggressive: erratic boost, erratic cut-off chase, and coiling finishers
- Defensive: very strong sensing, immediate predator-avoid, and tightening counter-coil when trapped

### Changes implemented (`server/src/game/BotAI.ts`)
- Personality distribution updated to:
  - Aggressive 45%
  - Defensive 45%
  - Passive 10%
- Added stronger sensors for both aggressive and defensive personalities:
  - Aggressive threat radius multiplier raised (high but below defensive)
  - Defensive threat radius multiplier widened further
- Aggressive hunt behavior upgraded:
  - Lateral cut-off bias during prey intercept
  - Extra erratic steering offset while chasing
  - Bursty erratic boost pulses with safety gating (`isAngleThreatened`)
  - Coil trap remains close-range finisher
- Defensive emergency behavior upgraded:
  - Immediate break-off evade when predator closing strength is positive
  - Immediate defensive boost if available
- Defensive trapped behavior upgraded:
  - Added `computeDefensiveCounterCoilAngle()`
  - Defensive bots counter-coil when surrounded
  - Coil radius tightens dynamically as surrounding ring tightens

### Sensor model intensification (from PDF-driven insights)
Reference analyzed: `Slither.io Deep Learning Bot.pdf` (2017, extracted locally).

Applied signal changes:
- Added explicit 3-band sensor model:
  - Near (`<= 260`)
  - Mid (`<= 540`)
  - Far (`> 540`)
- Added shared `sensorBandMultiplier()` and used it in:
  - Angular threat-bin weighting
  - Immediate threat ranking
  - Proximity escape weighting
- Upgraded `findImmediateThreat()` from nearest-distance to composite risk scoring:
  - Distance band
  - Closing strength
  - Size ratio
- Increased projected-head risk weighting and lookahead when enemies are closing
- Increased defensive panic triggering in mid range when closure is positive

### Validation
- Build verified clean after each tuning pass:
  - `npm run build --workspace server` ✅

### What still needs live gameplay verification
- Aggressive cut-off quality:
  - Do aggressive bots reliably cross prey lines instead of tail-following?
- Defensive anti-predator timing:
  - Do defensive bots break off early enough without over-fleeing?
- Defensive counter-coil quality:
  - Does tightening feel intentional and survivable, not jittery?
- Sensor sensitivity:
  - Check for overreaction/noise in crowded fights (possible false positives from strong near-band gains)

---

## Session 5 — User Feedback Tuning Pass (2026-03-26)

### Feedback addressed
- Bots not cutting off humans enough
- Human targeting too weak
- Map felt too small / boundary felt visually early
- Bot count too low
- Boost usage dropping after initial bursts
- Spawned snakes sometimes crashed immediately
- Boost visuals missing slither-style white glow

### Changes implemented
- Bot pressure and spawn safety:
  - `MIN_ACTIVE_SNAKES`: 6 → 10
  - Added spawn safety validation (`isSpawnSafe`) and increased spawn retry attempts
  - Adjusted human/bot spawn distance bands to reduce instant spawn collisions
- Aggression/hunt behavior:
  - `MIN_HUNT_SEGMENTS`: 10 → 3 (bots can hunt from spawn)
  - Stronger human bias in `huntPreference` assignment
  - Increased human target scoring and human chase radius multiplier
  - Increased `COIL_ENGAGE_RADIUS`: 360 → 420
  - Increased hunt/wander boost trigger rates
- Boost feel and visuals:
  - Boost economy tuned: drain 40 → 34, regen 22 → 26
  - Added boosted-snake white inner segment glow in client renderer
- Arena feel:
  - `ARENA_RADIUS`: 3000 → 3600
  - `MAX_ORBS`: 1500 → 2200 (density compensation)
  - Hex background now clipped inside true boundary zone to reduce “dies before wall” perception
- Networking/state:
  - Added `SnakeState.boosting` and server serialization so client can render boost glow consistently

### Validation
- `npm run build --workspace shared` ✅
- `npm run build --workspace server` ✅
- `npx tsc -p client/tsconfig.json --noEmit` ✅
- Note: `vite build` still fails in this environment with `spawn EPERM` (tooling/runtime permission issue, not TS type errors).

---

## Session 6 — Dev Reliability + State Addendum (2026-03-27)

### What was added
- EADDRINUSE recovery improvements:
  - Added `server.on("error")` handling in `server/src/index.ts` for clearer `EADDRINUSE` diagnostics.
  - Added `scripts/free-port.mjs` to kill any process listening on a target port (default used: `9001`).
  - Wired `server/package.json` with:
    - `"predev": "node ../scripts/free-port.mjs 9001"`
  - Result: server dev startup now frees stale listeners first, reducing “old process still serving old code” confusion.

### Verification performed
- `npm run predev --workspace server` reports port cleanup status correctly.
- `npm run build --workspace shared` ✅
- `npm run build --workspace server` ✅
- `npx tsc -p client/tsconfig.json --noEmit` ✅

### Reverted / excluded by request
- A screenshot-driven visual styling pass (snake bevel styling, orb drift/thickness, heavier death-mass orb spawning) was applied briefly and then fully reverted.
- This plan intentionally excludes that reverted pass from active-state guidance.

### Effective current state (active)
- Bot behavior stack includes sessions 4–5 changes (sensor intensification + aggressive/defensive behavior alignment + spawn safety + increased bot count + human-target bias + boost economy tuning).
- Arena and balance updates from session 5 remain active:
  - `ARENA_RADIUS = 3600`
  - `MAX_ORBS = 2200`
  - `MIN_ACTIVE_SNAKES = 10`
  - `MIN_HUNT_SEGMENTS = 3`
- Boost state propagation and boost glow support remain active (`SnakeState.boosting`).

---

---

## Session 7 — slither.io Realignment + Visual Overhaul (2026-03-27)

### Context
User clarified game is a **slither.io reskin** (not snake.io). Research confirmed slither.io bots are predominantly passive food collectors with a minority of active hunters. Session 5's aggressive settings (45/45/10, MIN_HUNT_SEGMENTS=3) were reverted.

### Bot behaviour changes (`server/src/game/BotAI.ts`)

**Personality distribution restored to slither.io feel: 25% aggressive / 35% defensive / 40% passive**

- `MIN_HUNT_SEGMENTS`: 3 → 10 (bots eat orbs first, grow, then hunt)
- Personality roll: `< 0.45/< 0.90` → `< 0.25/< 0.60`
- **Aggressive**: evade duration 500ms (was 1300ms) for non-panic threats → quick dodge, snap back to hunt; `threatHoldUntilMs` 600ms (was 1700ms); hunt preference 60% human / 40% bot; lateral cut-off + erratic offset kept; coil trap kept
- **Defensive**: skip hunt chance 40% → 60%; prey threshold 0.95 → 0.75 (only clearly smaller targets); chase radius 1.0× → 0.75×; human detection boost removed (aggressive-only now); hunt preference 25% human / 50% any / 25% bot; evade duration stays 1300ms
- **Passive**: unchanged — never hunt, smooth orb collector, zoned-out state
- Anchor tightened: hard leash 1050→780, soft leash 760→520, stay radius 580→360, follow chance 28%→50% (bots cluster near human player)
- Boost rates raised across all reasons: evasion 0.42→0.60, hunt 0.88→0.94, collect 0.58→0.72, wander 0.22→0.38

**Bugs fixed (4 bugs from session 3 audit, 2 bugs from Codex review):**
- preyId race: selectPreyTarget pre-called before computeProximityEscape
- Coil state leak: coilRadius/coilDirection cleared on exit
- Steering noise in recovery: applySteeringNoise skipped during trapped_survival/body_avoid
- Coil pivot jitter: pivot lerps toward prey head at 6×/sec
- Defensive chase radius was 1.24× for humans due to 1.65× human boost applying to all personalities — now aggressive-only
- Proximity escape path was unconditionally setting 1700ms threatHold for aggressive bots — fixed to 600ms

**Dead code removed:**
- `lastTargetDistance`, `bestTargetDistance`, `noProgressSeconds` fields + all assignments
- `selectTargetOrb()` function (defined but never called)

### Visual overhaul (`client/`)

**SnakeRenderer.ts:**
- 3D specular highlight on every segment + head (bright offset circle upper-left → shiny ball look)
- Stripe banding 1.5 segs → 3 segs per stripe (cleaner, less flickering)
- Themes expanded 4 → 12 (sky blue, forest green, orange-red, purple, pink, amber, teal, red, lime, natural tan, cyan, slate)
- Eye shine dot added to pupils
- Name label uses stroke for legibility

**OrbRenderer.ts:**
- Replaced stacked PIXI circles with `canvas.createRadialGradient()` for smooth glow falloff
- 6-stop gradient: solid white core → transparent edge
- Gentle per-orb drift animation (sin/cos offset, seed from orb ID)
- Death orbs drift 2× more than common orbs
- Dropped `renderer` param (canvas-based, no PIXI renderer needed)

**GameScene.ts:**
- Hex grid simplified to single dark tile layer (`0x0d1119`) on `0x05070a` background — removed blue inner tint that made hexes too vivid

### Current state (end of session 7)
All changes committed and pushed to `main`. Render auto-deploys server; Vercel auto-deploys client.

Latest commits:
- `16125fb` — Tighten bot anchor to human + boost more often
- `904284c` — Fix two issues flagged by Codex review
- `e588c16` — Restore slither.io bot personality adherence
- `65ad98a` — Fix hex grid darkness and orb glow/drift
- `f3947fb` — Visual overhaul: 3D snake segments, 12 themes, better orb glow, hex floor
- `5c7b06d` — Rebalance bot behaviour to match real slither.io feel

### Known limitations
- No persistence / accounts — scores are session-only
- Passive bots (40%) never hunt — by design
- Bot-hunters may grow large unchecked
- Orb drift is client-side cosmetic only (positions not synced back to server)

---

## Session 8 — Orb White-Core Fix (2026-03-27)

### Problem
The previous orb renderer used a single all-white radial gradient texture tinted with `orb.color` via PIXI. Because PIXI tint multiplies: `white × color = color`, the center of every orb was rendered as the orb's color — not white. The "hot white core" visible in real slither.io orbs was missing entirely.

### Root cause
`PIXI.Particle.tint` is a multiplicative operation on the texture RGB. A white texture tinted with any color becomes that color uniformly — there is no way to preserve a white center using a single tinted texture.

### Fix (`client/src/game/OrbRenderer.ts`)
Replaced the single-texture + tint approach with a **two-layer render**:

1. **Glow layer** (`glowContainer`, 192px texture, tinted with `orb.color`):
   - Gradient peaks at 30% radius (not at center) so the colored ring wraps *around* the white core
   - Stops: 0.00=0.40α → 0.15=0.85α → 0.30=1.00α (peak) → 0.50=0.60α → 0.70=0.22α → 0.88=0.05α → 1.00=0.00α

2. **Core layer** (`coreContainer`, 64px texture, always `tint=0xFFFFFF`):
   - Tight bright white gaussian drawn on top of the glow
   - Never tinted — always pure white regardless of orb color
   - Stops: 0.00=1.00α → 0.28=0.95α → 0.58=0.40α → 0.82=0.08α → 1.00=0.00α

Both layers share the same position + drift + pulse values so they move as one.

**Scale**:
- Glow: `(orb.size / 10) × 0.52` on 192px → ~100px rendered diameter
- Core: `(orb.size / 10) × 0.22` on 64px → ~14px rendered diameter

**Result**: White hot center → colored ring → soft diffuse bloom, matching the orb appearance in the reference screenshot.

Build: `npx tsc -p client/tsconfig.json --noEmit` ✅

### Session 8 addendum — Additive blend mode
Set `blendMode = "add"` on both `glowContainer` and `coreContainer`.
Additive blending adds the orb's light on top of the scene (`result = src + dst`) instead of covering it, so the glow halos brighten the hex tiles beneath and overlapping orbs stack naturally — matching the slither.io light-emission look.
Build: ✅

---

## Files Most Likely to Need Changes
- `server/src/game/BotAI.ts` — AI behaviour tuning
- `server/src/game/World.ts` — game loop, bot spawn/respawn, context assembly
- `client/src/game/GameScene.ts` — interpolation, snapshot buffer, background
- `client/src/game/SnakeRenderer.ts` — visual rendering of snakes
- `client/src/game/OrbRenderer.ts` — orb glow and drift
- `shared/constants.ts` — game balance values

## Recent Commits
| Hash | Message |
|------|---------|
| `16125fb` | Tighten bot anchor to human + boost more often |
| `904284c` | Fix two issues flagged by Codex review |
| `e588c16` | Restore slither.io bot personality adherence |
| `65ad98a` | Fix hex grid darkness and orb glow/drift |
| `f3947fb` | Visual overhaul: 3D snake segments, 12 themes, better orb glow |
| `5c7b06d` | Rebalance bot behaviour to match real slither.io feel |
| `f61d5ed` | Add hunt preference system: bots now split between hunting humans and other bots |
