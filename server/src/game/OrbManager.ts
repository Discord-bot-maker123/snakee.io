import {
  ARENA_RADIUS,
  MAX_ORBS,
  ORB_MIN_SIZE,
  ORB_TIERS,
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

  public consumeAt(point: Vec2): Array<{ id: string; value: number }> {
    const removed: Array<{ id: string; value: number }> = [];
    for (const [id, orb] of this.orbs.entries()) {
      const dx = point.x - orb.x;
      const dy = point.y - orb.y;
      const radius = SNAKE_BODY_RADIUS + orb.size;
      if (dx * dx + dy * dy <= radius * radius) {
        this.orbs.delete(id);
        removed.push({ id, value: orb.value });
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
        size: ORB_MIN_SIZE,
        value: 1
      });
    }
  }

  public spawnSingle(point: Vec2, size: number = ORB_MIN_SIZE, value: number = 1): string {
    const id = `orb-${orbCounter}`;
    orbCounter += 1;
    this.orbs.set(id, {
      id,
      x: point.x,
      y: point.y,
      color: this.randomColor(),
      size,
      value
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
    const tier = this.pickTier();

    return {
      id,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      color: this.randomColor(),
      size: tier.size,
      value: tier.value
    };
  }

  private pickTier(): { size: number; value: number } {
    const total = ORB_TIERS.reduce((sum, t) => sum + t.weight, 0);
    let roll = Math.random() * total;
    for (const tier of ORB_TIERS) {
      roll -= tier.weight;
      if (roll <= 0) {
        return tier;
      }
    }
    return ORB_TIERS[0];
  }

  private randomColor(): number {
    return ORB_PALETTE[Math.floor(Math.random() * ORB_PALETTE.length)];
  }
}
