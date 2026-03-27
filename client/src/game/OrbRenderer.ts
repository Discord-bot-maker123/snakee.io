import * as PIXI from "pixi.js";
import { ORB_PULSE_SPEED } from "snakee-shared/constants";
import type { OrbState } from "snakee-shared/types";

type OrbSprite = {
  glowParticle: PIXI.Particle;
  coreParticle: PIXI.Particle;
  glowScale: number;
  coreScale: number;
  value: number;
  floatSeed: number;
};

export class OrbRenderer {
  private readonly glowContainer: PIXI.ParticleContainer;
  private readonly coreContainer: PIXI.ParticleContainer;

  private readonly glowTexture: PIXI.Texture;
  private readonly coreTexture: PIXI.Texture;

  private readonly sprites: Map<string, OrbSprite>;

  private pulseTime: number;

  public constructor(layer: PIXI.Container) {
    this.glowTexture = this.createGlowTexture();
    this.coreTexture = this.createCoreTexture();
    this.sprites = new Map<string, OrbSprite>();
    this.pulseTime = 0;

    // Glow layer drawn first (below), core layer drawn on top.
    this.glowContainer = new PIXI.ParticleContainer({
      dynamicProperties: { position: true, vertex: true, color: true }
    });
    this.coreContainer = new PIXI.ParticleContainer({
      dynamicProperties: { position: true, vertex: true, color: true }
    });

    layer.addChild(this.glowContainer);
    layer.addChild(this.coreContainer);
  }

  public render(orbs: OrbState[], deltaMs: number): void {
    this.pulseTime += deltaMs * 0.001 * ORB_PULSE_SPEED;
    const seen = new Set<string>();

    for (const orb of orbs) {
      seen.add(orb.id);
      let entry = this.sprites.get(orb.id);

      if (!entry) {
        const glowParticle = new PIXI.Particle({
          texture: this.glowTexture,
          anchorX: 0.5,
          anchorY: 0.5,
          alpha: 1
        });
        const coreParticle = new PIXI.Particle({
          texture: this.coreTexture,
          anchorX: 0.5,
          anchorY: 0.5,
          alpha: 1
        });
        this.glowContainer.addParticle(glowParticle);
        this.coreContainer.addParticle(coreParticle);

        // Deterministic phase offset so each orb drifts independently.
        const seed = orb.id.charCodeAt(0) * 0.37 + orb.id.length * 1.13;
        const sizeRatio = orb.size / 10;

        entry = {
          glowParticle,
          coreParticle,
          glowScale: sizeRatio * 0.52,  // 192 px texture → ~100 px rendered diameter
          coreScale: sizeRatio * 0.22,  //  64 px texture → ~14 px rendered diameter
          value: orb.value,
          floatSeed: seed
        };
        this.sprites.set(orb.id, entry);
      }

      // Pulse: rare/death orbs throb more dramatically.
      const pulseAmp   = orb.value >= 7 ? 0.18 : orb.value >= 3 ? 0.10 : 0.06;
      const pulseSpeed = orb.value >= 7 ? 2.8  : orb.value >= 3 ? 2.2  : 1.8;
      const pulse = 1 - pulseAmp + Math.sin(this.pulseTime * pulseSpeed + entry.floatSeed) * pulseAmp;

      entry.glowParticle.scaleX = entry.glowScale * pulse;
      entry.glowParticle.scaleY = entry.glowScale * pulse;
      entry.coreParticle.scaleX = entry.coreScale * pulse;
      entry.coreParticle.scaleY = entry.coreScale * pulse;

      // Gentle drift: both layers move together.
      const driftRadius = orb.value >= 7 ? 9 : orb.value >= 3 ? 5.5 : 3.5;
      const dx = Math.sin(this.pulseTime * 0.9  + entry.floatSeed * 1.7) * driftRadius;
      const dy = Math.cos(this.pulseTime * 0.75 + entry.floatSeed * 2.1) * driftRadius;
      entry.glowParticle.x = orb.x + dx;
      entry.glowParticle.y = orb.y + dy;
      entry.coreParticle.x = orb.x + dx;
      entry.coreParticle.y = orb.y + dy;

      // Glow takes the orb color; core is always pure white (no tint).
      entry.glowParticle.tint = orb.color;
      entry.coreParticle.tint = 0xffffff;

      // Alpha breathe — core stays slightly brighter than the glow.
      const alphaBase = orb.value >= 7 ? 0.95 : 0.88;
      const alphaAmp  = orb.value >= 7 ? 0.05 : 0.10;
      const alpha = alphaBase + Math.sin(this.pulseTime * 1.4 + entry.floatSeed) * alphaAmp;
      entry.glowParticle.alpha = alpha;
      entry.coreParticle.alpha = Math.min(1, alpha + 0.08);
    }

    for (const [id, entry] of this.sprites.entries()) {
      if (!seen.has(id)) {
        this.glowContainer.removeParticle(entry.glowParticle);
        this.coreContainer.removeParticle(entry.coreParticle);
        this.sprites.delete(id);
      }
    }
  }

  // Wide colored glow — tinted with orb.color at render time.
  // Gradient peaks at mid-radius so the colored ring sits AROUND the white core,
  // not at the center (which the white core covers anyway).
  private createGlowTexture(): PIXI.Texture {
    const size = 192;
    const center = size / 2;
    const canvas = document.createElement("canvas");
    canvas.width  = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;

    const g = ctx.createRadialGradient(center, center, 0, center, center, center);
    g.addColorStop(0.00, "rgba(255,255,255,0.40)");  // inner presence under core
    g.addColorStop(0.15, "rgba(255,255,255,0.85)");  // rising to peak
    g.addColorStop(0.30, "rgba(255,255,255,1.00)");  // peak color ring
    g.addColorStop(0.50, "rgba(255,255,255,0.60)");  // strong bloom
    g.addColorStop(0.70, "rgba(255,255,255,0.22)");  // diffuse outer bloom
    g.addColorStop(0.88, "rgba(255,255,255,0.05)");  // faint halo
    g.addColorStop(1.00, "rgba(255,255,255,0.00)");  // transparent edge

    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);

    return PIXI.Texture.from(canvas);
  }

  // Tight white core — never tinted, always white.
  // Sits on top of the colored glow to give the "hot white center" look.
  private createCoreTexture(): PIXI.Texture {
    const size = 64;
    const center = size / 2;
    const canvas = document.createElement("canvas");
    canvas.width  = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;

    const g = ctx.createRadialGradient(center, center, 0, center, center, center);
    g.addColorStop(0.00, "rgba(255,255,255,1.00)");  // pure white center
    g.addColorStop(0.28, "rgba(255,255,255,0.95)");  // bright inner core
    g.addColorStop(0.58, "rgba(255,255,255,0.40)");  // soft falloff
    g.addColorStop(0.82, "rgba(255,255,255,0.08)");  // faint edge glow
    g.addColorStop(1.00, "rgba(255,255,255,0.00)");  // transparent

    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);

    return PIXI.Texture.from(canvas);
  }
}
