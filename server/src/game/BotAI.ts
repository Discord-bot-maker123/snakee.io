import { ARENA_RADIUS, SNAKE_BASE_SPEED } from "snakee-shared/constants";
import type { OrbState, Vec2 } from "snakee-shared/types";
import { Snake } from "./Snake.js";

type BotMode = "seek_orb" | "wander" | "recover" | "body_avoid" | "trapped_survival" | "evade_threat" | "pursue_prey";

type BotPersonality = "aggressive" | "defensive" | "passive";

export type SegmentHazard = {
  point: Vec2;
  weight: number;
};

type BotContext = {
  anchorHead: Vec2 | null;
  segmentHazards: SegmentHazard[];
  nearbySnakes: NearbySnake[];
};

export type NearbySnake = {
  id: string;
  head: Vec2;
  heading: Vec2;
  length: number;
  isBot: boolean;
};

type BotBrain = {
  mode: BotMode;
  personality: BotPersonality;
  modeEnteredAtMs: number;
  modeUntilMs: number;
  committedAngle: number;
  modeAnchor: Vec2;
  targetOrbId: string | null;
  nextRetargetAtMs: number;
  boostCooldownMs: number;
  lastHead: Vec2;
  stuckSeconds: number;
  lastTargetDistance: number | null;
  bestTargetDistance: number | null;
  noProgressSeconds: number;
  trappedDirection: 1 | -1;
  trappedSeconds: number;
  threatHoldUntilMs: number;
  escapeLoopDirection: 1 | -1;
  massQueue: string[];
  steeringNoisePhase: number;
  boostHoldUntilMs: number;
  // Passive bots skip smart decisions on some frames
  passiveSkipUntilMs: number;
};

type SafeHeading = {
  angle: number;
  trapped: boolean;
  hazardous: boolean;
  bestScore: number;
};

type ThreatInfo = {
  snake: NearbySnake;
  distance: number;
  closingStrength: number;
};

type MassHotspot = {
  x: number;
  y: number;
  score: number;
  orbCount: number;
};

type MassCluster = {
  x: number;
  y: number;
  score: number;
  expiresAtMs: number;
};

type PlannedAction = {
  angle: number;
  boost: boolean;
  reason: "evade" | "collect" | "hunt" | "stabilize";
};

type ProximityEscape = {
  angle: number;
  danger: number;
  panic: boolean;
};

const BOT_DEBUG_LOGS: boolean = process.env.BOT_DEBUG_LOGS === "1";
const ANCHOR_HARD_LEASH = 1050;
const ANCHOR_SOFT_LEASH = 760;
const ANCHOR_STAY_RADIUS = 580;
const ANCHOR_FOLLOW_CHANCE = 0.28;
const THREAT_ALERT_RADIUS = 1100; // Increased from 760
const THREAT_PANIC_RADIUS = 450; // Increased from 280
const PREY_CHASE_RADIUS = 900; // Increased from 700
const PROXIMITY_ESCAPE_RADIUS = 500; // Increased from 340
const THREAT_HOLD_MS = 1700;
const EVASION_BOOST_MIN_DISTANCE = 260;
const EVASION_BACKTRACK_THRESHOLD = 1.05;
const BOOST_HOLD_MS = 650;
const BOOST_EVASION_TRIGGER_CHANCE = 0.42;
const BOOST_HUNT_TRIGGER_CHANCE = 0.76;
const BOOST_COLLECT_TRIGGER_CHANCE = 0.58;
const BOOST_WANDER_TRIGGER_CHANCE = 0.16;
/* changed by gemini - more sampling for smoother avoidance */
const HAZARD_SAMPLE_DISTANCES = [60, 120, 180, 260];
const HAZARD_AVOID_SCORE = 5.5; // lower = more sensitive
const HAZARD_TRAP_SCORE = 11.0;
const PLAN_TURN_OFFSETS = [-1.3, -0.95, -0.6, -0.3, 0, 0.3, 0.6, 0.95, 1.3, Math.PI];
const PLAN_HORIZON_STEPS = 8;
const PLAN_STEP_SECONDS = 0.12;

export class BotAI {
  private readonly brains: Map<string, BotBrain>;
  private readonly massClusters: MassCluster[];

  public constructor() {
    this.brains = new Map<string, BotBrain>();
    this.massClusters = [];
  }

  public removeBot(botId: string): void {
    this.brains.delete(botId);
  }

  public registerMassCluster(segments: Vec2[]): void {
    if (segments.length === 0) {
      return;
    }

    let sumX = 0;
    let sumY = 0;
    for (const segment of segments) {
      sumX += segment.x;
      sumY += segment.y;
    }

    const now = Date.now();
    this.massClusters.push({
      x: sumX / segments.length,
      y: sumY / segments.length,
      score: Math.min(320, segments.length * 14),
      expiresAtMs: now + 14_000
    });

    if (this.massClusters.length > 60) {
      this.massClusters.splice(0, this.massClusters.length - 60);
    }
  }

