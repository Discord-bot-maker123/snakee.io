import { ARENA_RADIUS, SNAKE_BODY_RADIUS, SNAKE_HEAD_RADIUS } from "snakee-shared/constants";
import type { Vec2 } from "snakee-shared/types";
import { Snake } from "./Snake.js";

export type CollisionResult = {
  victimId: string;
  killerId: string | null;
};

const CELL_SIZE = 150;

function insideArena(point: Vec2): boolean {
  return point.x * point.x + point.y * point.y <= ARENA_RADIUS * ARENA_RADIUS;
}

export class Collision {
  public static findDeaths(snakes: Map<string, Snake>): CollisionResult[] {
    const results: CollisionResult[] = [];
    const alive = Array.from(snakes.values()).filter((snake: Snake) => snake.alive);
    
    // 1. Build Spatial Hash Grid
    const grid = new Map<string, Array<{ snakeId: string; pos: Vec2 }>>();
    
    for (const snake of alive) {
      const segments = snake.getSegments();
      for (const segment of segments) {
        const cx = Math.floor(segment.x / CELL_SIZE);
        const cy = Math.floor(segment.y / CELL_SIZE);
        const key = `${cx},${cy}`;
        
        let cell = grid.get(key);
        if (!cell) {
          cell = [];
          grid.set(key, cell);
        }
        cell.push({ snakeId: snake.id, pos: segment });
      }
    }

    for (const snake of alive) {
      const head = snake.headPosition();

      // Arena Boundary Check
      if (!insideArena(head)) {
        results.push({ victimId: snake.id, killerId: null });
        continue;
      }

      // 2. Spatial Hash Collision Check
      const cx = Math.floor(head.x / CELL_SIZE);
      const cy = Math.floor(head.y / CELL_SIZE);
      const radius = SNAKE_HEAD_RADIUS + SNAKE_BODY_RADIUS;
      const radiusSq = radius * radius;

      let collided = false;
      // Check 3x3 cells around the head
      for (let x = cx - 1; x <= cx + 1 && !collided; x++) {
        for (let y = cy - 1; y <= cy + 1 && !collided; y++) {
          const key = `${x},${y}`;
          const cell = grid.get(key);
          if (!cell) continue;

          for (const item of cell) {
            // Cannot collide with own segments
            if (item.snakeId === snake.id) continue;

            const dx = head.x - item.pos.x;
            const dy = head.y - item.pos.y;
            if (dx * dx + dy * dy < radiusSq) {
              results.push({ victimId: snake.id, killerId: item.snakeId });
              collided = true;
              break;
            }
          }
        }
      }
    }

    // Dedupe results (one death per snake per tick)
    const deduped = new Map<string, CollisionResult>();
    for (const result of results) {
      if (!deduped.has(result.victimId)) {
        deduped.set(result.victimId, result);
      }
    }

    return Array.from(deduped.values());
  }
}
