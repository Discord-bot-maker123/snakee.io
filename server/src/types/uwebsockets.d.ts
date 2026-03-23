declare module "uWebSockets.js" {
  export interface HttpRequest {
    getHeader(name: string): string;
    getQuery(): string;
    getUrl(): string;
    getMethod(): string;
  }

  export interface HttpResponse {
    onAborted(handler: () => void): HttpResponse;
    onData(handler: (chunk: ArrayBuffer, isLast: boolean) => void): HttpResponse;
    writeStatus(status: string): HttpResponse;
    writeHeader(key: string, value: string): HttpResponse;
    end(body?: string | ArrayBuffer): HttpResponse;
    cork(handler: () => void): HttpResponse;
    upgrade<UserData = unknown>(
      userData: UserData,
      secWebSocketKey: string,
      secWebSocketProtocol: string,
      secWebSocketExtensions: string,
      context: unknown
    ): void;
  }

  export interface WebSocket<UserData = unknown> {
    getUserData(): UserData;
    send(message: string | ArrayBuffer | Uint8Array, isBinary?: boolean, compress?: boolean): number;
    end(code?: number, shortMessage?: string): WebSocket<UserData>;
  }

  export interface WebSocketBehavior<UserData = unknown> {
    idleTimeout?: number;
    maxPayloadLength?: number;
    upgrade?: (res: HttpResponse, req: HttpRequest, context: unknown) => void;
    open?: (ws: WebSocket<UserData>) => void;
    message?: (ws: WebSocket<UserData>, message: ArrayBuffer, isBinary: boolean) => void;
    close?: (ws: WebSocket<UserData>, code: number, message: ArrayBuffer) => void;
  }

  export interface TemplatedApp {
    get(pattern: string, handler: (res: HttpResponse, req: HttpRequest) => void): TemplatedApp;
    patch(pattern: string, handler: (res: HttpResponse, req: HttpRequest) => void): TemplatedApp;
    ws<UserData = unknown>(pattern: string, behavior: WebSocketBehavior<UserData>): TemplatedApp;
    listen(port: number, cb: (token: unknown) => void): TemplatedApp;
  }

  export function App(options?: Record<string, unknown>): TemplatedApp;

  const uwsDefault: {
    App: typeof App;
  };

  export default uwsDefault;
}
