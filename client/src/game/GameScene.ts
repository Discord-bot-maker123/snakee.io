import * as PIXI from "pixi.js";
import {
  ARENA_BORDER_COLOR,
  ARENA_RADIUS,
  BACKGROUND_COLOR,
  SERVER_TICK_RATE,
  SNAKE_BASE_SPEED,
  BOOST_MULTIPLIER
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
import { StartMenu } from "../ui/StartMenu";

type SnapshotState = {
  snakes: Map<string, SnakeState>;
  orbs: Map<string, OrbState>;
  leaderboard: LeaderboardEntry[];
  time: number;
};

const TICK_INTERVAL_MS = 1000 / SERVER_TICK_RATE;

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

  private localTickTime: number;

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
    this.startMenu = new StartMenu(root, (nickname: string) => {
      this.startSession(root, nickname);
    });
    this.sessionStarted = false;

    this.playerId = null;
    this.previous = { snakes: new Map<string, SnakeState>(), orbs: new Map<string, OrbState>(), leaderboard: [], time: 0 };
    this.current = { snakes: new Map<string, SnakeState>(), orbs: new Map<string, OrbState>(), leaderboard: [], time: 0 };
    this.localTickTime = performance.now();
    this.ambienceTime = 0;

    this.app.ticker.add((ticker: PIXI.Ticker) => {
      this.render(ticker.deltaMS);
    });
  }

  private startSession(root: HTMLElement, nickname: string): void {
    if (this.sessionStarted) {
      return;
    }
    this.sessionStarted = true;
    void this.backgroundMusic.ensureRunning();

    const socket = new SocketClient();
    this.socket = socket;
    this.inputHandler = new InputHandler(root, socket);
    this.hud = new HUD(root);
    this.deathScreen = new DeathScreen(root, () => {
      window.location.reload();
    });
    this.wireSocket();
    socket.connect();
    socket.setDisplayName(nickname);
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
      this.localTickTime = performance.now();
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
    this.localTickTime = performance.now();
  }

  private render(deltaMs: number): void {
    this.ambienceTime += deltaMs * 0.001;
    const now = performance.now();
    const alpha = Math.min(1, Math.max(0, (now - this.localTickTime) / TICK_INTERVAL_MS));

    const renderedSnakes: SnakeState[] = [];
    for (const [id, snake] of this.current.snakes.entries()) {
      const prev = this.previous.snakes.get(id) ?? snake;
      renderedSnakes.push(this.interpolateSnake(prev, snake, alpha));
    }

    const renderedOrbs: OrbState[] = Array.from(this.current.orbs.values());

    this.snakeRenderer.render(renderedSnakes);
    this.orbRenderer.render(renderedOrbs, deltaMs);

    const player = this.playerId ? this.current.snakes.get(this.playerId) : undefined;
    const playerHead: Vec2 = player?.segments[0] ?? { x: 0, y: 0 };
    const speedRatio = this.inputHandler?.isBoosting() ? BOOST_MULTIPLIER / SNAKE_BASE_SPEED : 0;

    this.camera.update(playerHead, speedRatio);

    // Update input handler with player's screen position
    if (this.inputHandler && player) {
      const screenX = this.app.renderer.width * 0.5 + (playerHead.x - this.camera["position"].x) * this.camera["zoom"];
      const screenY = this.app.renderer.height * 0.5 + (playerHead.y - this.camera["position"].y) * this.camera["zoom"];
      this.inputHandler.setPlayerScreenPos(screenX, screenY);
    }

    this.arenaGlow.alpha = 0.14 + (Math.sin(this.ambienceTime * 1.7) + 1) * 0.09;
    if (this.hud) {
      this.hud.updateScore(player);
      this.hud.updateLeaderboard(this.current.leaderboard);
    }
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
    graphics.lineStyle({ width: 12, color: 0x1c2833, alpha: 0.9 });
    graphics.drawCircle(0, 0, ARENA_RADIUS);
    // Inner glow-like line
    graphics.lineStyle({ width: 2, color: 0x2e4053, alpha: 0.4 });
    graphics.drawCircle(0, 0, ARENA_RADIUS - 6);
    return graphics;
  }

  private createArenaGlowLayer(): PIXI.Graphics {
    /* changed by gemini */
    const graphics = new PIXI.Graphics();
    // Soft outer fade
    graphics.lineStyle({ width: 30, color: 0x000000, alpha: 0.5 });
    graphics.drawCircle(0, 0, ARENA_RADIUS + 15);
    return graphics;
  }
}