  public update(bot: Snake, orbs: OrbState[], deltaSeconds: number, context: BotContext): void {
    const now = Date.now();
    const head = bot.headPosition();
    const brain = this.getBrain(bot.id, head, now);
    const anchorHead = context.anchorHead;
    const myLength = bot.segmentCount();
    const distanceFromCenter = Math.hypot(head.x, head.y);
    const nearBoundary = distanceFromCenter > ARENA_RADIUS * 0.84;
    const criticalBoundary = distanceFromCenter > ARENA_RADIUS * 0.9;
    const movedDistance = this.distance(head, brain.lastHead);
    const canBoostNow = bot.canStartBoost();

    brain.boostCooldownMs = Math.max(0, brain.boostCooldownMs - deltaSeconds * 1000);
    brain.stuckSeconds = movedDistance < 2 ? brain.stuckSeconds + deltaSeconds : Math.max(0, brain.stuckSeconds - deltaSeconds * 0.5);
    const boostHoldActive = now < brain.boostHoldUntilMs && canBoostNow;
    brain.steeringNoisePhase += deltaSeconds * (1.4 + Math.random() * 0.35);
    brain.trappedSeconds = brain.mode === "trapped_survival" ? brain.trappedSeconds + deltaSeconds : Math.max(0, brain.trappedSeconds - deltaSeconds);

    // Passive bots occasionally enter a "zoned out" state where they ignore threats and just wander
    if (brain.personality === "passive" && now >= brain.passiveSkipUntilMs && Math.random() < 0.008) {
      brain.passiveSkipUntilMs = now + 800 + Math.random() * 1400;
    }
    const passiveZonedOut = brain.personality === "passive" && now < brain.passiveSkipUntilMs;

    // Defensive bots detect threats at a wider radius; passive bots only react when very close
    const threatRadiusMult = brain.personality === "defensive" ? 1.35 : brain.personality === "passive" ? 0.55 : 1.0;
    const immediateThreat = this.findImmediateThreat(head, context.nearbySnakes, myLength, threatRadiusMult);

    if (criticalBoundary) {
      const inwardAngle = Math.atan2(-head.y, -head.x);
      this.enterMode(bot.id, brain, "recover", inwardAngle, now, 900 + Math.random() * 450, "critical boundary recovery", head);
    }

    if (!passiveZonedOut && immediateThreat && immediateThreat.distance < THREAT_ALERT_RADIUS * threatRadiusMult) {
      brain.threatHoldUntilMs = now + THREAT_HOLD_MS;
      brain.escapeLoopDirection = this.pickEscapeLoopDirection(head, immediateThreat, brain.escapeLoopDirection);
      const panicAngle = this.computeEvadeAngle(head, immediateThreat, brain, true);
        this.enterMode(
          bot.id,
          brain,
          "evade_threat",
          panicAngle,
          now,
          1300 + Math.random() * 640, // Doubled from 650
          "threat proximity evade",
          head
        );
      brain.targetOrbId = null;
      brain.lastTargetDistance = null;
      brain.bestTargetDistance = null;
      brain.noProgressSeconds = 0;
      brain.massQueue = [];
    } else if (brain.mode === "evade_threat" && now < brain.threatHoldUntilMs) {
      brain.committedAngle = this.computeEvadeAngle(head, null, brain, false);
    }

    if (anchorHead) {
      const distanceToAnchor = this.distance(head, anchorHead);
      if (distanceToAnchor > ANCHOR_HARD_LEASH) {
        const angleToAnchor = Math.atan2(anchorHead.y - head.y, anchorHead.x - head.x);
        this.enterMode(bot.id, brain, "recover", angleToAnchor, now, 900 + Math.random() * 550, "anchor leash recovery", head);
        brain.targetOrbId = null;
        brain.lastTargetDistance = null;
        brain.bestTargetDistance = null;
        brain.noProgressSeconds = 0;
      }
    }

    const modeTravel = this.distance(head, brain.modeAnchor);
    if (brain.mode !== "recover" && (brain.stuckSeconds > 1.8 || (now - brain.modeEnteredAtMs > 2600 && modeTravel < 120))) {
      const recoverAngle = this.buildRecoverAngle(head, brain.committedAngle);
      this.enterMode(bot.id, brain, "recover", recoverAngle, now, 900 + Math.random() * 500, "stuck loop recovery", head);
      brain.targetOrbId = null;
      brain.lastTargetDistance = null;
      brain.nextRetargetAtMs = now;
      this.debug(bot.id, "target reset after stuck recovery");
    }

    if (brain.mode === "recover") {
      if (now >= brain.modeUntilMs) {
        this.enterMode(
          bot.id,
          brain,
          "wander",
          this.pickWanderAngle(head, anchorHead),
          now,
          1200 + Math.random() * 800,
          "recover finished",
          head
        );
      }
      bot.setBotTarget(brain.committedAngle, boostHoldActive);
      brain.lastHead = head;
      return;
    }

    if (brain.mode === "body_avoid" || brain.mode === "trapped_survival" || brain.mode === "evade_threat") {
      if (now < brain.modeUntilMs) {
        if (brain.mode === "trapped_survival" && brain.trappedSeconds > 5) {
          const breakoutAngle = this.buildRecoverAngle(head, brain.committedAngle);
          this.enterMode(bot.id, brain, "recover", breakoutAngle, now, 900 + Math.random() * 400, "trapped breakout", head);
          const breakoutBoost = canBoostNow && (brain.boostCooldownMs <= 0 || Math.random() < 0.45);
          if (breakoutBoost) {
            brain.boostCooldownMs = 280 + Math.random() * 260;
            brain.boostHoldUntilMs = now + BOOST_HOLD_MS;
          }
          bot.setBotTarget(breakoutAngle, breakoutBoost);
          brain.lastHead = head;
          return;
        }

        const threatNow = this.findImmediateThreat(head, context.nearbySnakes, myLength);
        const goalAngle =
          brain.mode === "evade_threat" && threatNow
            ? this.computeEvadeAngle(head, threatNow, brain, true)
            : brain.mode === "evade_threat" && now < brain.threatHoldUntilMs
              ? this.computeEvadeAngle(head, null, brain, false)
              : brain.committedAngle;
        const evasiveGoalAngle =
          brain.mode === "evade_threat"
            ? this.stretchEscapeAngle(goalAngle, brain.escapeLoopDirection, brain.stuckSeconds, threatNow?.distance ?? Number.POSITIVE_INFINITY)
            : goalAngle;
        const noisyGoalAngle = this.applySteeringNoise(evasiveGoalAngle, brain.steeringNoisePhase);
        const safeHeading = this.computeSafeHeading(head, noisyGoalAngle, context.segmentHazards, anchorHead);
        if (brain.mode === "trapped_survival" || (brain.mode === "evade_threat" && safeHeading.trapped)) {
          if (safeHeading.trapped && context.segmentHazards.length > 0) {
            brain.committedAngle = this.computeTrapCircleAngle(head, context.segmentHazards, brain.trappedDirection);
          } else {
            brain.committedAngle = safeHeading.angle;
          }
          if (brain.mode === "evade_threat") {
            brain.escapeLoopDirection = brain.escapeLoopDirection === 1 ? -1 : 1;
          }
        } else {
          brain.committedAngle = safeHeading.angle;
        }

        const shouldBoostForEscape =
          brain.mode === "evade_threat" &&
          !!threatNow &&
          canBoostNow &&
          (brain.boostCooldownMs <= 0 || Math.random() < BOOST_EVASION_TRIGGER_CHANCE) &&
          threatNow.distance < EVASION_BOOST_MIN_DISTANCE &&
          threatNow.closingStrength > -0.75 &&
          !safeHeading.trapped;

        if (shouldBoostForEscape) {
          brain.boostCooldownMs = 240 + Math.random() * 240;
          brain.boostHoldUntilMs = now + BOOST_HOLD_MS;
        }

        if (brain.mode === "evade_threat" && brain.stuckSeconds > EVASION_BACKTRACK_THRESHOLD) {
          const backtrackAngle = this.wrapAngle(brain.committedAngle + Math.PI * 0.7);
          brain.committedAngle = this.wrapAngle(this.blendAngles(brain.committedAngle, backtrackAngle, 0.55));
          brain.threatHoldUntilMs = Math.max(brain.threatHoldUntilMs, now + 650);
        }

        const activeEscapeBoost = shouldBoostForEscape || boostHoldActive;
        bot.setBotTarget(brain.committedAngle, activeEscapeBoost);
        brain.lastHead = head;
        return;
      }
    }

    if (brain.mode === "evade_threat" && now < brain.threatHoldUntilMs) {
      const loopAngle = this.stretchEscapeAngle(brain.committedAngle, brain.escapeLoopDirection, brain.stuckSeconds, Number.POSITIVE_INFINITY);
      const loopBoost = canBoostNow && brain.boostCooldownMs <= 0 && Math.random() < BOOST_EVASION_TRIGGER_CHANCE * 0.72;
      if (loopBoost) {
        brain.boostHoldUntilMs = now + BOOST_HOLD_MS;
      }
      const activeLoopBoost = loopBoost || boostHoldActive;
      bot.setBotTarget(loopAngle, activeLoopBoost);
      brain.lastHead = head;
      return;
    }

    const proximityEscape = this.computeProximityEscape(head, context.nearbySnakes, myLength);
    if (proximityEscape && proximityEscape.danger > 0.02) {
      const noisyProximity = this.applySteeringNoise(proximityEscape.angle, brain.steeringNoisePhase);
      const proxSafe = this.computeSafeHeading(head, noisyProximity, context.segmentHazards, anchorHead);
      const proxAngle = proxSafe.trapped
        ? this.computeTrapCircleAngle(head, context.segmentHazards, brain.trappedDirection)
        : proxSafe.angle;
      this.enterMode(
        bot.id,
        brain,
        "evade_threat",
        proxAngle,
        now,
        600 + Math.random() * 260,
        "proximity escape heading",
        head
      );
      const proxBoost =
        canBoostNow &&
        (brain.boostCooldownMs <= 0 || Math.random() < BOOST_EVASION_TRIGGER_CHANCE * 0.43) &&
        (proximityEscape.panic || proximityEscape.danger > 0.9) &&
        !proxSafe.trapped;
      if (proxBoost) {
        brain.boostCooldownMs = 240 + Math.random() * 260;
        brain.boostHoldUntilMs = now + BOOST_HOLD_MS;
      }
      brain.threatHoldUntilMs = now + THREAT_HOLD_MS;
      brain.escapeLoopDirection = this.pickEscapeLoopDirection(head, null, brain.escapeLoopDirection);
      const activeProxBoost = proxBoost || boostHoldActive;
      bot.setBotTarget(proxAngle, activeProxBoost);
      brain.lastHead = head;
      return;
    }

    const planned = this.planLightModelAction(head, orbs, context, anchorHead, myLength, brain, nearBoundary);
    const noisyPlanned = this.applySteeringNoise(planned.angle, brain.steeringNoisePhase);
    const safeHeading = this.computeSafeHeading(head, noisyPlanned, context.segmentHazards, anchorHead);
    let finalAngle = safeHeading.angle;
    if (safeHeading.trapped) {
      finalAngle = this.computeTrapCircleAngle(head, context.segmentHazards, brain.trappedDirection);
      this.enterMode(bot.id, brain, "trapped_survival", finalAngle, now, 760 + Math.random() * 320, "planner trapped fallback", head);
    } else if (safeHeading.hazardous || planned.reason === "evade") {
      this.enterMode(bot.id, brain, "evade_threat", finalAngle, now, 620 + Math.random() * 280, "planner evasive steer", head);
    } else {
      const mode = planned.reason === "hunt" ? "pursue_prey" : planned.reason === "collect" ? "seek_orb" : "wander";
      this.enterMode(
        bot.id,
        brain,
        mode,
        finalAngle,
        now,
        mode === "wander" ? 1000 + Math.random() * 700 : 900 + Math.random() * 600,
        `planner ${planned.reason}`,
        head
      );
    }

    const shouldBoost = planned.boost && canBoostNow && brain.boostCooldownMs <= 0 && !safeHeading.trapped;
    if (shouldBoost) {
      brain.boostCooldownMs = 240 + Math.random() * 240;
      brain.boostHoldUntilMs = now + BOOST_HOLD_MS;
    }

    brain.committedAngle = finalAngle;
    const activePlanBoost = shouldBoost || boostHoldActive;
    bot.setBotTarget(finalAngle, activePlanBoost);
    brain.lastHead = head;
  }

