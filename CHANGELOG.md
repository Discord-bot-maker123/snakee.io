# Changelog

## 2026-03-25

- Fixed bot AI: rebalanced personality distribution to 40% aggressive / 38% defensive / 22% passive (was 28/30/42) so predator bots dominate the ecosystem.
- Fixed bot-vs-bot hunting: raised prey score threshold from -120 to -280 so bots can chase other bots at normal ranges (200–400px) without the hunt being silently cancelled.
- Fixed defensive bots being nearly non-aggressive: hunt skip chance reduced from 85% to 55%; defensive bots now also detect nearby humans from a slightly wider radius before deciding whether to hunt.
- Fixed evasion boost triggering too late: `EVASION_BOOST_MIN_DISTANCE` raised from 260 to 520 so bots start boosting away from threats much earlier.
- Fixed cornered bots not backtracking: `EVASION_BACKTRACK_THRESHOLD` reduced from 1.05 s to 0.62 s so course-reversal triggers before collision rather than after.
- Fixed trap detection threshold too high: `HAZARD_TRAP_SCORE` lowered from 11.0 to 8.5 so surrounded bots enter survival mode more reliably.
- Fixed passive zoned-out bots walking straight into death: added `panicOverride` so panic-close threats (<450 px) still trigger evasion even during zoned-out periods.
- Extended aggressive bot hunt boost range from 1200 to 1800 px so bots keep boosting throughout the full chase instead of coasting at medium range.

- Added three-tier orb system: common (size 4, value 1, 65% weight), uncommon (size 10, value 3, 25%), and rare (size 18, value 7, 10%) orbs now spawn with weighted random selection; tail growth now scales with orb value instead of orb count.
- Added visual distinction to orbs by tier: rare orbs throb with larger pulse amplitude, faster pulse speed, and higher brightness; common orbs pulse subtly.
- Added bot personality system: each bot is assigned aggressive (28%), defensive (30%), or passive (42%) on spawn, controlling threat detection radius, hunting behaviour, boost aggression, and evasion response.
- Aggressive bots now use an intercept mechanic: instead of chasing the prey's current position, they aim ahead along the prey's heading to cut across their path.
- Bots now prioritise human players as prey: human targets receive a large score bonus (+380 for aggressive, +160 for others) and are detectable from 1.45× further away than bot targets.
- Defensive bots will opportunistically hunt a nearby human player even if their normal hunt-skip roll would suppress hunting.
- Rolled back movement/interpolation jitter experiments and restored core movement/network files to their pre-jitter-tuning baseline (`e746b28`) after repeated gameplay spike reports.

## 2026-03-24

- Fixed client-side interpolation jitter by implementing a 100ms render buffer and stable render clock synchronized with server time.
- Resolved "vanishing tail" flicker during growth/shrink events by using `Math.max` and segment extrapolation in `interpolateSnake`.
- Refreshed project logs with a current-state documentation pass to reduce drift between implementation and notes.
- Added `docs/PROJECT_DOCUMENTATION.md` with an end-to-end architecture reference covering monorepo layout, runtime flow, game loop, networking protocol, auth/stats integration, and deployment/build workflow.
- Recorded current operational notes in docs, including known architecture deltas to track (for example: `ws` currently used on server transport while `Rules.md` still states `uWebSockets.js`).
- Fixed bot mass-awareness wiring for non-collision mass drops by registering bot mass clusters whenever `World.removeSnake(..., dropMass=true)` emits segment mass.
- Removed post-safety random boost wobble from bot steering, so final movement headings stay aligned with hazard-validated safe angles.
- Added explicit bot boost energy awareness (`Snake.canStartBoost()`), and gated all bot boost triggers/holds on actual available energy + segment eligibility.
- Fixed server tick pacing regression that could present as periodic slow-motion by moving world stepping to a fixed-step accumulator with bounded catch-up (stable simulation rate under timer stalls).
- Fixed interpolation spike pattern on bursty networks by replacing single pending-tick overwrite with an ordered tick queue, allowing client interpolation to consume snapshots progressively instead of jumping to the newest tick.
- Fixed client-side jitter regression by stopping full queue drains per frame, applying bounded tick catch-up (`MAX_TICKS_APPLIED_PER_FRAME`), and restoring a stable interpolation clock based on `Date.now() - delay`.
- Further smoothed interpolation by applying at most one queued server tick per render frame, removing periodic micro-jerks caused by multi-tick catch-up in a single frame.

## 2026-03-23

