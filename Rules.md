# rules.md — Agent Behavior Rules for snakee.io

This file defines how the coding agent must behave when building and maintaining snakee.io. Read this file before taking any action. Follow these rules strictly and consistently.

---

## 1. General Conduct

- **Read before you write.** Before modifying any file, read its current content in full.
- **One step at a time.** Complete the current phase step fully before moving to the next. Do not skip steps or implement future features speculatively.
- **No orphan code.** Every function, class, and module you create must be wired up and reachable. Do not leave dead code in the codebase.
- **No placeholder comments.** Never write `// TODO`, `// implement later`, or stub functions unless explicitly told to. If something is needed, build it now or flag it clearly before stopping.
- **Verify before proceeding.** After completing a step, confirm it works (TypeScript compiles, no runtime errors, expected behavior visible) before starting the next step.

---

## 2. File & Architecture Rules

- **Respect the structure.** Files must be created at the paths defined in the project structure. Do not invent new directories or restructure without explicit instruction.
- **Shared types are canonical.** All data structures shared between client and server live in `shared/types.ts` only. Never duplicate type definitions in client or server code.
- **No circular imports.** The dependency graph must flow: `shared → server`, `shared → client`. Server and client must never import from each other.
- **One responsibility per file.** Each file does one thing (e.g., `Camera.ts` only handles camera logic). Do not merge unrelated concerns.
- **Keep `index.ts` thin.** Entry point files wire things together. Business logic belongs in dedicated modules.

---

## 3. Technology Constraints

- **Renderer: PixiJS only.** All game visuals are rendered through PixiJS. Do not use Canvas 2D API (`ctx.fillRect`, etc.) directly for game rendering. DOM elements are allowed only for HUD overlays.
- **WebSocket: uWebSockets.js only.** Do not introduce Socket.io, ws, or any other WebSocket library on the server. uWS is the chosen transport.
- **Serialization: msgpackr only.** All WebSocket messages are binary-encoded with msgpackr. Do not use `JSON.stringify` for game state messages.
- **Bundler: Vite only.** Do not introduce Webpack, Rollup, or esbuild separately.
- **No game frameworks.** Do not use Phaser, Babylon.js, Three.js, or any full game engine. PixiJS is the renderer; all game logic is custom.
- **TypeScript everywhere.** All source files must be `.ts` or `.tsx`. No `.js` files in `src/` directories.

---

## 4. Performance Rules

- **ParticleContainer for orbs.** Orbs must use `PIXI.ParticleContainer`, not `PIXI.Container`. This is non-negotiable for performance at orb counts > 500.
- **Spatial hashing for collision.** Never use nested loops to check snake-vs-snake collisions. The spatial hash grid in `Collision.ts` must be used from Step 19 onward.
- **Delta updates only.** The server must never broadcast full world state to all clients every tick after Step 12. Only changed entities are sent.
- **Viewport culling.** After Step 20, the server must not send data about entities outside a client's visible area.
- **No synchronous blocking in the game loop.** The server tick loop in `World.ts` must not contain any synchronous I/O, blocking operations, or long-running computations. If heavy work is needed, defer it.
- **Measure before optimizing.** If you identify a performance issue, log the timing first. Do not prematurely optimize code that is not yet a bottleneck.

---

## 5. Networking Rules

- **Client-side interpolation is mandatory.** The client must never snap snake positions to server-received values directly. Always interpolate between the two most recent server states.
- **Input rate: 30Hz.** The client sends input to the server at a maximum of 30 messages per second. Do not send input on every render frame.
- **Handle disconnection gracefully.** When a client disconnects, remove their snake from the world immediately and clean up all references. No memory leaks.
- **Validate all input on the server.** Never trust client-sent values for position, score, or size. The server is the authority on all game state.

---

## 6. Code Quality Rules

- **No `any` types.** TypeScript's `any` is forbidden unless there is a documented, unavoidable reason. Use `unknown` and narrow properly.
- **Prefer explicit over implicit.** Use explicit return types on all functions. Do not rely on inference for public APIs.
- **Error handling is required.** WebSocket `message` handlers, JSON/msgpack parsing, and async operations must have try/catch or error callbacks. Silent failures are not acceptable.
- **No magic numbers.** Game constants (arena radius, max orb count, tick rate, boost speed, etc.) must be defined in a single `shared/constants.ts` file and imported wherever needed.
- **Comment the non-obvious.** Do not comment what code does — comment *why* it does it, when the reason is not self-evident. Spatial hashing, interpolation math, and angular wrapping logic must have explanatory comments.

---

## 7. Rendering Rules

- **60fps is the target.** The client render loop must run at the display's refresh rate using PixiJS's built-in ticker. Do not use `setInterval` for rendering.
- **Recycle display objects.** When snakes die or orbs are consumed, do not destroy and recreate `PIXI.Graphics` objects. Pool and reuse them.
- **Layer order matters.** PixiJS containers must be organized in defined layers (background → orbs → snakes → effects → UI). Do not add children to the wrong container.
- **No layout calculations in the render loop.** HUD DOM element positions must be set via CSS, not computed with JavaScript on every frame.

---

## 8. Bot AI Rules

- **Bots are server-side only.** Bot logic lives exclusively in `server/src/game/BotAI.ts`. No bot simulation on the client.
- **Bots use the same Snake interface.** Bots are `Snake` instances just like players. They receive no special privileges in the collision or movement systems.
- **Bot count scales with player count.** Maintain a minimum of 10 active snakes (bots + players) in the world at all times. Spawn bots to fill the gap when players are few.
- **Basic bots first.** Implement Step 17 (basic wandering + orb seeking) fully before adding Step 18 (coiling traps, fleeing). Do not blend the two steps.
- **No orbit-lock behavior.** Bots must not keep circling in a tight area indefinitely; include stuck detection and recovery steering.
- **Steering must be stateful.** Bots should hold short-lived movement intents (seek/wander/recover) rather than retargeting every tick with noisy angle jitter.
- **Debug logs must be gated.** Bot diagnostics are allowed only behind an explicit runtime toggle (for example `BOT_DEBUG_LOGS=1`) to avoid noisy default output.

---

## 9. Git Hygiene (if version control is used)

- **Commit per step.** Make one commit per completed build step with a message like `feat: Step 4 - snake body rendering`.
- **Never commit broken code.** The `main` branch must always be in a runnable state. Use a feature branch if a step is multi-session.
- **No generated files in git.** Add `node_modules/`, `dist/`, and `.env` to `.gitignore` immediately.

---

## 10. When Stuck or Uncertain

- **Stop and report.** If a step is ambiguous, a dependency is missing, or an approach has trade-offs that weren't anticipated, stop and describe the issue clearly before writing code.
- **Propose, don't assume.** If there are multiple valid approaches to a problem, present the options with brief trade-offs and wait for direction.
- **Never silently change the tech stack.** If you believe a different library or approach is better than what's specified, flag it explicitly. Do not swap out a dependency without approval.
- **Reference this file.** If you are unsure whether an action is allowed, check rules.md first. If it is not covered here, ask.

---

## 11. Project Log

- **Maintain `CHANGELOG.md`.** Record meaningful behavior changes, bug fixes, and policy updates with date-stamped entries.
- **Prefer high-signal entries.** Log what changed and why; avoid dumping internal experimentation details.

---

*Last updated: 2026-03-23 (bot stability + project log policy). This file should be updated when architectural decisions change.*
