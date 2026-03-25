import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pack, unpack } from "msgpackr";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { ARENA_RADIUS, NETWORK_PROTOCOL_VERSION } from "snakee-shared/constants";
import type { ClientMsg, DeathMsg, WelcomeMsg } from "snakee-shared/types";
import {
  ensureProfile,
  getAllTimeLeaderboard,
  getProfileWithStats,
  isSupabaseConfigured,
  recordDeathForUser,
  updateDisplayName,
  verifyAccessToken
} from "./auth/supabase.js";
import { World } from "./game/World.js";
import { Broadcaster, type ClientSyncState } from "./net/Broadcaster.js";

type ConnectedClient = {
  id: string;
  ws: WebSocket;
  sync: ClientSyncState;
  authUserId: string | null;
  roomId: string;
};

type MatchRoom = {
  id: string;
  world: World;
  clients: Map<string, ConnectedClient>;
};

const PORT = Number(process.env.PORT ?? 9001);
const ALLOWED_ORIGIN = process.env.CORS_ORIGIN ?? "*";
const MAX_PLAYERS_PER_ROOM = Number(process.env.MATCH_MAX_PLAYERS ?? 24);

const rooms = new Map<string, MatchRoom>();
const clientsBySocket = new WeakMap<WebSocket, ConnectedClient>();
const wsServer = new WebSocketServer({ noServer: true });

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

function rawDataToBytes(raw: RawData): Uint8Array {
  if (raw instanceof Uint8Array) {
    return raw;
  }
  if (raw instanceof ArrayBuffer) {
    return new Uint8Array(raw);
  }
  if (Array.isArray(raw)) {
    const merged = Buffer.concat(raw);
    return new Uint8Array(merged.buffer, merged.byteOffset, merged.byteLength);
  }
  const buffer = Buffer.from(raw);
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

function parseClientMessage(raw: RawData): ClientMsg | null {
  try {
    const decoded = unpack(rawDataToBytes(raw)) as ClientMsg;
    if (decoded.type === "join") {
      return decoded;
    }
    if (decoded.type !== "input") {
      return null;
    }
    if (!Number.isFinite(decoded.angle) || !Number.isFinite(decoded.seq)) {
      return null;
    }
    return { ...decoded, boosting: Boolean(decoded.boosting) };
  } catch {
    return null;
  }
}

function parseAccessTokenFromRequestUrl(req: IncomingMessage): string | null {
  const url = req.url;
  if (!url || url.length === 0) {
    return null;
  }

  const parsed = new URL(url, "http://localhost");
  const token = parsed.searchParams.get("access_token");
  return token && token.length > 0 ? token : null;
}

function extractBearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header || header.length <= 7 || !header.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  return header.slice(7).trim();
}

function applyCors(res: ServerResponse): void {
  res.setHeader("access-control-allow-origin", ALLOWED_ORIGIN);
  res.setHeader("access-control-allow-methods", "GET, PATCH, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  applyCors(res);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    req.on("data", (chunk: Buffer | string) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });

    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        if (raw.length === 0) {
          resolve({});
          return;
        }
        resolve(JSON.parse(raw) as unknown);
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });

    req.on("error", (error) => {
      reject(error);
    });
  });
}

async function authenticateHttpRequest(req: IncomingMessage): Promise<{ userId: string } | null> {
  const token = extractBearerToken(req);
  if (!token) {
    return null;
  }

  const identity = await verifyAccessToken(token);
  if (!identity) {
    return null;
  }

  return { userId: identity.userId };
}

function sendWelcome(client: ConnectedClient, room: MatchRoom): void {
  const welcome: WelcomeMsg = {
    type: "welcome",
    protocolVersion: NETWORK_PROTOCOL_VERSION,
    playerId: client.id,
    worldRadius: ARENA_RADIUS,
    serverTime: Date.now(),
    snakes: room.world.getSnakesState(),
    orbs: room.world.getOrbsState()
  };

  client.ws.send(pack(welcome));
}

