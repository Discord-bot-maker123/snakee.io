import {
  BOT_BOOST_START_MIN_SEGMENTS,
  BOOST_ENERGY_DRAIN_PER_SEC,
  BOOST_ENERGY_MAX,
  BOOST_ENERGY_REGEN_PER_SEC,
  BOOST_MULTIPLIER,
  BOOST_START_MIN_SEGMENTS,
  SEGMENT_SPACING,
  SNAKE_BASE_SPEED,
  SNAKE_START_LENGTH,
  SNAKE_TURN_SPEED
} from "snakee-shared/constants";
import type { SnakeSegment, SnakeState, Vec2 } from "snakee-shared/types";
import { normalizeAngle } from "./utils.js";

export class Snake {
  public readonly id: string;

  public name: string;

  public readonly color: number;

  public readonly isBot: boolean;

  public alive: boolean;

  public score: number;

  private angle: number;

  private targetAngle: number;

  private boosting: boolean;

  private energy: number;

  private lastInputSeq: number;

  private readonly segments: SnakeSegment[];

  private boostingActive: boolean;

  // Path-following: history of head positions, index 0 = most recent
  private readonly headPath: { x: number; y: number }[];

  public constructor(id: string, name: string, color: number, spawn: Vec2, isBot: boolean) {
    this.id = id;
    this.name = name;
    this.color = color;
    this.isBot = isBot;
    this.alive = true;
    this.score = 0;
    this.angle = Math.random() * Math.PI * 2;
    this.targetAngle = this.angle;
    this.boosting = false;
    this.energy = BOOST_ENERGY_MAX;
    this.lastInputSeq = -1;
    this.segments = [];
    this.boostingActive = false;
    this.headPath = [];

    for (let i = 0; i < SNAKE_START_LENGTH; i += 1) {
      this.segments.push({
        x: spawn.x - Math.cos(this.angle) * i * SEGMENT_SPACING,
        y: spawn.y - Math.sin(this.angle) * i * SEGMENT_SPACING
      });
    }

    // Pre-fill path history as a straight line behind the spawn so body
    // segments have a valid path from tick 0 without any warm-up period.
    const initLen = (SNAKE_START_LENGTH + 1) * SEGMENT_SPACING + 10;
    for (let d = 0; d <= initLen; d += 1) {
      this.headPath.push({
        x: spawn.x - Math.cos(this.angle) * d,
        y: spawn.y - Math.sin(this.angle) * d
      });
    }
  }

  public applyInput(targetAngle: number, boosting: boolean, seq: number): void {
    if (seq <= this.lastInputSeq) {
      return;
    }

    this.lastInputSeq = seq;
    this.targetAngle = targetAngle;
    this.boosting = boosting;
  }

