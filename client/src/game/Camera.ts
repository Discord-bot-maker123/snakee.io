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

  public constructor(world: PIXI.Container, renderer: PIXI.Renderer) {
    this.world = world;
    this.renderer = renderer;
    this.position = { x: 0, y: 0 };
    this.zoom = 1;
  }

  public update(target: Vec2, speedRatio: number): void {
    this.position.x += (target.x - this.position.x) * CAMERA_LERP;
    this.position.y += (target.y - this.position.y) * CAMERA_LERP;

    const nextZoom = CAMERA_ZOOM_MAX - Math.min(1, Math.max(0, speedRatio)) * 0.28;
    this.zoom += (nextZoom - this.zoom) * 0.08;
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
}