function sendDeath(client: ConnectedClient, death: DeathMsg): void {
  client.ws.send(pack(death));
}

function createRoom(): MatchRoom {
  const roomId = `room-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const room: MatchRoom = {
    id: roomId,
    world: new World(),
    clients: new Map<string, ConnectedClient>()
  };

  room.world.start(({ tick, deaths }) => {
    if (room.clients.size === 0) {
      return;
    }

    const now = Date.now();
    const snakes = room.world.getSnakesState();
    const orbs = room.world.getOrbsState();
    const leaderboard = room.world.getLeaderboard();
    const removedFromDeaths = deaths.map((death) => death.victimId);

    for (const client of room.clients.values()) {
      if (client.ws.readyState !== client.ws.OPEN) {
        continue;
      }

      const payload = Broadcaster.buildTick(client.sync, tick, now, snakes, orbs, leaderboard, removedFromDeaths);
      client.ws.send(pack(payload));
    }

    for (const death of deaths) {
      const victim = room.clients.get(death.victimId);
      if (!victim || victim.ws.readyState !== victim.ws.OPEN) {
        continue;
      }

      if (isSupabaseConfigured() && victim.authUserId) {
        void recordDeathForUser(victim.authUserId, death.finalScore, death.finalLength).catch(() => {
          // Do not block real-time loop on persistence errors.
        });
      }

      sendDeath(victim, {
        type: "death",
        victimId: death.victimId,
        killerId: death.killerId,
        killerName: death.killerName,
        finalScore: death.finalScore,
        finalLength: death.finalLength
      });
    }
  });

  rooms.set(roomId, room);
  return room;
}

function pickRoomForMatchmaking(): MatchRoom {
  let bestRoom: MatchRoom | null = null;
  let bestSize = Number.POSITIVE_INFINITY;

  for (const room of rooms.values()) {
    const size = room.clients.size;
    if (size >= MAX_PLAYERS_PER_ROOM) {
      continue;
    }
    if (size < bestSize) {
      bestSize = size;
      bestRoom = room;
    }
  }

  return bestRoom ?? createRoom();
}

function removeClientFromRoom(client: ConnectedClient): void {
  const room = rooms.get(client.roomId);
  if (!room) {
    return;
  }

  room.clients.delete(client.id);
  room.world.removeSnake(client.id, false);

  if (room.clients.size === 0) {
    room.world.stop();
    rooms.delete(room.id);
  }
}

function onWebSocketOpen(ws: WebSocket, req: IncomingMessage): void {
  const room = pickRoomForMatchmaking();
  const playerId = `p-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const accessToken = parseAccessTokenFromRequestUrl(req);

  const snake = room.world.addPlayer(playerId, randomPlayerName(), false);
  const client: ConnectedClient = {
    id: playerId,
    ws,
    sync: Broadcaster.createClientSyncState(),
    authUserId: null,
    roomId: room.id
  };

  room.clients.set(playerId, client);
  clientsBySocket.set(ws, client);
  sendWelcome(client, room);

  void (async () => {
    if (!isSupabaseConfigured() || !accessToken) {
      return;
    }

    const identity = await verifyAccessToken(accessToken);
    if (!identity) {
      return;
    }

    await ensureProfile(identity);

    const activeRoom = rooms.get(room.id);
    const activeClient = activeRoom?.clients.get(playerId);
    if (!activeRoom || !activeClient) {
      return;
    }

    activeClient.authUserId = identity.userId;
    if (snake.alive) {
      activeRoom.world.setSnakeName(playerId, sanitizeName(identity.displayName));
    }
  })().catch(() => {
    // Authentication failures should not block gameplay.
  });

  ws.on("message", (message: RawData) => {
    const clientState = clientsBySocket.get(ws);
    if (!clientState) {
      return;
    }

    const activeRoom = rooms.get(clientState.roomId);
    if (!activeRoom) {
      return;
    }

    const clientMsg = parseClientMessage(message);
    if (!clientMsg) {
      return;
    }

    if (clientMsg.type === "join") {
      activeRoom.world.setSnakeName(clientState.id, sanitizeName(clientMsg.name));
      return;
    }

    activeRoom.world.handleInput(clientState.id, clientMsg.angle, clientMsg.boosting, clientMsg.seq);
  });

  ws.on("close", () => {
    const clientState = clientsBySocket.get(ws);
    if (!clientState) {
      return;
    }

    removeClientFromRoom(clientState);
  });
}

