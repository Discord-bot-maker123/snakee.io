import { pack, unpack } from "msgpackr";
import { ARENA_RADIUS, NETWORK_PROTOCOL_VERSION } from "snakee-shared/constants";
import type { ClientMsg, WelcomeMsg } from "snakee-shared/types";
import uWS, { type HttpRequest, type HttpResponse, type WebSocket } from "uWebSockets.js";
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

type UserData = {
  id: string;
  accessToken: string | null;
  authUserId: string | null;
};

type ConnectedClient = {
  id: string;
  ws: WebSocket<UserData>;
  sync: ClientSyncState;
  authUserId: string | null;
};

const PORT = Number(process.env.PORT ?? 9001);
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

function parseQueryToken(query: string | null | undefined): string | null {
  if (!query || query.length === 0) {
    return null;
  }

  const params = new URLSearchParams(query);
  const token = params.get("access_token");
  return token && token.length > 0 ? token : null;
}

function extractBearerToken(req: HttpRequest): string | null {
  const header = req.getHeader("authorization");
  if (header.length > 7 && header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  return null;
}

function sendJson(res: HttpResponse, status: number, payload: unknown): void {
  const statusLine = `${status} ${status >= 200 && status < 300 ? "OK" : "Error"}`;
  res.writeStatus(statusLine);
  res.writeHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function sendError(res: HttpResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

function readJsonBody(res: HttpResponse): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let aborted = false;

    res.onAborted(() => {
      aborted = true;
      reject(new Error("Request aborted"));
    });

    res.onData((arrayBuffer, isLast) => {
      if (aborted) {
        return;
      }

      chunks.push(Buffer.from(arrayBuffer));
      if (!isLast) {
        return;
      }

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
  });
}

async function authenticateHttpRequest(req: HttpRequest): Promise<{ userId: string } | null> {
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

app.get("/api/health", (res) => {
  sendJson(res, 200, { ok: true, supabaseConfigured: isSupabaseConfigured() });
});

app.get("/api/me", (res, req) => {
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
});

app.patch("/api/me", (res, req) => {
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

    const body = (await readJsonBody(res)) as { displayName?: unknown };
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
});

app.get("/api/leaderboard/all-time", (res) => {
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
});

app.ws<UserData>("/*", {
  upgrade: (res, req, context) => {
    const accessToken = parseQueryToken(req.getQuery?.());
    res.upgrade<UserData>(
      {
        id: "",
        accessToken,
        authUserId: null
      },
      req.getHeader("sec-websocket-key"),
      req.getHeader("sec-websocket-protocol"),
      req.getHeader("sec-websocket-extensions"),
      context
    );
  },
  idleTimeout: 32,
  maxPayloadLength: 1024,
  open: (ws) => {
    const playerId = `p-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    const userData = ws.getUserData();
    userData.id = playerId;

    const snake = world.addPlayer(playerId, randomPlayerName(), false);

    const client: ConnectedClient = {
      id: playerId,
      ws,
      sync: Broadcaster.createClientSyncState(),
      authUserId: null
    };
    clients.set(playerId, client);

    sendWelcome(client);

    void (async () => {
      if (!isSupabaseConfigured() || !userData.accessToken) {
        return;
      }

      const identity = await verifyAccessToken(userData.accessToken);
      if (!identity) {
        return;
      }

      await ensureProfile(identity);

      const activeClient = clients.get(playerId);
      if (!activeClient) {
        return;
      }

      userData.authUserId = identity.userId;
      activeClient.authUserId = identity.userId;
      if (snake.alive) {
        world.setSnakeName(playerId, sanitizeName(identity.displayName));
      }
    })().catch(() => {
      // Authentication failures should not block guest gameplay.
    });
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
    world.removeSnake(userData.id, false);
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
      if (isSupabaseConfigured() && victim.authUserId) {
        void recordDeathForUser(victim.authUserId, death.finalScore, death.finalLength).catch(() => {
          // Do not block real-time loop on persistence errors.
        });
      }

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