- Added Supabase-based account integration with optional Google sign-in and guest mode fallback in the start menu.
- Added server-side token verification for websocket sessions (via query token), with authenticated players mapped to persistent profile identities.
- Added authenticated HTTP endpoints for profile/stats (`GET /api/me`, `PATCH /api/me`) and all-time leaderboard (`GET /api/leaderboard/all-time`).
- Added persistent cloud stats updates on authenticated player death (games played, total score, best score/length, last played).
- Added initial Supabase SQL bootstrap script (`scripts/supabase_schema.sql`) covering `profiles`, `player_stats`, trigger, and RLS policies.
- Fixed bot steering loops that caused orbit-lock behavior by introducing stateful bot modes (`seek_orb`, `wander`, `recover`) and stuck recovery in server bot AI.
- Added opt-in runtime bot diagnostics behind `BOT_DEBUG_LOGS=1` for mode changes, stuck detection, and target resets.
- Updated `Rules.md` with explicit anti-circling bot requirements, stateful steering guidance, and project-log maintenance policy.
- Tightened seek-mode steering to avoid endless orbiting around close targets by adding no-progress orbit-break recovery and limiting rapid target-angle rewrites.
- Updated spawn selection so human players spawn near active snakes and new bots preferentially spawn near humans to keep nearby encounters consistent.
- Added a player-anchor vicinity model: each bot now references the nearest human head, stays within leash distance, and biases wander/seek around that anchor so bots remain near player camera space more consistently.
- Fixed stale bot AI memory buildup by deleting bot brain state on bot removal/death.
- Changed bot spawn policy to always anchor near a human when humans are present (instead of probabilistic 85% behavior).
- Updated death messaging payload/UI to include `killerName`, so crash screen shows readable snake names instead of raw ids when available.
- Restyled snake rendering to match the provided reference more closely: each snake now uses one stable two-color theme (shared across snakes), with a thicker body profile and a larger white cartoon head/eyes.
- Applied the selected "Bioluminescent Deep Sea" frontend direction to HUD/menu/death overlays: organic bubble-like panels, sea-tone palette, softer motion, and "REABSORBED" death presentation.
- Fixed menu play-flow regression from frontend restyling by restoring `.menu-hidden` behavior and menu overlay layering (`menu-rays` + centered z-order), so clicking Play properly removes the menu.
- Added classic fast-move mass shedding: while boosting, snakes now periodically drop small tail orbs and lose tail segments, creating a speed-vs-size tradeoff.
- Added a boost lock rule for both players and bots: after a snake grows beyond a configured orb-gain threshold from starting size, boost input is ignored.
- Fixed boost-lock regression by switching the lock condition to lifetime `orbsEaten` (stable progression metric) and raising the default threshold.
- Reworked boost gating to size-based rules: boost can start at 6+ segments and mass shedding now stops at the hard 3-segment minimum.
- Fixed boost shedding burst behavior by clearing inactive boost timers (no time banking), and tuned shedding to one orb per second while boosting.
- Upgraded bot survival AI: bots now detect nearby large snakes (2x length rule), evade instead of charging into them, and switch to trapped-circling behavior when surrounded by threats.
- Replaced head-only bot threat detection with segment hazard mapping so bots avoid enemy bodies/tails, reducing kamikaze tail-follow deaths.
- Fixed bot hazard modes so `body_avoid` and `trapped_survival` persist for their configured durations instead of immediately falling back into orb-seeking on the next tick.
- Refined bot behavior toward human-like survival play: proximity-based threat evasion (all nearby snakes, stronger for larger ones), danger-first boost usage with cooldown, smooth non-linear steering noise, prey-vs-mass target balancing, and queued safe mass collection.
- Introduced a lightweight model-based bot planner (feature-scored rollout over candidate actions) so steering/boost decisions are selected via short-horizon utility scoring instead of only rule-branches.
- Added a hard proximity-escape layer: bots now immediately choose a safer heading away from nearby snakes (all snakes, size-weighted), with more reliable danger boost activation during close escapes.
- Added bot-mode idle optimization: when no human snake is alive, world simulation work is paused (bots stop acting) until a human rejoins; also reduced per-tick overhead by optimizing leaderboard generation and skipping broadcast work when no clients are connected.
- Fixed weak bot boost usage: bots can now start boost at a lower bot-specific segment threshold, and danger-mode boost triggers were relaxed so close-threat escapes use boost more reliably.
- Bot behavior polish pass from evaluation: increased threat alert radius for faster reaction, moved steering noise before safety validation, added trapped-survival breakout boost after prolonged circling, increased hazard sampling resolution, and introduced orb spatial filtering so bots only score nearby visible orbs.
- Increased bot boost frequency: reduced boost cooldown windows, relaxed danger-trigger thresholds, and enabled opportunistic boost usage during hunt/collect/wander phases.
- Tuned boost movement to be more erratic: boosted paths now add stronger wobble, shorter cooldowns, and more frequent boost bursts across escape, hunt, collect, and wander states.
- Improved bot mass gathering by registering recent death-mass clusters and steering toward dense orb hotspots instead of only chasing individual orbs.
- Further tuned boost dynamics so bot boosts hold for short bursts instead of flickering per tick, with stronger wobble while boosted and shorter reuse cooldowns.