  private enterMode(
    botId: string,
    brain: BotBrain,
    mode: BotMode,
    angle: number,
    now: number,
    durationMs: number,
    reason: string,
    anchor: Vec2
  ): void {
    if (brain.mode !== mode) {
      this.debug(botId, `mode ${brain.mode} -> ${mode} (${reason})`);
    } else {
      this.debug(botId, `mode ${mode} retarget (${reason})`);
    }

    brain.mode = mode;
    brain.modeEnteredAtMs = now;
    brain.modeUntilMs = now + durationMs;
    brain.committedAngle = angle;
    brain.modeAnchor = { x: anchor.x, y: anchor.y };
  }

  private computeSafeHeading(
    head: Vec2,
    goalAngle: number,
    hazards: SegmentHazard[],
    anchorHead: Vec2 | null
  ): SafeHeading {
    if (hazards.length === 0) {
      return { angle: goalAngle, trapped: false, hazardous: false, bestScore: 0 };
    }

    /* changed by gemini - more granular angle offsets for smoother turns */
    const offsets = [
      -1.8, -1.4, -1.0, -0.7, -0.4, -0.2, 
      0, 
      0.2, 0.4, 0.7, 1.0, 1.4, 1.8,
      Math.PI
    ];
    let bestAngle = goalAngle;
    let bestScore = Number.POSITIVE_INFINITY;
    let forwardScore = Number.POSITIVE_INFINITY;

    for (const offset of offsets) {
      const angle = this.wrapAngle(goalAngle + offset);
      const score = this.scoreHeading(head, angle, hazards, anchorHead) + Math.abs(offset) * 0.46;
      if (offset === 0) {
        forwardScore = score;
      }
      if (score < bestScore) {
        bestScore = score;
        bestAngle = angle;
      }
    }

    const trapped = bestScore >= HAZARD_TRAP_SCORE;
    const hazardous = !trapped && forwardScore >= HAZARD_AVOID_SCORE;
    return { angle: bestAngle, trapped, hazardous, bestScore };
  }

