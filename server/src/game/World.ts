import {
  ARENA_RADIUS,
  BOOST_HARD_MIN_SEGMENTS,
  BOOST_ORB_DROP_INTERVAL_SEC,
  MAX_ORBS,
  ORB_MIN_SIZE,
  SERVER_TICK_RATE
} from "snakee-shared/constants";
import type { LeaderboardEntry, OrbState, SnakeState, Vec2 } from "snakee-shared/types";
import { BotAI, type NearbySnake, type SegmentHazard } from "./BotAI.js";
import { Collision } from "./Collision.js";
import { OrbManager } from "./OrbManager.js";
import { Snake } from "./Snake.js";
import type { DeathEvent } from "./utils.js";
import { randomColor } from "./utils.js";

type TickResult = {
  tick: number;
  deaths: DeathEvent[];
};

const MIN_ACTIVE_SNAKES = 10;
const BOT_ORB_VISION_RADIUS = 1200;
const ORB_GRID_CELL_SIZE = 240;

export class World {
  private readonly snakes: Map<string, Snake>;

  private readonly orbManager: OrbManager;

  private readonly botAI: BotAI;

  private tickNumber: number;

  private timer: NodeJS.Timeout | null;

  private lastStepTimeMs: number;

  private readonly boostDropTimers: Map<string, number>;

  public constructor() {
    this.snakes = new Map<string, Snake>();
    this.orbManager = new OrbManager();
    this.botAI = new BotAI();
    this.tickNumber = 0;
    this.timer = null;
    this.lastStepTimeMs = 0;
    this.boostDropTimers = new Map<string, number>();
  }

