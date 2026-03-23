import * as PIXI from "pixi.js";
import { ORB_PULSE_SPEED } from "snakee-shared/constants";
import type { OrbState } from "snakee-shared/types";

type OrbSprite = {
  particle: PIXI.Particle;
  baseScale: number;
};

export class OrbRenderer {
  private readonly container: PIXI.ParticleContainer;

  private readonly orbTexture: PIXI.Texture;

  private readonly sprites: Map<string, OrbSprite>;

  private pulseTime: number;

  public constructor(layer: PIXI.Container, renderer: PIXI.Renderer) {
    this.container = new PIXI.ParticleContainer({
      dynamicProperties: {
        position: true,
        vertex: true,
        color: true
      }
    });
    this.orbTexture = this.createOrbTexture(renderer);
    this.sprites = new Map<string, OrbSprite>();
    this.pulseTime = 0;
    layer.addChild(this.container);
  }

  public render(orbs: OrbState[], deltaMs: number): void {
    /* changed by gemini */
    this.pulseTime += deltaMs * 0.001 * ORB_PULSE_SPEED;
    const seen = new Set<string>();

    for (const orb of orbs) {
      seen.add(orb.id);
      let spriteEntry = this.sprites.get(orb.id);
      if (!spriteEntry) {
        const particle = new PIXI.Particle({
          texture: this.orbTexture,
          anchorX: 0.5,
          anchorY: 0.5,
          alpha: 1
        });
        this.container.addParticle(particle);
        // Base scale calculation for variety
        spriteEntry = { particle, baseScale: (orb.size / 10) * 1.2 };
        this.sprites.set(orb.id, spriteEntry);
      }

      // Smooth pulsing effect
      const pulse = 0.85 + Math.sin(this.pulseTime * 2.5 + orb.id.length) * 0.15;
      const scale = spriteEntry.baseScale * pulse;
      
      spriteEntry.particle.tint = orb.color;
      spriteEntry.particle.x = orb.x;
      spriteEntry.particle.y = orb.y;
      spriteEntry.particle.scaleX = scale;
      spriteEntry.particle.scaleY = scale;
      // Vibrant glowing alpha
      spriteEntry.particle.alpha = 0.85 + Math.sin(this.pulseTime * 1.5 + orb.id.length * 0.5) * 0.15;
    }

    for (const [id, orb] of this.sprites.entries()) {
      if (!seen.has(id)) {
        this.container.removeParticle(orb.particle);
        this.sprites.delete(id);
      }
    }
  }

  private createOrbTexture(renderer: PIXI.Renderer): PIXI.Texture {
    /* changed by gemini */
    const graphics = new PIXI.Graphics();
    
    // Very soft outer glow (halo)
    graphics.beginFill(0xffffff, 0.15);
    graphics.drawCircle(0, 0, 16);
    graphics.endFill();
    
    // Soft inner glow
    graphics.beginFill(0xffffff, 0.4);
    graphics.drawCircle(0, 0, 10);
    graphics.endFill();
    
    // Dense core
    graphics.beginFill(0xffffff, 0.9);
    graphics.drawCircle(0, 0, 5);
    graphics.endFill();

    // Brightest center point
    graphics.beginFill(0xffffff, 1);
    graphics.drawCircle(0, 0, 2);
    graphics.endFill();
    
    const texture = renderer.generateTexture(graphics);
    graphics.destroy();
    return texture;
  }

  private applyBrightness(color: number, amount: number): number {
    const r = Math.min(255, Math.max(0, Math.round(((color >> 16) & 0xff) * amount)));
    const g = Math.min(255, Math.max(0, Math.round(((color >> 8) & 0xff) * amount)));
    const b = Math.min(255, Math.max(0, Math.round((color & 0xff) * amount)));
    return (r << 16) | (g << 8) | b;
  }
}