  private scoreHeading(
    head: Vec2,
    angle: number,
    hazards: SegmentHazard[],
    anchorHead: Vec2 | null
  ): number {
    let score = 0;
    for (let i = 0; i < HAZARD_SAMPLE_DISTANCES.length; i += 1) {
      const distance = HAZARD_SAMPLE_DISTANCES[i];
      const sample = {
        x: head.x + Math.cos(angle) * distance,
        y: head.y + Math.sin(angle) * distance
      };
      score += this.hazardAtPoint(sample, hazards) * (1 + i * 0.16);
    }

    const farPoint = {
      x: head.x + Math.cos(angle) * 260,
      y: head.y + Math.sin(angle) * 260
    };
    const edgeDistance = Math.hypot(farPoint.x, farPoint.y);
    if (edgeDistance > ARENA_RADIUS * 0.92) {
      score += 8 + (edgeDistance - ARENA_RADIUS * 0.92) * 0.02;
    }

    if (anchorHead) {
      const anchorDistance = this.distance(farPoint, anchorHead);
      score += anchorDistance * 0.0012;
    }

    return score;
  }

  private hazardAtPoint(point: Vec2, hazards: SegmentHazard[]): number {
    let score = 0;
    for (const hazard of hazards) {
      const dx = point.x - hazard.point.x;
      const dy = point.y - hazard.point.y;
      const distSq = dx * dx + dy * dy;
      /* changed by gemini - stronger repulsion for very close segments */
      score += (hazard.weight * 2500) / (distSq + 600);
    }
    return score;
  }

  private computeTrapCircleAngle(head: Vec2, hazards: SegmentHazard[], direction: 1 | -1): number {
    const closest = hazards
      .slice()
      .sort((a, b) => this.distance(head, a.point) - this.distance(head, b.point))[0];
    const away = Math.atan2(head.y - closest.point.y, head.x - closest.point.x);
    return this.wrapAngle(away + direction * (Math.PI / 2));
  }

  private findImmediateThreat(head: Vec2, nearbySnakes: NearbySnake[], myLength: number, radiusMult: number = 1.0): ThreatInfo | null {
    let best: ThreatInfo | null = null;
    for (const snake of nearbySnakes) {
      const dx = head.x - snake.head.x;
      const dy = head.y - snake.head.y;
      const distance = Math.hypot(dx, dy);
      if (distance > THREAT_ALERT_RADIUS * radiusMult) {
        continue;
      }

      const largerFactor = snake.length / Math.max(1, myLength);
      // Defensive bots are scared of same-size snakes too; passive bots only fear large ones
      const threatThreshold = radiusMult >= 1.35 ? 0.85 : radiusMult <= 0.55 ? 1.35 : 1.05;
      if (largerFactor < threatThreshold) {
        continue;
      }

      const toMeX = dx / Math.max(1, distance);
      const toMeY = dy / Math.max(1, distance);
      const headingTowardMe = snake.heading.x * toMeX + snake.heading.y * toMeY;
      const closingStrength = headingTowardMe + Math.max(0, largerFactor - 1) * 0.22;

      if (!best || distance < best.distance) {
        best = { snake, distance, closingStrength };
      }
    }
    return best;
  }

