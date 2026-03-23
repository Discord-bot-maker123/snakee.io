declare module "uWebSockets.js" {
  export interface WebSocket<UserData = unknown> {
    getUserData(): UserData;
    send(message: string | ArrayBuffer | Uint8Array, isBinary?: boolean, compress?: boolean): number;
    end(code?: number, shortMessage?: string): WebSocket<UserData>;
  }

  export interface WebSocketBehavior<UserData = unknown> {
    idleTimeout?: number;
    maxPayloadLength?: number;
    open?: (ws: WebSocket<UserData>) => void;
    message?: (ws: WebSocket<UserData>, message: ArrayBuffer, isBinary: boolean) => void;
    close?: (ws: WebSocket<UserData>, code: number, message: ArrayBuffer) => void;
  }

  export interface TemplatedApp {
    ws<UserData = unknown>(pattern: string, behavior: WebSocketBehavior<UserData>): TemplatedApp;
    listen(port: number, cb: (token: unknown) => void): TemplatedApp;
  }

  export function App(options?: Record<string, unknown>): TemplatedApp;

  const uwsDefault: {
    App: typeof App;
  };

  export default uwsDefault;
}
