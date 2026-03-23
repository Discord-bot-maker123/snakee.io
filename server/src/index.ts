import { pack, unpack } from "msgpackr";
import { ARENA_RADIUS, NETWORK_PROTOCOL_VERSION } from "snakee-shared/constants";
import type { ClientMsg, WelcomeMsg } from "snakee-shared/types";
import uWS, { type WebSocket } from "uWebSockets.js";
import { World } from "./game/World.js";
import { Broadcaster, type ClientSyncState } from "./net/Broadcaster.js";

type UserData = {
  id: string;
};

type ConnectedClient = {
  id: string;
  ws: WebSocket<UserData>;
  sync: ClientSyncState;
};

const PORT = 9001;
const world = new World();
const clients = new Map<string, ConnectedClient>();

function randomPlayerName(): string {
  return `Player${Math.floor(Math.random() * 9999)}`;
}

function sanitizeName(rawName: string): string {
  const cleaned = rawName.replace(/\s+/g, " ").trim().slice(0, 18);
  if (cleaned.length === 0) {
    return randomPlayerName();
  }
  return cleaned;
}

function parseClientMessage(raw: ArrayBuffer): ClientMsg | null {
  try {
    const decoded = unpack(new Uint8Array(raw)) as ClientMsg;
    if (decoded.type === "join") {
      return decoded;
    }
    if (decoded.type !== "input") {
      return null;
    }
    if (!Number.isFinite(decoded.angle) || !Number.isFinite(decoded.seq)) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

function sendWelcome(client: ConnectedClient): void {
  const welcome: WelcomeMsg = {
    type: "welcome",
    protocolVersion: NETWORK_PROTOCOL_VERSION,
    playerId: client.id,
    worldRadius: ARENA_RADIUS,
    serverTime: Date.now(),
    snakes: world.getSnakesState(),
    orbs: world.getOrbsState()
  };

  client.ws.send(pack(welcome), true, false);
}

const app = uWS.App();

app.ws<UserData>("/*", {
  idleTimeout: 32,
  maxPayloadLength: 1024,
  open: (ws) => {
    const playerId = `p-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    const userData = ws.getUserData();
    userData.id = playerId;

    world.addPlayer(playerId, randomPlayerName(), false);

    const client: ConnectedClient = {
      id: playerId,
      ws,
      sync: Broadcaster.createClientSyncState()
    };
    clients.set(playerId, client);

    sendWelcome(client);
  },
  message: (ws, message) => {
    const clientMsg = parseClientMessage(message);
    if (!clientMsg) {
      return;
    }

    const userData = ws.getUserData();
    if (clientMsg.type === "join") {
      world.setSnakeName(userData.id, sanitizeName(clientMsg.name));
      return;
    }

    world.handleInput(userData.id, clientMsg.angle, clientMsg.boosting, clientMsg.seq);
  },
  close: (ws) => {
    const userData = ws.getUserData();
    clients.delete(userData.id);
    world.removeSnake(userData.id);
  }
});

world.start(({ tick, deaths }) => {
  if (clients.size === 0) {
    return;
  }

  const now = Date.now();
  const snakes = world.getSnakesState();
  const orbs = world.getOrbsState();
  const leaderboard = world.getLeaderboard();
  const removedFromDeaths = deaths.map((death) => death.victimId);

  for (const client of clients.values()) {
    const payload = Broadcaster.buildTick(client.sync, tick, now, snakes, orbs, leaderboard, removedFromDeaths);
    client.ws.send(pack(payload), true, false);
  }

  for (const death of deaths) {
    const victim = clients.get(death.victimId);
    if (victim) {
      victim.ws.send(
        pack({
          type: "death",
          victimId: death.victimId,
          killerId: death.killerId,
          killerName: death.killerName,
          finalScore: death.finalScore,
          finalLength: death.finalLength
        }),
        true,
        false
      );
    }
  }
});

app.listen(PORT, (token) => {
  if (!token) {
    throw new Error(`Failed to listen on port ${PORT}`);
  }
  // eslint-disable-next-line no-console
  console.log(`snakee.io server running on ws://localhost:${PORT}`);
});