  private computeEvadeAngle(head: Vec2, threat: ThreatInfo | null, brain: BotBrain, backtrack: boolean): number {
    const away = threat
      ? Math.atan2(head.y - threat.snake.head.y, head.x - threat.snake.head.x)
      : Math.atan2(-head.y, -head.x);
    const direction = threat
      ? this.pickEscapeLoopDirection(head, threat, brain.escapeLoopDirection)
      : brain.escapeLoopDirection;
    const distanceFactor = threat
      ? Math.max(0, (THREAT_ALERT_RADIUS - threat.distance) / THREAT_ALERT_RADIUS)
      : 0.2;
    const loopBias = backtrack ? 0.95 : 0.45;
    const turnBias = direction * (loopBias + distanceFactor * 0.75);

    if (backtrack || (threat && threat.distance < THREAT_PANIC_RADIUS)) {
      return this.wrapAngle(away + turnBias + direction * 0.35);
    }
    return this.wrapAngle(away + turnBias * 0.7);
  }

  private pickEscapeLoopDirection(head: Vec2, threat: ThreatInfo | null, fallback: 1 | -1): 1 | -1 {
    if (!threat) {
      return fallback;
    }

    const toMeX = head.x - threat.snake.head.x;
    const toMeY = head.y - threat.snake.head.y;
    const cross = threat.snake.heading.x * toMeY - threat.snake.heading.y * toMeX;
    if (Math.abs(cross) < 0.15) {
      return fallback;
    }
    return cross > 0 ? 1 : -1;
  }

  private stretchEscapeAngle(angle: number, direction: 1 | -1, stuckSeconds: number, threatDistance: number): number {
    const stuckBias = Math.min(1.4, 0.25 + stuckSeconds * 0.45);
    const threatBias = Number.isFinite(threatDistance)
      ? Math.max(0, (PROXIMITY_ESCAPE_RADIUS - Math.min(PROXIMITY_ESCAPE_RADIUS, threatDistance)) / PROXIMITY_ESCAPE_RADIUS) * 0.9
      : 0.25;
    const loopAngle = this.wrapAngle(angle + direction * (stuckBias + threatBias));
    if (stuckSeconds > EVASION_BACKTRACK_THRESHOLD) {
      return this.wrapAngle(loopAngle + direction * 0.55);
    }
    return loopAngle;
  }

  private computeProximityEscape(head: Vec2, nearbySnakes: NearbySnake[], myLength: number): ProximityEscape | null {
    let repelX = 0;
    let repelY = 0;
    let danger = 0;
    let panic = false;

    for (const snake of nearbySnakes) {
      const dx = head.x - snake.head.x;
      const dy = head.y - snake.head.y;
      const dist = Math.hypot(dx, dy);
      if (dist > PROXIMITY_ESCAPE_RADIUS || dist < 1) {
        continue;
      }

      const sizeRatio = snake.length / Math.max(1, myLength);
      const nearFactor = (PROXIMITY_ESCAPE_RADIUS - dist) / PROXIMITY_ESCAPE_RADIUS;
      const weight = (1 + Math.max(0, sizeRatio - 0.7) * 1.9) * (0.4 + nearFactor * 2.6);

      repelX += (dx / dist) * weight;
      repelY += (dy / dist) * weight;
      danger += weight;

      if (dist < THREAT_PANIC_RADIUS || (sizeRatio > 1.2 && dist < PROXIMITY_ESCAPE_RADIUS * 0.75)) {
        panic = true;
      }
    }

    if (danger <= 0.01) {
      return null;
    }

    return {
      angle: Math.atan2(repelY, repelX),
      danger,
      panic
    };
  }

  private buildMassQueue(
    head: Vec2,
    orbs: OrbState[],
    anchorHead: Vec2 | null,
    nearbySnakes: NearbySnake[],
    myLength: number
  ): string[] {
    const scored: Array<{ id: string; score: number }> = [];
    for (const orb of orbs) {
      const dx = orb.x - head.x;
      const dy = orb.y - head.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 1100) {
        continue;
      }

      let localThreat = 0;
      for (const snake of nearbySnakes) {
        if (snake.length <= myLength * 0.95) {
          continue;
        }
        const dangerDist = Math.hypot(orb.x - snake.head.x, orb.y - snake.head.y);
        if (dangerDist < 420) {
          localThreat += (420 - dangerDist) * (snake.length / Math.max(1, myLength));
        }
      }

      let score = orb.size * 42 - dist - localThreat * 0.18;
      if (anchorHead) {
        const distToAnchor = Math.hypot(orb.x - anchorHead.x, orb.y - anchorHead.y);
        if (distToAnchor > ANCHOR_HARD_LEASH) {
          score -= 520;
        } else if (distToAnchor < ANCHOR_STAY_RADIUS) {
          score += 95;
        }
      }
      scored.push({ id: orb.id, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 12).map((entry) => entry.id);
  }

  private selectPreyTarget(
    head: Vec2,
    nearbySnakes: NearbySnake[],
    myLength: number,
    anchorHead: Vec2 | null,
    personality: BotPersonality
  ): Vec2 | null {
    // Passive bots never hunt; defensive bots rarely hunt (but will opportunistically go for nearby humans)
    if (personality === "passive") return null;
    if (personality === "defensive") {
      const hasNearbyHuman = nearbySnakes.some(s => !s.isBot && this.distance(head, s.head) < PREY_CHASE_RADIUS * 0.7);
      if (!hasNearbyHuman && Math.random() < 0.85) return null;
    }

    // Aggressive bots will chase snakes up to 90% their size; others stay at 72%
    const preyLengthThreshold = personality === "aggressive" ? 0.90 : 0.72;
    // Aggressive bots chase further
    const chaseRadius = personality === "aggressive" ? PREY_CHASE_RADIUS * 1.3 : PREY_CHASE_RADIUS;

    let best: Vec2 | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const snake of nearbySnakes) {
      if (snake.length >= myLength * preyLengthThreshold) {
        continue;
      }
      // Human players can be detected from further away
      const effectiveRadius = !snake.isBot ? chaseRadius * 1.45 : chaseRadius;
      const dist = this.distance(head, snake.head);
      if (dist > effectiveRadius) {
        continue;
      }

      let threatPenalty = 0;
      for (const other of nearbySnakes) {
        if (other.id === snake.id || other.length <= myLength * 0.95) {
          continue;
        }
        const predDist = this.distance(other.head, snake.head);
        if (predDist < 450) {
          threatPenalty += 320 - predDist * 0.45;
        }
      }

      let score = (myLength - snake.length) * 2.5 - dist * 0.7 - threatPenalty;
      if (anchorHead) {
        score -= this.distance(anchorHead, snake.head) * 0.18;
      }
      // Heavily prioritise human players as targets — bots are worth less to hunt
      if (!snake.isBot) {
        score += personality === "aggressive" ? 380 : 160;
      }
      if (score > bestScore) {
        bestScore = score;
        if (personality === "aggressive") {
          // Aim ahead of prey to intercept — cut across their path
          best = this.computeInterceptPoint(head, snake);
        } else {
          best = {
            x: snake.head.x + snake.heading.x * 26,
            y: snake.head.y + snake.heading.y * 26
          };
        }
      }
    }
    return bestScore > -120 ? best : null;
  }