const server = createServer((req, res) => {
  const method = req.method ?? "GET";
  const parsedUrl = new URL(req.url ?? "/", "http://localhost");
  const pathname =
    parsedUrl.pathname.length > 1 && parsedUrl.pathname.endsWith("/")
      ? parsedUrl.pathname.slice(0, -1)
      : parsedUrl.pathname;

  if (method === "OPTIONS") {
    applyCors(res);
    res.statusCode = 204;
    res.end();
    return;
  }

  if (method === "GET" && pathname === "/api/health") {
    const connectedClients = Array.from(rooms.values()).reduce((acc, room) => acc + room.clients.size, 0);
    sendJson(res, 200, {
      ok: true,
      supabaseConfigured: isSupabaseConfigured(),
      rooms: rooms.size,
      connectedPlayers: connectedClients,
      maxPlayersPerRoom: MAX_PLAYERS_PER_ROOM
    });
    return;
  }

  if (method === "GET" && pathname === "/api/me") {
    void (async () => {
      if (!isSupabaseConfigured()) {
        sendError(res, 503, "Supabase is not configured.");
        return;
      }

      const auth = await authenticateHttpRequest(req);
      if (!auth) {
        sendError(res, 401, "Unauthorized");
        return;
      }

      const me = await getProfileWithStats(auth.userId);
      if (!me) {
        sendError(res, 404, "Profile not found");
        return;
      }

      sendJson(res, 200, me);
    })().catch(() => {
      sendError(res, 500, "Failed to read profile.");
    });
    return;
  }

  if (method === "PATCH" && pathname === "/api/me") {
    void (async () => {
      if (!isSupabaseConfigured()) {
        sendError(res, 503, "Supabase is not configured.");
        return;
      }

      const auth = await authenticateHttpRequest(req);
      if (!auth) {
        sendError(res, 401, "Unauthorized");
        return;
      }

      const body = (await readJsonBody(req)) as { displayName?: unknown };
      const displayName = typeof body.displayName === "string" ? body.displayName : "";
      if (displayName.trim().length === 0) {
        sendError(res, 400, "displayName is required");
        return;
      }

      const updated = await updateDisplayName(auth.userId, displayName);
      if (!updated) {
        sendError(res, 500, "Failed to update display name.");
        return;
      }

      sendJson(res, 200, updated);
    })().catch((error) => {
      const message = error instanceof Error ? error.message : "Failed to update profile.";
      sendError(res, 500, message);
    });
    return;
  }

  if (method === "GET" && pathname === "/api/leaderboard/all-time") {
    void (async () => {
      if (!isSupabaseConfigured()) {
        sendError(res, 503, "Supabase is not configured.");
        return;
      }

      const leaderboard = await getAllTimeLeaderboard(20);
      sendJson(res, 200, { entries: leaderboard });
    })().catch(() => {
      sendError(res, 500, "Failed to read leaderboard.");
    });
    return;
  }

  sendError(res, 404, "Not found");
});

server.on("upgrade", (req, socket, head) => {
  wsServer.handleUpgrade(req, socket, head, (ws) => {
    onWebSocketOpen(ws, req);
  });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`snakee.io matchmaking server running on ws://localhost:${PORT}`);
});