  public start(onTick: (result: TickResult) => void): void {
    if (this.timer) {
      return;
    }

    const deltaMs = 1000 / SERVER_TICK_RATE;
    this.lastStepTimeMs = performance.now();
    this.timer = setInterval(() => {
      const now = performance.now();
      const elapsedSeconds = Math.min(0.25, Math.max(0, (now - this.lastStepTimeMs) / 1000));
      this.lastStepTimeMs = now;
      const result = this.step(elapsedSeconds);
      onTick(result);
    }, deltaMs);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public addPlayer(id: string, name: string, isBot: boolean): Snake {
    const spawn = this.pickSpawnPoint(isBot);
    const snake = new Snake(id, name, randomColor(), spawn, isBot);
    this.snakes.set(id, snake);
    return snake;
  }

  public removeSnake(id: string, dropMass: boolean = false): void {
    const snake = this.snakes.get(id);
    if (!snake) {
      return;
    }
    if (dropMass) {
      this.orbManager.spawnFromSegments(snake.getSegments());
    }
    if (snake.isBot) {
      this.botAI.removeBot(snake.id);
    }
    this.boostDropTimers.delete(snake.id);
    this.snakes.delete(id);
  }

  public handleInput(id: string, angle: number, boosting: boolean, seq: number): void {
    const snake = this.snakes.get(id);
    if (!snake || !snake.alive) {
      return;
    }
    snake.applyInput(angle, boosting, seq);
  }

  public setSnakeName(id: string, name: string): void {
    const snake = this.snakes.get(id);
    if (!snake) {
      return;
    }
    snake.setName(name);
  }

  public getSnakesState(): SnakeState[] {
    return Array.from(this.snakes.values(), (snake: Snake) => snake.toState());
  }

  public getOrbsState(): OrbState[] {
    return this.orbManager.getAll();
  }

  public getLeaderboard(): LeaderboardEntry[] {
    const alive = Array.from(this.snakes.values())
      .filter((snake: Snake) => snake.alive)
      .sort((a: Snake, b: Snake) => b.score - a.score)
      .slice(0, 10);
    return alive.map((snake: Snake) => ({
      id: snake.id,
      name: snake.name,
      score: snake.score,
      color: snake.color
    }));
  }

  private step(deltaSeconds: number): TickResult {
    this.tickNumber += 1;
    if (!this.hasAliveHumanSnake()) {
      return {
        tick: this.tickNumber,
        deaths: []
      };
    }

    this.ensureBots();

    const currentOrbs = this.orbManager.getAll();
    const orbGrid = this.buildOrbGrid(currentOrbs);

    for (const snake of this.snakes.values()) {
      if (!snake.alive) {
        continue;
      }

      const head = snake.headPosition();
      if (snake.isBot) {
        this.botAI.update(snake, this.getNearbyOrbsFromGrid(orbGrid, head, BOT_ORB_VISION_RADIUS), deltaSeconds, {
          anchorHead: this.findNearestHumanHead(head),
          segmentHazards: this.findNearbyThreats(snake),
          nearbySnakes: this.findNearbySnakes(snake)
        });
      }

      snake.update(deltaSeconds);
      this.handleBoostTrailDrops(snake, deltaSeconds);
      const consumed = this.orbManager.consumeAt(snake.headPosition());
      if (consumed.length > 0) {
        snake.grow(consumed.length);
        snake.addScore(consumed.length * 2);
      }
    }

    const deaths: DeathEvent[] = [];
    const collisions = Collision.findDeaths(this.snakes);
    for (const collision of collisions) {
      const victim = this.snakes.get(collision.victimId);
      if (!victim || !victim.alive) {
        continue;
      }

      victim.kill();
      this.botAI.registerMassCluster(victim.getSegments());
      this.orbManager.spawnFromSegments(victim.getSegments());
      const killer = collision.killerId ? this.snakes.get(collision.killerId) : null;
      deaths.push({
        victimId: victim.id,
        killerId: collision.killerId,
        killerName: killer?.name ?? null,
        finalScore: victim.score,
        finalLength: victim.getSegments().length
      });
      if (victim.isBot) {
        this.botAI.removeBot(victim.id);
      }
      this.boostDropTimers.delete(victim.id);
      this.snakes.delete(victim.id);
    }

    this.orbManager.ensureCount(MAX_ORBS);

    return {
      tick: this.tickNumber,
      deaths
    };
  }

  private hasAliveHumanSnake(): boolean {
    for (const snake of this.snakes.values()) {
      if (snake.alive && !snake.isBot) {
        return true;
      }
    }
    return false;
  }

  private ensureBots(): void {
    const currentCount = this.snakes.size;
    const missing = Math.max(0, MIN_ACTIVE_SNAKES - currentCount);

    for (let i = 0; i < missing; i += 1) {
      const id = `bot-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
      const name = `BOT-${Math.floor(Math.random() * 99)}`;
      this.addPlayer(id, name, true);
    }
  }

  private handleBoostTrailDrops(snake: Snake, deltaSeconds: number): void {
    if (!snake.isBoostingActive()) {
      // Do not bank time while boost is inactive, otherwise next boost start dumps many drops at once.
      this.boostDropTimers.set(snake.id, 0);
      return;
    }

    let remainder = (this.boostDropTimers.get(snake.id) ?? 0) + deltaSeconds;
    while (remainder >= BOOST_ORB_DROP_INTERVAL_SEC) {
      if (snake.segmentCount() <= BOOST_HARD_MIN_SEGMENTS) {
        remainder = 0;
        break;
      }

      const dropPoint = snake.shedTailSegment();
      if (!dropPoint) {
        remainder = 0;
        break;
      }

      this.orbManager.spawnSingle(dropPoint, ORB_MIN_SIZE);
      remainder -= BOOST_ORB_DROP_INTERVAL_SEC;
    }

    this.boostDropTimers.set(snake.id, remainder);
  }

  private findNearestHumanHead(from: Vec2): Vec2 | null {
    let nearest: Vec2 | null = null;
    let nearestDistSq = Number.POSITIVE_INFINITY;

    for (const snake of this.snakes.values()) {
      if (!snake.alive || snake.isBot) {
        continue;
      }

      const head = snake.headPosition();
      const dx = head.x - from.x;
      const dy = head.y - from.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < nearestDistSq) {
        nearestDistSq = distSq;
        nearest = head;
      }
    }

    return nearest;
  }

  private findNearbyThreats(forSnake: Snake): SegmentHazard[] {
    const hazards: SegmentHazard[] = [];
    const from = forSnake.headPosition();

    for (const snake of this.snakes.values()) {
      /* changed by gemini - bots ignore their own body hazards to allow coiling like real slither.io */
      if (!snake.alive || snake.id === forSnake.id) {
        continue;
      }

      const segments = snake.getSegments();
      const baseWeight = 1 + Math.min(4, segments.length / 10);
      const step = 2; // High resolution for hazard mapping
      
      for (let i = 0; i < segments.length; i += step) {
        const segment = segments[i];
        const dx = segment.x - from.x;
        const dy = segment.y - from.y;
        const distSq = dx * dx + dy * dy;
        if (distSq > 900 * 900) {
          continue;
        }

        const headBias = i < 5 ? 0.85 : 0;
        hazards.push({
          point: { x: segment.x, y: segment.y },
          weight: baseWeight + headBias
        });
      }
    }

    return hazards;
  }

  private buildOrbGrid(orbs: OrbState[]): Map<string, OrbState[]> {
    const grid = new Map<string, OrbState[]>();
    for (const orb of orbs) {
      const cellX = Math.floor(orb.x / ORB_GRID_CELL_SIZE);
      const cellY = Math.floor(orb.y / ORB_GRID_CELL_SIZE);
      const key = `${cellX},${cellY}`;
      const list = grid.get(key);
      if (list) {
        list.push(orb);
      } else {
        grid.set(key, [orb]);
      }
    }
    return grid;
  }

  private getNearbyOrbsFromGrid(grid: Map<string, OrbState[]>, center: Vec2, radius: number): OrbState[] {
    const result: OrbState[] = [];
    const radiusSq = radius * radius;
    const minCellX = Math.floor((center.x - radius) / ORB_GRID_CELL_SIZE);
    const maxCellX = Math.floor((center.x + radius) / ORB_GRID_CELL_SIZE);
    const minCellY = Math.floor((center.y - radius) / ORB_GRID_CELL_SIZE);
    const maxCellY = Math.floor((center.y + radius) / ORB_GRID_CELL_SIZE);

    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
        const key = `${cellX},${cellY}`;
        const bucket = grid.get(key);
        if (!bucket) {
          continue;
        }
        for (const orb of bucket) {
          const dx = orb.x - center.x;
          const dy = orb.y - center.y;
          if (dx * dx + dy * dy <= radiusSq) {
            result.push(orb);
          }
        }
      }
    }

    return result;
  }

  private findNearbySnakes(forSnake: Snake): NearbySnake[] {
    const nearby: NearbySnake[] = [];
    const from = forSnake.headPosition();
    for (const snake of this.snakes.values()) {
      if (!snake.alive || snake.id === forSnake.id) {
        continue;
      }

      const head = snake.headPosition();
      const dx = head.x - from.x;
      const dy = head.y - from.y;
      const distSq = dx * dx + dy * dy;
      if (distSq > 1200 * 1200) {
        continue;
      }

      const segments = snake.getSegments();
      let headingX = 1;
      let headingY = 0;
      if (segments.length >= 2) {
        const vx = segments[0].x - segments[1].x;
        const vy = segments[0].y - segments[1].y;
        const mag = Math.hypot(vx, vy) || 1;
        headingX = vx / mag;
        headingY = vy / mag;
      }

      nearby.push({
        id: snake.id,
        head,
        heading: { x: headingX, y: headingY },
        length: segments.length,
        isBot: snake.isBot
      });
    }
    return nearby;
  }

  private pickSpawnPoint(isBot: boolean): Vec2 {
    const alive = Array.from(this.snakes.values()).filter((snake: Snake) => snake.alive);
    const humans = alive.filter((snake: Snake) => !snake.isBot);
    const bots = alive.filter((snake: Snake) => snake.isBot);

    if (!isBot && alive.length > 0) {
      const anchorSource = bots.length > 0 ? bots[Math.floor(Math.random() * bots.length)] : alive[Math.floor(Math.random() * alive.length)];
      return this.spawnNear(anchorSource.headPosition(), 260, 720);
    }

    if (isBot && humans.length > 0) {
      const anchorSource = humans[Math.floor(Math.random() * humans.length)];
      return this.spawnNear(anchorSource.headPosition(), 320, 900);
    }

    return this.randomSpawn();
  }

  private spawnNear(anchor: Vec2, minDistance: number, maxDistance: number): Vec2 {
    for (let i = 0; i < 8; i += 1) {
      const distance = minDistance + Math.random() * (maxDistance - minDistance);
      const angle = Math.random() * Math.PI * 2;
      const candidate = {
        x: anchor.x + Math.cos(angle) * distance,
        y: anchor.y + Math.sin(angle) * distance
      };
      if (candidate.x * candidate.x + candidate.y * candidate.y < (ARENA_RADIUS - 120) * (ARENA_RADIUS - 120)) {
        return candidate;
      }
    }
    return this.randomSpawn();
  }

  private randomSpawn(): Vec2 {
    const radius = Math.sqrt(Math.random()) * (ARENA_RADIUS * 0.8);
    const angle = Math.random() * Math.PI * 2;
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius
    };
  }
}