  private computeInterceptPoint(botHead: Vec2, prey: NearbySnake): Vec2 {
    const dist = Math.hypot(prey.head.x - botHead.x, prey.head.y - botHead.y);
    // Lead further when prey is far — aim ahead of their current path
    const leadDist = Math.min(580, dist * 0.58 + 90);
    return {
      x: prey.head.x + prey.heading.x * leadDist,
      y: prey.head.y + prey.heading.y * leadDist
    };
  }

  private applySteeringNoise(angle: number, phase: number): number {
    const noise = Math.sin(phase) * 0.085 + Math.sin(phase * 0.37) * 0.035;
    return this.wrapAngle(angle + noise);
  }

  private selectMassHotspot(
    head: Vec2,
    orbs: OrbState[],
    anchorHead: Vec2 | null,
    nearbySnakes: NearbySnake[],
    myLength: number
  ): MassHotspot | null {
    const now = Date.now();
    while (this.massClusters.length > 0 && this.massClusters[0].expiresAtMs <= now) {
      this.massClusters.shift();
    }

    let best: MassHotspot | null = null;

    for (const cluster of this.massClusters) {
      const localCluster = this.scoreMassHotspot(cluster.x, cluster.y, orbs, nearbySnakes, myLength);
      const clusterScore = localCluster.score + cluster.score;
      const distance = this.distance(head, { x: cluster.x, y: cluster.y });
      let score = clusterScore - distance * 0.42;
      if (anchorHead) {
        score -= this.distance(anchorHead, { x: cluster.x, y: cluster.y }) * 0.05;
      }

      if (!best || score > best.score) {
        best = {
          x: cluster.x,
          y: cluster.y,
          score,
          orbCount: this.countOrbsNear(orbs, cluster.x, cluster.y, 240)
        };
      }
    }

    for (const orb of orbs) {
      const density = this.scoreMassHotspot(orb.x, orb.y, orbs, nearbySnakes, myLength);
      if (density.orbCount < 4) {
        continue;
      }

      const distance = this.distance(head, orb);
      let score = density.score - distance * 0.45;
      if (anchorHead) {
        score -= this.distance(anchorHead, orb) * 0.05;
      }
      if (!best || score > best.score) {
        best = {
          x: density.x,
          y: density.y,
          score,
          orbCount: density.orbCount
        };
      }
    }

    return best;
  }

  private scoreMassHotspot(
    x: number,
    y: number,
    orbs: OrbState[],
    nearbySnakes: NearbySnake[],
    myLength: number
  ): MassHotspot {
    const radius = 220;
    const radiusSq = radius * radius;
    let orbCount = 0;
    let massScore = 0;
    let sumX = 0;
    let sumY = 0;

    for (const orb of orbs) {
      const dx = orb.x - x;
      const dy = orb.y - y;
      if (dx * dx + dy * dy > radiusSq) {
        continue;
      }

      orbCount += 1;
      sumX += orb.x;
      sumY += orb.y;
      massScore += orb.size * 26;
    }

    for (const snake of nearbySnakes) {
      if (snake.length <= myLength * 0.9) {
        continue;
      }

      const snakeDist = Math.hypot(snake.head.x - x, snake.head.y - y);
      if (snakeDist < 360) {
        massScore -= (360 - snakeDist) * (snake.length / Math.max(1, myLength));
      }
    }

    return {
      x: orbCount > 0 ? sumX / orbCount : x,
      y: orbCount > 0 ? sumY / orbCount : y,
      score: massScore + orbCount * 20,
      orbCount
    };
  }

  private countOrbsNear(orbs: OrbState[], x: number, y: number, radius: number): number {
    const radiusSq = radius * radius;
    let count = 0;
    for (const orb of orbs) {
      const dx = orb.x - x;
      const dy = orb.y - y;
      if (dx * dx + dy * dy <= radiusSq) {
        count += 1;
      }
    }
    return count;
  }

