import type { OrbState, SnakeState, TickMsg } from "snakee-shared/types";

export type ClientSyncState = {
  snakeSignatures: Map<string, string>;
  orbSignatures: Map<string, string>;
};

export class Broadcaster {
  public static createClientSyncState(): ClientSyncState {
    return {
      snakeSignatures: new Map<string, string>(),
      orbSignatures: new Map<string, string>()
    };
  }

  public static buildTick(
    syncState: ClientSyncState,
    tick: number,
    serverTime: number,
    snakes: SnakeState[],
    orbs: OrbState[],
    leaderboard: TickMsg["leaderboard"],
    forcedRemovedSnakeIds: string[] = []
  ): TickMsg {
    const changedSnakes: SnakeState[] = [];
    const changedOrbs: OrbState[] = [];

    const currentSnakeIds = new Set<string>();
    const currentOrbIds = new Set<string>();

    for (const snake of snakes) {
      currentSnakeIds.add(snake.id);
      const signature = this.snakeSignature(snake);
      if (syncState.snakeSignatures.get(snake.id) !== signature) {
        changedSnakes.push(snake);
        syncState.snakeSignatures.set(snake.id, signature);
      }
    }

    for (const orb of orbs) {
      currentOrbIds.add(orb.id);
      const signature = this.orbSignature(orb);
      if (syncState.orbSignatures.get(orb.id) !== signature) {
        changedOrbs.push(orb);
        syncState.orbSignatures.set(orb.id, signature);
      }
    }

    const removedSnakeIds: string[] = [];
    for (const knownId of syncState.snakeSignatures.keys()) {
      if (!currentSnakeIds.has(knownId)) {
        removedSnakeIds.push(knownId);
      }
    }
    if (forcedRemovedSnakeIds.length > 0) {
      const removedSet = new Set<string>(removedSnakeIds);
      for (const removedId of forcedRemovedSnakeIds) {
        if (!removedSet.has(removedId)) {
          removedSet.add(removedId);
          removedSnakeIds.push(removedId);
        }
      }
    }

    const removedOrbIds: string[] = [];
    for (const knownId of syncState.orbSignatures.keys()) {
      if (!currentOrbIds.has(knownId)) {
        removedOrbIds.push(knownId);
      }
    }

    for (const removedId of removedSnakeIds) {
      syncState.snakeSignatures.delete(removedId);
    }

    for (const removedId of removedOrbIds) {
      syncState.orbSignatures.delete(removedId);
    }

    return {
      type: "tick",
      serverTime,
      tick,
      snakes: changedSnakes,
      orbs: changedOrbs,
      removedSnakeIds,
      removedOrbIds,
      leaderboard
    };
  }

  private static snakeSignature(snake: SnakeState): string {
    const head = snake.segments[0] ?? { x: 0, y: 0 };
    return `${snake.id}:${head.x.toFixed(1)}:${head.y.toFixed(1)}:${snake.score}:${snake.segments.length}:${snake.alive ? 1 : 0}`;
  }

  private static orbSignature(orb: OrbState): string {
    return `${orb.id}:${orb.x.toFixed(1)}:${orb.y.toFixed(1)}:${orb.size.toFixed(1)}:${orb.color}`;
  }
}
