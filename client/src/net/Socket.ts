import { pack, unpack } from "msgpackr";
import type { DeathMsg, InputMsg, JoinMsg, ServerMsg, TickMsg, WelcomeMsg } from "snakee-shared/types";

type TickHandler = (message: TickMsg) => void;
type WelcomeHandler = (message: WelcomeMsg) => void;
type DeathHandler = (message: DeathMsg) => void;

const wsUrlFromEnv = import.meta.env.VITE_WS_URL as string | undefined;

export class SocketClient {
  private ws: WebSocket | null;

  private onTickHandler: TickHandler | null;

  private onWelcomeHandler: WelcomeHandler | null;

  private onDeathHandler: DeathHandler | null;

  private pendingName: string | null;

  private accessToken: string | null;

  public constructor() {
    this.ws = null;
    this.onTickHandler = null;
    this.onWelcomeHandler = null;
    this.onDeathHandler = null;
    this.pendingName = null;
    this.accessToken = null;
  }

  public connect(): void {
    const url = (() => {
      if (wsUrlFromEnv && wsUrlFromEnv.length > 0) {
        return new URL(wsUrlFromEnv);
      }

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.port === "5173" ? `${window.location.hostname}:9001` : window.location.host;
      return new URL(`${protocol}//${host}`);
    })();

    if (this.accessToken) {
      url.searchParams.set("access_token", this.accessToken);
    }

    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
      this.ws.onclose = null;
      this.ws.close();
    }

    this.ws = new WebSocket(url.toString());
    this.ws.binaryType = "arraybuffer";
    this.ws.onopen = (): void => {
      if (this.pendingName) {
        this.sendJoin(this.pendingName);
      }
    };

    this.ws.onmessage = (event: MessageEvent<ArrayBuffer>): void => {
      const decoded = unpack(new Uint8Array(event.data)) as ServerMsg;
      this.routeMessage(decoded);
    };

    this.ws.onclose = (): void => {
      window.setTimeout(() => {
        this.connect();
      }, 1200);
    };
  }

  public onTick(handler: TickHandler): void {
    this.onTickHandler = handler;
  }

  public onWelcome(handler: WelcomeHandler): void {
    this.onWelcomeHandler = handler;
  }

  public onDeath(handler: DeathHandler): void {
    this.onDeathHandler = handler;
  }

  public setDisplayName(name: string): void {
    this.pendingName = name;
    this.sendJoin(name);
  }

  public setAccessToken(accessToken: string | null): void {
    this.accessToken = accessToken;
  }

  public sendInput(payload: InputMsg): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    const encoded = pack(payload);
    this.ws.send(encoded);
  }

  private routeMessage(message: ServerMsg): void {
    if (message.type === "welcome" && this.onWelcomeHandler) {
      this.onWelcomeHandler(message);
      return;
    }

    if (message.type === "tick" && this.onTickHandler) {
      this.onTickHandler(message);
      return;
    }

    if (message.type === "death" && this.onDeathHandler) {
      this.onDeathHandler(message);
    }
  }

  private sendJoin(name: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const payload: JoinMsg = {
      type: "join",
      name
    };
    this.ws.send(pack(payload));
  }
}