  private planLightModelAction(
    head: Vec2,
    orbs: OrbState[],
    context: BotContext,
    anchorHead: Vec2 | null,
    myLength: number,
    brain: BotBrain,
    nearBoundary: boolean
  ): PlannedAction {
    const threat = this.findImmediateThreat(head, context.nearbySnakes, myLength,
      brain.personality === "defensive" ? 1.35 : brain.personality === "passive" ? 0.55 : 1.0);
    const preyTarget = this.selectPreyTarget(head, context.nearbySnakes, myLength, anchorHead, brain.personality);
    const massQueue = this.buildMassQueue(head, orbs, anchorHead, context.nearbySnakes, myLength);
    const massHotspot = this.selectMassHotspot(head, orbs, anchorHead, context.nearbySnakes, myLength);
    const topOrb = massQueue.length > 0 ? this.findOrbById(orbs, massQueue[0]) : null;

    let baseAngle = brain.committedAngle;
    let reason: PlannedAction["reason"] = "stabilize";
    let shouldBoost = false;

    // Per-personality boost multipliers
    const huntBoostMult   = brain.personality === "aggressive" ? 1.0  : brain.personality === "passive" ? 0.0  : 0.5;
    const evadeBoostMult  = brain.personality === "defensive"  ? 1.4  : brain.personality === "passive" ? 0.6  : 1.0;
    const collectBoostMult = brain.personality === "passive"   ? 0.35 : 1.0;

    if (threat && threat.distance < THREAT_ALERT_RADIUS) {
      baseAngle = this.computeEvadeAngle(head, threat, brain, true);
      reason = "evade";
      shouldBoost = threat.distance < THREAT_ALERT_RADIUS &&
        (threat.closingStrength > -0.5 || Math.random() < 0.35 * evadeBoostMult);
    } else if (preyTarget && !nearBoundary) {
      baseAngle = Math.atan2(preyTarget.y - head.y, preyTarget.x - head.x);
      reason = "hunt";
      const preyDistance = Math.hypot(preyTarget.x - head.x, preyTarget.y - head.y);
      // Aggressive bots boost hard to intercept — boost almost always when chasing
      shouldBoost = preyDistance > 80 && preyDistance < 1200 &&
        Math.random() < BOOST_HUNT_TRIGGER_CHANCE * huntBoostMult;
    } else if (massHotspot && !nearBoundary) {
      baseAngle = Math.atan2(massHotspot.y - head.y, massHotspot.x - head.x);
      reason = "collect";
      const hotspotDistance = Math.hypot(massHotspot.x - head.x, massHotspot.y - head.y);
      const significantMass = massHotspot.orbCount >= 6 || massHotspot.score > 160;
      shouldBoost = significantMass && hotspotDistance > 120 && hotspotDistance < 1350 &&
        Math.random() < BOOST_COLLECT_TRIGGER_CHANCE * collectBoostMult;
    } else if (topOrb && !nearBoundary) {
      baseAngle = Math.atan2(topOrb.y - head.y, topOrb.x - head.x);
      reason = "collect";
      const orbDistance = Math.hypot(topOrb.x - head.x, topOrb.y - head.y);
      const significantMass = topOrb.size >= 5 || massQueue.length > 8;
      shouldBoost = significantMass && orbDistance > 120 && orbDistance < 1250 &&
        Math.random() < BOOST_COLLECT_TRIGGER_CHANCE * 0.83 * collectBoostMult;
    } else {
      baseAngle = this.pickWanderAngle(head, anchorHead);
      reason = "stabilize";
      // Passive bots wander more erratically with random turns
      if (brain.personality === "passive" && Math.random() < 0.04) {
        baseAngle = this.wrapAngle(brain.committedAngle + (Math.random() - 0.5) * Math.PI);
      }
      shouldBoost = Math.random() < BOOST_WANDER_TRIGGER_CHANCE;
    }

    let bestAngle = baseAngle;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const offset of PLAN_TURN_OFFSETS) {
      const angle = this.wrapAngle(baseAngle + offset);
      const score = this.rolloutScore(angle, head, orbs, context, anchorHead, myLength, reason, threat);
      if (score > bestScore) {
        bestScore = score;
        bestAngle = angle;
      }
    }

