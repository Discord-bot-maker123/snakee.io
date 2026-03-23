import {
  ARENA_RADIUS,
  MAX_ORBS,
  ORB_MAX_SIZE,
  ORB_MIN_SIZE,
  SNAKE_BODY_RADIUS
} from "snakee-shared/constants";
import type { OrbState, Vec2 } from "snakee-shared/types";

let orbCounter = 0;
const ORB_PALETTE = [0x59f7ff, 0x55ff9a, 0xff7bd8, 0xffd166, 0x7f8cff, 0xff6f91, 0x6be1ff];

export class OrbManager {
  private readonly orbs: Map<string, OrbState>;

  public constructor() {
    this.orbs = new Map<string, OrbState>();
    this.ensureCount(MAX_ORBS);
  }

  public ensureCount(targetCount: number): void {
    while (this.orbs.size < targetCount) {
      const orb = this.spawnOrb();
      this.orbs.set(orb.id, orb);
    }
  }

  public consumeAt(point: Vec2): string[] {
    const removed: string[] = [];
    for (const [id, orb] of this.orbs.entries()) {
      const dx = point.x - orb.x;
      const dy = point.y - orb.y;
      const radius = SNAKE_BODY_RADIUS + orb.size;
      if (dx * dx + dy * dy <= radius * radius) {
        this.orbs.delete(id);
        removed.push(id);
      }
    }
    return removed;
  }

  public spawnFromSegments(segments: Vec2[]): void {
    for (const segment of segments) {
      const id = `orb-${orbCounter}`;
      orbCounter += 1;
      this.orbs.set(id, {
        id,
        x: segment.x,
        y: segment.y,
        color: this.randomColor(),
        size: ORB_MIN_SIZE + Math.random() * (ORB_MAX_SIZE - ORB_MIN_SIZE)
      });
    }
  }

  public spawnSingle(point: Vec2, size: number = ORB_MIN_SIZE): string {
    const id = `orb-${orbCounter}`;
    orbCounter += 1;
    this.orbs.set(id, {
      id,
      x: point.x,
      y: point.y,
      color: this.randomColor(),
      size
    });
    return id;
  }

  public getAll(): OrbState[] {
    return Array.from(this.orbs.values(), (orb: OrbState) => ({ ...orb }));
  }

  public has(id: string): boolean {
    return this.orbs.has(id);
  }

  private spawnOrb(): OrbState {
    const radius = Math.sqrt(Math.random()) * (ARENA_RADIUS - 30);
    const angle = Math.random() * Math.PI * 2;
    const id = `orb-${orbCounter}`;
    orbCounter += 1;

    return {
      id,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      color: this.randomColor(),
      size: ORB_MIN_SIZE + Math.random() * (ORB_MAX_SIZE - ORB_MIN_SIZE)
    };
  }

  private randomColor(): number {
    return ORB_PALETTE[Math.floor(Math.random() * ORB_PALETTE.length)];
  }
}