  public update(deltaSeconds: number): void {
    if (!this.alive || this.segments.length === 0) {
      return;
    }

    const deltaAngle = normalizeAngle(this.targetAngle - this.angle);
    const maxTurn = SNAKE_TURN_SPEED * deltaSeconds;
    const turn = Math.min(maxTurn, Math.max(-maxTurn, deltaAngle));
    this.angle = normalizeAngle(this.angle + turn);

    const minBoostSegments = this.isBot ? BOT_BOOST_START_MIN_SEGMENTS : BOOST_START_MIN_SEGMENTS;
    const canBoost = this.boosting && this.energy > 0 && this.segments.length >= minBoostSegments;
    this.boostingActive = canBoost;
    const speed = canBoost ? SNAKE_BASE_SPEED * BOOST_MULTIPLIER : SNAKE_BASE_SPEED;
    if (canBoost) {
      this.energy = Math.max(0, this.energy - BOOST_ENERGY_DRAIN_PER_SEC * deltaSeconds);
    } else {
      this.energy = Math.min(BOOST_ENERGY_MAX, this.energy + BOOST_ENERGY_REGEN_PER_SEC * deltaSeconds);
    }

    // Move head
    const head = this.segments[0];
    head.x += Math.cos(this.angle) * speed * deltaSeconds;
    head.y += Math.sin(this.angle) * speed * deltaSeconds;

    // Prepend new head position to the path history
    this.headPath.unshift({ x: head.x, y: head.y });

    // Place every body segment at its exact arc-distance along the path.
    // pathIdx/cumDist carry forward across segments so the total walk is O(P)
    // rather than O(N*P).
    let pathIdx = 0;
    let cumDist = 0;

    for (let i = 1; i < this.segments.length; i += 1) {
      const targetDist = i * SEGMENT_SPACING;
      let placed = false;

      while (pathIdx + 1 < this.headPath.length) {
        const dx = this.headPath[pathIdx + 1].x - this.headPath[pathIdx].x;
        const dy = this.headPath[pathIdx + 1].y - this.headPath[pathIdx].y;
        const segDist = Math.sqrt(dx * dx + dy * dy);
        const nextCumDist = cumDist + segDist;

        if (nextCumDist >= targetDist) {
          const t = segDist > 0 ? (targetDist - cumDist) / segDist : 0;
          this.segments[i].x = this.headPath[pathIdx].x + t * dx;
          this.segments[i].y = this.headPath[pathIdx].y + t * dy;
          placed = true;
          break;
        }

        cumDist = nextCumDist;
        pathIdx += 1;
      }

      if (!placed) {
        // Path ran out (snake just grew) — pin to the oldest known point
        const last = this.headPath[this.headPath.length - 1];
        this.segments[i].x = last.x;
        this.segments[i].y = last.y;
      }
    }

    // Trim path: drop entries that are further back than any segment needs
    const maxPathDist = this.segments.length * SEGMENT_SPACING + SEGMENT_SPACING * 2;
    let trimDist = 0;
    for (let j = 0; j + 1 < this.headPath.length; j += 1) {
      const dx = this.headPath[j + 1].x - this.headPath[j].x;
      const dy = this.headPath[j + 1].y - this.headPath[j].y;
      trimDist += Math.sqrt(dx * dx + dy * dy);
      if (trimDist > maxPathDist) {
        this.headPath.length = j + 2;
        break;
      }
    }
  }

  public grow(amount: number): void {
    const tail = this.segments[this.segments.length - 1];
    for (let i = 0; i < amount; i += 1) {
      this.segments.push({ x: tail.x, y: tail.y });
    }
  }

  public addScore(points: number): void {
    this.score += points;
  }

  public setName(name: string): void {
    this.name = name;
  }

  public kill(): void {
    this.alive = false;
  }

  public setBotTarget(targetAngle: number, boosting: boolean): void {
    this.targetAngle = targetAngle;
    this.boosting = boosting;
  }

  public isBoostingActive(): boolean {
    return this.boostingActive;
  }

  public segmentCount(): number {
    return this.segments.length;
  }

  public canStartBoost(): boolean {
    const minBoostSegments = this.isBot ? BOT_BOOST_START_MIN_SEGMENTS : BOOST_START_MIN_SEGMENTS;
    return this.energy > 0 && this.segments.length >= minBoostSegments;
  }

  public shedTailSegment(): Vec2 | null {
    if (this.segments.length <= 0) {
      return null;
    }

    const tail = this.segments.pop();
    if (!tail) {
      return null;
    }

    return { x: tail.x, y: tail.y };
  }

  public headPosition(): Vec2 {
    const head = this.segments[0];
    if (!head) {
      return { x: 0, y: 0 };
    }
    return { x: head.x, y: head.y };
  }

  public getSegments(): SnakeSegment[] {
    return this.segments.map((segment: SnakeSegment) => ({ ...segment }));
  }

  public toState(): SnakeState {
    return {
      id: this.id,
      name: this.name,
      color: this.color,
      score: this.score,
      alive: this.alive,
      boosting: this.boostingActive,
      segments: this.segments.map((segment: SnakeSegment) => ({ ...segment }))
    };
  }
}