    return {
      angle: bestAngle,
      boost: shouldBoost,
      reason
    };
  }

  private rolloutScore(
    angle: number,
    head: Vec2,
    orbs: OrbState[],
    context: BotContext,
    anchorHead: Vec2 | null,
    myLength: number,
    reason: PlannedAction["reason"],
    threat: ThreatInfo | null
  ): number {
    let simX = head.x;
    let simY = head.y;
    let score = 0;

    for (let step = 1; step <= PLAN_HORIZON_STEPS; step += 1) {
      const travel = SNAKE_BASE_SPEED * PLAN_STEP_SECONDS * (1 + (reason === "evade" ? 0.25 : 0));
      simX += Math.cos(angle) * travel;
      simY += Math.sin(angle) * travel;
      const point = { x: simX, y: simY };

      const hazard = this.hazardAtPoint(point, context.segmentHazards);
      score -= hazard * (1.2 + step * 0.08);

      const edgeDist = Math.hypot(point.x, point.y);
      if (edgeDist > ARENA_RADIUS * 0.9) {
        score -= (edgeDist - ARENA_RADIUS * 0.9) * 0.1 + 14;
      }

      if (anchorHead) {
        score -= this.distance(point, anchorHead) * 0.0022;
      }

      let nearestOrbDist = Number.POSITIVE_INFINITY;
      for (const orb of orbs) {
        const d = Math.hypot(orb.x - point.x, orb.y - point.y);
        if (d < nearestOrbDist) {
          nearestOrbDist = d;
        }
        if (d < 95) {
          score += orb.size * (reason === "collect" ? 3.6 : 2.4);
        }
      }
      if (Number.isFinite(nearestOrbDist)) {
        score -= nearestOrbDist * 0.01;
      }

      for (const snake of context.nearbySnakes) {
        const d = Math.hypot(snake.head.x - point.x, snake.head.y - point.y);
        const sizeRatio = snake.length / Math.max(1, myLength);
        if (sizeRatio > 1.0) {
          score -= this.sigmoid(-1.1 + sizeRatio * 1.25 + (280 - d) * 0.01) * 26;
        } else if (reason === "hunt" && sizeRatio < 0.72 && d < 320) {
          score += (0.72 - sizeRatio) * 14;
        }
      }
    }

    if (threat) {
      const projected = {
        x: head.x + Math.cos(angle) * 180,
        y: head.y + Math.sin(angle) * 180
      };
      const projectedDist = this.distance(projected, threat.snake.head);
      score += (projectedDist - threat.distance) * 0.08;
    }

    return score;
  }

  private sigmoid(value: number): number {
    return 1 / (1 + Math.exp(-value));
  }

  private selectTargetOrb(head: Vec2, orbs: OrbState[], anchorHead: Vec2 | null): OrbState | null {
    let bestOrb: OrbState | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const orb of orbs) {
      const dx = orb.x - head.x;
      const dy = orb.y - head.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 980) {
        continue;
      }

      /* changed by gemini - prioritize size more */
      let score = orb.size * 50 - dist;
      if (anchorHead) {
        const distToAnchor = Math.hypot(orb.x - anchorHead.x, orb.y - anchorHead.y);
        /* changed by gemini - bots sometimes ignore the anchor to seek big food */
        if (distToAnchor > ANCHOR_HARD_LEASH) {
          score -= 600;
        } else if (distToAnchor < ANCHOR_STAY_RADIUS) {
          score += 100;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestOrb = orb;
      }
    }

    return bestOrb;
  }

  private pickWanderAngle(head: Vec2, anchorHead: Vec2 | null): number {
    if (anchorHead) {
      const distanceToAnchor = this.distance(head, anchorHead);
      const anchorAngle = Math.atan2(anchorHead.y - head.y, anchorHead.x - head.x);

      if (distanceToAnchor > ANCHOR_SOFT_LEASH) {
        return anchorAngle + (Math.random() - 0.5) * 0.45;
      }

      if (distanceToAnchor > ANCHOR_STAY_RADIUS || Math.random() < ANCHOR_FOLLOW_CHANCE) {
        return anchorAngle + (Math.random() - 0.5) * 0.7;
      }

      return anchorAngle + (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2) + (Math.random() - 0.5) * 0.6;
    }

    const inward = Math.atan2(-head.y, -head.x);
    const randomSpread = (Math.random() - 0.5) * 0.9;
    const edgeBias = Math.hypot(head.x, head.y) > ARENA_RADIUS * 0.72 ? inward : inward * 0.5;
    return edgeBias + randomSpread;
  }

  private buildRecoverAngle(head: Vec2, fallbackAngle: number): number {
    const inward = Math.atan2(-head.y, -head.x);
    const centerDistance = Math.hypot(head.x, head.y);
    if (centerDistance > ARENA_RADIUS * 0.82) {
      return inward + (Math.random() - 0.5) * 0.35;
    }
    return fallbackAngle + Math.PI * (0.6 + Math.random() * 0.6);
  }

  private findOrbById(orbs: OrbState[], id: string | null): OrbState | null {
    if (!id) {
      return null;
    }
    for (const orb of orbs) {
      if (orb.id === id) {
        return orb;
      }
    }
    return null;
  }

  private distance(a: Vec2, b: Vec2): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private angleDistance(a: number, b: number): number {
    const fullTurn = Math.PI * 2;
    const diff = Math.abs(((a - b + Math.PI) % fullTurn + fullTurn) % fullTurn - Math.PI);
    return diff;
  }

  private blendAngles(base: number, toward: number, weight: number): number {
    const delta = this.wrapAngle(toward - base);
    return this.wrapAngle(base + delta * weight);
  }

  private wrapAngle(angle: number): number {
    const fullTurn = Math.PI * 2;
    let wrapped = angle % fullTurn;
    if (wrapped > Math.PI) {
      wrapped -= fullTurn;
    }
    if (wrapped < -Math.PI) {
      wrapped += fullTurn;
    }
    return wrapped;
  }

  private debug(botId: string, message: string): void {
    if (!BOT_DEBUG_LOGS) {
      return;
    }
    // High-signal bot logs for diagnosing steering loops.
    // eslint-disable-next-line no-console
    console.log(`[bot ${botId}] ${message}`);
  }

  private getBrain(botId: string, head: Vec2, now: number): BotBrain {
    const existing = this.brains.get(botId);
    if (existing) {
      return existing;
    }

    const personalityRoll = Math.random();
    const personality: BotPersonality =
      personalityRoll < 0.28 ? "aggressive" : personalityRoll < 0.58 ? "defensive" : "passive";

    const created: BotBrain = {
      mode: "wander",
      personality,
      modeEnteredAtMs: now,
      modeUntilMs: now + 1400 + Math.random() * 900,
      committedAngle: Math.random() * Math.PI * 2,
      modeAnchor: { x: head.x, y: head.y },
      targetOrbId: null,
      nextRetargetAtMs: now,
      boostCooldownMs: 0,
      lastHead: { x: head.x, y: head.y },
      stuckSeconds: 0,
      lastTargetDistance: null,
      bestTargetDistance: null,
      noProgressSeconds: 0,
      trappedDirection: Math.random() < 0.5 ? 1 : -1,
      trappedSeconds: 0,
      threatHoldUntilMs: 0,
      escapeLoopDirection: Math.random() < 0.5 ? 1 : -1,
      massQueue: [],
      steeringNoisePhase: Math.random() * Math.PI * 2,
      boostHoldUntilMs: 0,
      passiveSkipUntilMs: 0
    };
    this.brains.set(botId, created);
    return created;
  }
}
