import * as PIXI from "pixi.js";
import { ORB_PULSE_SPEED } from "snakee-shared/constants";
import type { OrbState } from "snakee-shared/types";

type OrbSprite = {
  particle: PIXI.Particle;
  baseScale: number;
  value: number;
  floatSeed: number; // unique per-orb phase offset for drift
};

export class OrbRenderer {
  private readonly container: PIXI.ParticleContainer;

  private readonly orbTexture: PIXI.Texture;

  private readonly sprites: Map<string, OrbSprite>;

  private pulseTime: number;

  public constructor(layer: PIXI.Container) {
    this.container = new PIXI.ParticleContainer({
      dynamicProperties: {
        position: true,
        vertex: true,
        color: true
      }
    });
    this.orbTexture = this.createOrbTexture();
    this.sprites = new Map<string, OrbSprite>();
    this.pulseTime = 0;
    layer.addChild(this.container);
  }

  public render(orbs: OrbState[], deltaMs: number): void {
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
        // floatSeed: deterministic per-orb so each orb drifts independently
        const seed = orb.id.charCodeAt(0) * 0.37 + orb.id.length * 1.13;
        // Texture is 128px; scale so the visible core reads the same apparent size
        spriteEntry = { particle, baseScale: (orb.size / 10) * 0.72, value: orb.value, floatSeed: seed };
        this.sprites.set(orb.id, spriteEntry);
      }

      // Pulse: rare/death orbs throb more dramatically
      const pulseAmp   = orb.value >= 7 ? 0.20 : orb.value >= 3 ? 0.12 : 0.07;
      const pulseSpeed = orb.value >= 7 ? 2.8  : orb.value >= 3 ? 2.2  : 1.8;
      const pulse = 1 - pulseAmp + Math.sin(this.pulseTime * pulseSpeed + spriteEntry.floatSeed) * pulseAmp;
      spriteEntry.particle.scaleX = spriteEntry.baseScale * pulse;
      spriteEntry.particle.scaleY = spriteEntry.baseScale * pulse;

      // Gentle drift: orbs float softly in place (death orbs move a bit more)
      const driftRadius = orb.value >= 7 ? 9 : orb.value >= 3 ? 5.5 : 3.5;
      const dx = Math.sin(this.pulseTime * 0.9  + spriteEntry.floatSeed * 1.7) * driftRadius;
      const dy = Math.cos(this.pulseTime * 0.75 + spriteEntry.floatSeed * 2.1) * driftRadius;
      spriteEntry.particle.x = orb.x + dx;
      spriteEntry.particle.y = orb.y + dy;

      spriteEntry.particle.tint = orb.color;

      // Alpha breathe
      const alphaBase = orb.value >= 7 ? 0.95 : 0.88;
      const alphaAmp  = orb.value >= 7 ? 0.05 : 0.10;
      spriteEntry.particle.alpha = alphaBase + Math.sin(this.pulseTime * 1.4 + spriteEntry.floatSeed) * alphaAmp;
    }

    for (const [id, orb] of this.sprites.entries()) {
      if (!seen.has(id)) {
        this.container.removeParticle(orb.particle);
        this.sprites.delete(id);
      }
    }
  }

  // Canvas radial gradient — the only way to get a truly smooth glow falloff.
  // Stacked PIXI circles produce visible rings at each alpha step; a canvas
  // gradient is continuous. Texture is 128px so the outer bloom halo has room
  // to diffuse without being clipped.
  private createOrbTexture(): PIXI.Texture {
    const size = 128;
    const center = size / 2;

    const canvas = document.createElement("canvas");
    canvas.width  = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;

    const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
    gradient.addColorStop(0.00, "rgba(255,255,255,1.00)");  // bright solid core
    gradient.addColorStop(0.08, "rgba(255,255,255,0.97)");  // dense inner glow
    gradient.addColorStop(0.20, "rgba(255,255,255,0.75)");  // strong inner halo
    gradient.addColorStop(0.38, "rgba(255,255,255,0.42)");  // mid glow
    gradient.addColorStop(0.58, "rgba(255,255,255,0.16)");  // diffuse outer bloom
    gradient.addColorStop(0.80, "rgba(255,255,255,0.05)");  // faint edge halo
    gradient.addColorStop(1.00, "rgba(255,255,255,0.00)");  // transparent edge

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    return PIXI.Texture.from(canvas);
  }

}
