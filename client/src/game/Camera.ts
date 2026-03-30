import * as PIXI from "pixi.js";
import {
  ARENA_RADIUS,
  CAMERA_LERP,
  CAMERA_ZOOM_MAX,
  CAMERA_ZOOM_MIN
} from "snakee-shared/constants";
import type { Vec2 } from "snakee-shared/types";

export class Camera {
  private readonly world: PIXI.Container;

  private readonly renderer: PIXI.Renderer;

  private position: Vec2;

  private zoom: number;

  private lastTarget: Vec2 | null;

  private smoothedVelocity: Vec2;

  private static readonly DEADZONE = 8;

  public constructor(world: PIXI.Container, renderer: PIXI.Renderer) {
    this.world = world;
    this.renderer = renderer;
    this.position = { x: 0, y: 0 };
    this.zoom = 1;
    this.lastTarget = null;
    this.smoothedVelocity = { x: 0, y: 0 };
  }

  public update(target: Vec2, speedRatio: number, deltaMs: number): void {
    const frameScale = Math.max(0.25, Math.min(3, deltaMs / (1000 / 60)));
    const followAlpha = 1 - Math.pow(1 - CAMERA_LERP, frameScale);

    const rawVelocity = this.lastTarget
      ? { x: target.x - this.lastTarget.x, y: target.y - this.lastTarget.y }
      : { x: 0, y: 0 };
    this.lastTarget = { ...target };

    // Smooth velocity with EMA to prevent camera jerk on sharp turns
    const velAlpha = 0.15;
    this.smoothedVelocity.x += (rawVelocity.x - this.smoothedVelocity.x) * velAlpha;
    this.smoothedVelocity.y += (rawVelocity.y - this.smoothedVelocity.y) * velAlpha;

    const lookAheadFactor = 3 + Math.min(1, Math.max(0, speedRatio)) * 4;
    const desired = {
      x: target.x + this.smoothedVelocity.x * lookAheadFactor,
      y: target.y + this.smoothedVelocity.y * lookAheadFactor
    };

    const dx = desired.x - this.position.x;
    const dy = desired.y - this.position.y;

    if (Math.abs(dx) > Camera.DEADZONE) {
      this.position.x += dx * followAlpha;
    }
    if (Math.abs(dy) > Camera.DEADZONE) {
      this.position.y += dy * followAlpha;
    }

    const nextZoom = CAMERA_ZOOM_MAX - Math.min(1, Math.max(0, speedRatio)) * 0.28;
    const zoomAlpha = 1 - Math.pow(1 - 0.08, frameScale);
    this.zoom += (nextZoom - this.zoom) * zoomAlpha;
    this.zoom = Math.min(CAMERA_ZOOM_MAX, Math.max(CAMERA_ZOOM_MIN, this.zoom));

    // Removed square clamping logic. Camera now centers on player head.
    this.world.scale.set(this.zoom);
    this.world.position.set(
      this.renderer.width * 0.5 - this.position.x * this.zoom,
      this.renderer.height * 0.5 - this.position.y * this.zoom
    );
  }

  public worldToScreen(point: Vec2): Vec2 {
    return {
      x: this.renderer.width * 0.5 + (point.x - this.position.x) * this.zoom,
      y: this.renderer.height * 0.5 + (point.y - this.position.y) * this.zoom
    };
  }

  public screenToWorld(screen: Vec2): Vec2 {
    return {
      x: (screen.x - this.renderer.width  * 0.5) / this.zoom + this.position.x,
      y: (screen.y - this.renderer.height * 0.5) / this.zoom + this.position.y,
    };
  }
}
