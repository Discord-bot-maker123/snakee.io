import * as PIXI from "pixi.js";
import {
  ARENA_BORDER_COLOR,
  ARENA_RADIUS,
  BACKGROUND_COLOR
} from "snakee-shared/constants";
import type {
  LeaderboardEntry,
  OrbState,
  SnakeState,
  TickMsg,
  Vec2,
  WelcomeMsg
} from "snakee-shared/types";
import { Camera } from "./Camera";
import { SnakeRenderer } from "./SnakeRenderer";
import { OrbRenderer } from "./OrbRenderer";
import { InputHandler } from "./InputHandler";
import { BackgroundMusic } from "./BackgroundMusic";
import { SocketClient } from "../net/Socket";
import { HUD } from "../ui/HUD";
import { DeathScreen } from "../ui/DeathScreen";
import { StartMenu, type StartSessionConfig } from "../ui/StartMenu";

type SnapshotState = {
  snakes: Map<string, SnakeState>;
  orbs: Map<string, OrbState>;
  leaderboard: LeaderboardEntry[];
  time: number;
};

const SNAPSHOT_BUFFER_SIZE = 32;
const INTERPOLATION_DELAY_MS = 90;

export class GameScene {
  private readonly app: PIXI.Application;

  private readonly worldLayer: PIXI.Container;

  private readonly orbLayer: PIXI.Container;

  private readonly snakeLayer: PIXI.Container;

  private readonly arenaGlow: PIXI.Graphics;

  private readonly camera: Camera;

  private readonly snakeRenderer: SnakeRenderer;

  private readonly orbRenderer: OrbRenderer;

  private socket: SocketClient | null;

  private inputHandler: InputHandler | null;

  private hud: HUD | null;

  private deathScreen: DeathScreen | null;

  private readonly backgroundMusic: BackgroundMusic;

  private readonly startMenu: StartMenu;

  private sessionStarted: boolean;

  private playerId: string | null;

  private previous: SnapshotState;

  private current: SnapshotState;

  private snapshots: SnapshotState[];

  private ambienceTime: number;

  public static async create(root: HTMLElement): Promise<GameScene> {
    const app = new PIXI.Application();
    await app.init({
      resizeTo: window,
      background: BACKGROUND_COLOR,
      antialias: true
    });
    root.appendChild(app.canvas as HTMLCanvasElement);
    return new GameScene(root, app);
  }

  private constructor(root: HTMLElement, app: PIXI.Application) {
    this.app = app;

    this.worldLayer = new PIXI.Container();
    this.orbLayer = new PIXI.Container();
    this.snakeLayer = new PIXI.Container();
    this.arenaGlow = this.createArenaGlowLayer();

    this.worldLayer.addChild(this.createBackgroundLayer());
    this.worldLayer.addChild(this.createArenaLayer());
    this.worldLayer.addChild(this.arenaGlow);
    this.worldLayer.addChild(this.orbLayer);
    this.worldLayer.addChild(this.snakeLayer);

    this.app.stage.addChild(this.worldLayer);

    this.camera = new Camera(this.worldLayer, this.app.renderer);
    this.snakeRenderer = new SnakeRenderer(this.snakeLayer);
    this.orbRenderer = new OrbRenderer(this.orbLayer, this.app.renderer);

    this.socket = null;
    this.inputHandler = null;
    this.hud = null;
    this.deathScreen = null;
    this.backgroundMusic = new BackgroundMusic();
    this.startMenu = new StartMenu(root, (config: StartSessionConfig) => {
      this.startSession(root, config);
    });
    this.sessionStarted = false;

    this.playerId = null;
    this.previous = { snakes: new Map<string, SnakeState>(), orbs: new Map<string, OrbState>(), leaderboard: [], time: 0 };
    this.current = { snakes: new Map<string, SnakeState>(), orbs: new Map<string, OrbState>(), leaderboard: [], time: 0 };
    this.snapshots = [];
    this.ambienceTime = 0;

    this.app.ticker.add((ticker: PIXI.Ticker) => {
      this.render(ticker.deltaMS);
    });
  }

  private startSession(root: HTMLElement, config: StartSessionConfig): void {
    if (this.sessionStarted) {
      return;
    }
    this.sessionStarted = true;
    void this.backgroundMusic.ensureRunning();

    const socket = new SocketClient();
    socket.setAccessToken(config.accessToken);
    this.socket = socket;
    this.inputHandler = new InputHandler(root, socket);
    this.hud = new HUD(root);
    this.deathScreen = new DeathScreen(root, () => {
      window.location.reload();
    });
    this.wireSocket();
    socket.connect();
    socket.setDisplayName(config.nickname);
  }

