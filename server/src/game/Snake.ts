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

    for (let i = 0; i < SNAKE_START_LENGTH; i += 1) {
      this.segments.push({
        x: spawn.x - Math.cos(this.angle) * i * SEGMENT_SPACING,
        y: spawn.y - Math.sin(this.angle) * i * SEGMENT_SPACING
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

    const head = this.segments[0];
    head.x += Math.cos(this.angle) * speed * deltaSeconds;
    head.y += Math.sin(this.angle) * speed * deltaSeconds;

    for (let i = 1; i < this.segments.length; i += 1) {
      const prev = this.segments[i - 1];
      const current = this.segments[i];
      const dx = prev.x - current.x;
      const dy = prev.y - current.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const t = Math.max(0, (dist - SEGMENT_SPACING) / dist);
      current.x += dx * t;
      current.y += dy * t;
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
    return { x: head.x, y: head.y };
  }

  public getSegments(): SnakeSegment[] {
    return this.segments;
  }

  public toState(): SnakeState {
    return {
      id: this.id,
      name: this.name,
      color: this.color,
      score: this.score,
      alive: this.alive,
      segments: this.segments.map((segment: SnakeSegment) => ({ ...segment }))
    };
  }
}