  private wireSocket(): void {
    if (!this.socket) {
      return;
    }

    this.socket.onWelcome((message: WelcomeMsg) => {
      this.playerId = message.playerId;
      this.current = {
        snakes: new Map(message.snakes.map((snake: SnakeState) => [snake.id, snake])),
        orbs: new Map(message.orbs.map((orb: OrbState) => [orb.id, orb])),
        leaderboard: [],
        time: message.serverTime
      };
      this.previous = this.cloneState(this.current);
      this.snapshots = [this.cloneState(this.current)];
      if (this.deathScreen) {
        this.deathScreen.hide();
      }
    });

    this.socket.onTick((message: TickMsg) => {
      this.applyTick(message);
    });

    this.socket.onDeath((message) => {
      if (this.playerId && message.victimId === this.playerId && this.deathScreen) {
        this.startMenu.recordGame(message.finalLength, message.finalScore);
        this.deathScreen.show(message);
      }
    });
  }

  private applyTick(message: TickMsg): void {
    this.previous = this.cloneState(this.current);

    for (const removedId of message.removedSnakeIds) {
      this.current.snakes.delete(removedId);
    }
    for (const removedId of message.removedOrbIds) {
      this.current.orbs.delete(removedId);
    }

    for (const snake of message.snakes) {
      this.current.snakes.set(snake.id, snake);
    }

    for (const orb of message.orbs) {
      this.current.orbs.set(orb.id, orb);
    }

    this.current.leaderboard = message.leaderboard;
    this.current.time = message.serverTime;
    this.snapshots.push(this.cloneState(this.current));
    if (this.snapshots.length > SNAPSHOT_BUFFER_SIZE) {
      this.snapshots.splice(0, this.snapshots.length - SNAPSHOT_BUFFER_SIZE);
    }
  }

  private render(deltaMs: number): void {
    this.ambienceTime += deltaMs * 0.001;
    const serverRenderTime = Date.now() - INTERPOLATION_DELAY_MS;
    const interpolation = this.pickInterpolationSnapshots(serverRenderTime);
    const renderedSnakes = this.buildRenderedSnakes(interpolation.from, interpolation.to, interpolation.alpha);
    const renderedOrbs: OrbState[] = Array.from(interpolation.to.orbs.values());

    this.snakeRenderer.render(renderedSnakes);
    this.orbRenderer.render(renderedOrbs, deltaMs);

    const renderedById = new Map<string, SnakeState>(renderedSnakes.map((snake: SnakeState) => [snake.id, snake]));
    const player = this.playerId ? renderedById.get(this.playerId) : undefined;
    const playerHead: Vec2 = player?.segments[0] ?? { x: 0, y: 0 };
    const speedRatio = this.inputHandler?.isBoosting() ? 1 : 0;

    this.camera.update(playerHead, speedRatio);

    // Update input handler with player's screen position
    if (this.inputHandler && player) {
      const screenPosition = this.camera.worldToScreen(playerHead);
      this.inputHandler.setPlayerScreenPos(screenPosition.x, screenPosition.y);
    }

    this.arenaGlow.alpha = 0.14 + (Math.sin(this.ambienceTime * 1.7) + 1) * 0.09;
    if (this.hud) {
      this.hud.updateScore(player);
      this.hud.updateLeaderboard(interpolation.to.leaderboard);
    }
  }

  private pickInterpolationSnapshots(serverRenderTime: number): {
    from: SnapshotState;
    to: SnapshotState;
    alpha: number;
  } {
    if (this.snapshots.length === 0) {
      return {
        from: this.current,
        to: this.current,
        alpha: 1
      };
    }

    let from = this.snapshots[0];
    let to = this.snapshots[this.snapshots.length - 1];

    for (let i = 0; i < this.snapshots.length - 1; i += 1) {
      const a = this.snapshots[i];
      const b = this.snapshots[i + 1];
      if (serverRenderTime >= a.time && serverRenderTime <= b.time) {
        from = a;
        to = b;
        break;
      }

      if (serverRenderTime < a.time) {
        from = a;
        to = a;
        break;
      }
    }

    const duration = Math.max(1, to.time - from.time);
    const alpha = Math.min(1, Math.max(0, (serverRenderTime - from.time) / duration));

    while (this.snapshots.length > 2 && this.snapshots[1].time < serverRenderTime - INTERPOLATION_DELAY_MS) {
      this.snapshots.shift();
    }

    return { from, to, alpha };
  }

  private buildRenderedSnakes(from: SnapshotState, to: SnapshotState, alpha: number): SnakeState[] {
    const rendered: SnakeState[] = [];
    for (const [id, snake] of to.snakes.entries()) {
      const previous = from.snakes.get(id) ?? snake;
      rendered.push(this.interpolateSnake(previous, snake, alpha));
    }
    return rendered;
  }

  private interpolateSnake(previous: SnakeState, current: SnakeState, alpha: number): SnakeState {
    const segmentCount = Math.min(previous.segments.length, current.segments.length);
    const segments = new Array(segmentCount);
    for (let i = 0; i < segmentCount; i += 1) {
      const a = previous.segments[i];
      const b = current.segments[i];
      segments[i] = {
        x: a.x + (b.x - a.x) * alpha,
        y: a.y + (b.y - a.y) * alpha
      };
    }

    return {
      ...current,
      segments
    };
  }

  private cloneState(state: SnapshotState): SnapshotState {
    const snakes = new Map<string, SnakeState>();
    for (const [id, snake] of state.snakes.entries()) {
      snakes.set(id, {
        ...snake,
        segments: snake.segments.map((segment: Vec2) => ({ ...segment }))
      });
    }

    const orbs = new Map<string, OrbState>();
    for (const [id, orb] of state.orbs.entries()) {
      orbs.set(id, { ...orb });
    }

    return {
      snakes,
      orbs,
      leaderboard: state.leaderboard.map((entry: LeaderboardEntry) => ({ ...entry })),
      time: state.time
    };
  }

  private createBackgroundLayer(): PIXI.Graphics {
    /* changed by gemini */
    const graphics = new PIXI.Graphics();
    const hexRadius = 42;
    // Flat-topped hex math
    const stepX = hexRadius * 1.5;
    const stepY = Math.sqrt(3) * hexRadius;

    let rowIndex = 0;
    for (let x = -ARENA_RADIUS - hexRadius; x <= ARENA_RADIUS + hexRadius; x += stepX) {
      const yOffset = rowIndex % 2 === 0 ? 0 : stepY * 0.5;
      for (let y = -ARENA_RADIUS - stepY; y <= ARENA_RADIUS + stepY; y += stepY) {
        const cx = x;
        const cy = y + yOffset;
        const distSq = cx * cx + cy * cy;
        if (distSq > (ARENA_RADIUS + hexRadius * 2) * (ARENA_RADIUS + hexRadius * 2)) {
          continue;
        }

        // 1. Deep shadow/grout layer (slightly offset down-right)
        graphics.beginFill(0x040609, 0.95);
        this.drawHexagon(graphics, cx + 2, cy + 2, hexRadius * 0.92);
        graphics.endFill();

        // 2. Main tile body (matching the dark blue-grey in image)
        graphics.beginFill(0x0d121a, 1);
        this.drawHexagon(graphics, cx, cy, hexRadius * 0.88);
        graphics.endFill();

        // 3. Digital Pulse/Highlight (High-tech cyan/blue tint)
        graphics.beginFill(0x1a2b3c, 0.4);
        this.drawHexagon(graphics, cx - 1, cy - 1, hexRadius * 0.78);
        graphics.endFill();
      }
      rowIndex += 1;
    }

    return graphics;
  }

  private drawHexagon(graphics: PIXI.Graphics, cx: number, cy: number, radius: number): void {
    /* changed by gemini */
    const points: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      // Flat-topped: angles 0, 60, 120, 180, 240, 300
      const angle = (Math.PI / 3) * i;
      const px = cx + Math.cos(angle) * radius;
      const py = cy + Math.sin(angle) * radius;
      points.push(px, py);
    }
    graphics.drawPolygon(points);
  }

  private createArenaLayer(): PIXI.Graphics {
    /* changed by gemini */
    const graphics = new PIXI.Graphics();
    // Subtle dark border
    graphics.lineStyle(12, 0x1c2833, 0.9);
    graphics.drawCircle(0, 0, ARENA_RADIUS);
    // Inner glow-like line
    graphics.lineStyle(2, 0x2e4053, 0.4);
    graphics.drawCircle(0, 0, ARENA_RADIUS - 6);
    return graphics;
  }

  private createArenaGlowLayer(): PIXI.Graphics {
    /* changed by gemini */
    const graphics = new PIXI.Graphics();
    // Soft outer fade
    graphics.lineStyle(30, 0x000000, 0.5);
    graphics.drawCircle(0, 0, ARENA_RADIUS + 15);
    return graphics;
  }
}
