import * as PIXI from "pixi.js";
import { ORB_PULSE_SPEED } from "snakee-shared/constants";
import type { OrbState } from "snakee-shared/types";

type OrbSprite = {
  particle: PIXI.Particle;
  color: number;
  baseScale: number;
  value: number;
  floatSeed: number;
};

export class OrbRenderer {
  private readonly layer: PIXI.Container;

  // One texture and one ParticleContainer per unique orb color.
  // Colors are fixed at spawn so caches never grow beyond the number of
  // distinct colors the server uses (~10–20).
  private readonly textureCache: Map<number, PIXI.Texture>;
  private readonly containerCache: Map<number, PIXI.ParticleContainer>;

  private readonly sprites: Map<string, OrbSprite>;

  private pulseTime: number;

  public constructor(layer: PIXI.Container) {
    this.layer = layer;
    this.textureCache = new Map();
    this.containerCache = new Map();
    this.sprites = new Map();
    this.pulseTime = 0;
  }

  public render(orbs: OrbState[], deltaMs: number): void {
    this.pulseTime += deltaMs * 0.001 * ORB_PULSE_SPEED;
    const seen = new Set<string>();

    for (const orb of orbs) {
      seen.add(orb.id);
      let entry = this.sprites.get(orb.id);

      if (!entry) {
        const texture   = this.getTexture(orb.color);
        const container = this.getContainer(orb.color);
        const particle  = new PIXI.Particle({
          texture,
          anchorX: 0.5,
          anchorY: 0.5,
          alpha: 1
        });
        container.addParticle(particle);

        // Deterministic phase so each orb drifts independently.
        const seed = orb.id.charCodeAt(0) * 0.37 + orb.id.length * 1.13;

        // 256 px texture; body fills ~20 % of radius, glow the rest.
        // Scale chosen so the solid ball matches the orb tier radius:
        //   size 4  → ~4 px body radius
        //   size 10 → ~11 px body radius  (≈ SNAKE_BODY_RADIUS)
        //   size 18 → ~19 px body radius  (≈ SNAKE_HEAD_RADIUS)
        entry = {
          particle,
          color: orb.color,
          baseScale: (orb.size / 10) * 0.42,
          value: orb.value,
          floatSeed: seed
        };
        this.sprites.set(orb.id, entry);
      }

      // Pulse — rare/death orbs throb more dramatically.
      const pulseAmp   = orb.value >= 7 ? 0.18 : orb.value >= 3 ? 0.10 : 0.06;
      const pulseSpeed = orb.value >= 7 ? 2.8  : orb.value >= 3 ? 2.2  : 1.8;
      const pulse = 1 - pulseAmp + Math.sin(this.pulseTime * pulseSpeed + entry.floatSeed) * pulseAmp;

      entry.particle.scaleX = entry.baseScale * pulse;
      entry.particle.scaleY = entry.baseScale * pulse;

      // Gentle drift.
      const driftRadius = orb.value >= 7 ? 9 : orb.value >= 3 ? 5.5 : 3.5;
      const dx = Math.sin(this.pulseTime * 0.9  + entry.floatSeed * 1.7) * driftRadius;
      const dy = Math.cos(this.pulseTime * 0.75 + entry.floatSeed * 2.1) * driftRadius;
      entry.particle.x = orb.x + dx;
      entry.particle.y = orb.y + dy;

      // Color is baked into the texture — no PIXI tint needed.
      entry.particle.tint = 0xffffff;

      // Alpha breathe.
      const alphaBase = orb.value >= 7 ? 0.95 : 0.88;
      const alphaAmp  = orb.value >= 7 ? 0.05 : 0.10;
      entry.particle.alpha = alphaBase + Math.sin(this.pulseTime * 1.4 + entry.floatSeed) * alphaAmp;
    }

    for (const [id, entry] of this.sprites.entries()) {
      if (!seen.has(id)) {
        this.containerCache.get(entry.color)?.removeParticle(entry.particle);
        this.sprites.delete(id);
      }
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private getContainer(color: number): PIXI.ParticleContainer {
    let c = this.containerCache.get(color);
    if (!c) {
      c = new PIXI.ParticleContainer({
        dynamicProperties: { position: true, vertex: true, color: true }
      });
      // Additive blending: orb light is *added* to the scene, brightening
      // the hex tiles beneath and letting overlapping glows stack naturally.
      c.blendMode = "add";
      this.layer.addChild(c);
      this.containerCache.set(color, c);
    }
    return c;
  }

  private getTexture(color: number): PIXI.Texture {
    let t = this.textureCache.get(color);
    if (!t) {
      t = this.createOrbTexture(color);
      this.textureCache.set(color, t);
    }
    return t;
  }

  // Each color gets its own 256 px canvas texture so the gradient is drawn
  // in the actual orb color — no PIXI tint multiplication involved.
  //
  // Structure (fraction of radius):
  //   0 – 0.08   bright washed centre (white mixed in → "hot" core)
  //   0.08–0.20  transitions from bright to pure orb color
  //   0.20–0.32  solid orb body at full color
  //   0.32–0.50  sharp falloff to semi-transparent
  //   0.50–0.80  wide soft glow bloom
  //   0.80–1.00  very faint outer diffuse halo
  private createOrbTexture(color: number): PIXI.Texture {
    const R = (color >> 16) & 0xff;
    const G = (color >> 8)  & 0xff;
    const B =  color        & 0xff;

    // Inner core: bright center (closer to white)
    const cR = Math.min(255, R + 180);
    const cG = Math.min(255, G + 180);
    const cB = Math.min(255, B + 180);

    // Darker version for the outer glow falloff
    const dR = Math.floor(R * 0.6);
    const dG = Math.floor(G * 0.6);
    const dB = Math.floor(B * 0.6);

    const size   = 256;
    const center = size / 2;

    const canvas = document.createElement("canvas");
    canvas.width  = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;

    // ── Cleaner Orb Gradient ──────────────────────────────────────────────
    // Structure based on "Deep Analysis":
    // 1. Inner core (bright center, small)
    // 2. Mid gradient layer (main color, smooth)
    // 3. Outer glow (soft, wide, low opacity, darker hue)
    
    const grad = ctx.createRadialGradient(center, center, 0, center, center, center);
    
    // Core (0.0 - 0.1)
    grad.addColorStop(0.00, `rgba(${cR},${cG},${cB},1.0)`);
    grad.addColorStop(0.08, `rgba(${cR},${cG},${cB},1.0)`);
    
    // Mid Layer (0.1 - 0.3)
    grad.addColorStop(0.15, `rgba(${R},${G},${B},1.0)`);
    grad.addColorStop(0.28, `rgba(${R},${G},${B},0.9)`);
    
    // Outer Glow (0.3 - 0.7) - Glow radius ≈ 2x–3x core radius
    // We use a darker hue for the glow as per analysis
    grad.addColorStop(0.40, `rgba(${dR},${dG},${dB},0.4)`);
    grad.addColorStop(0.55, `rgba(${dR},${dG},${dB},0.15)`);
    grad.addColorStop(0.75, `rgba(${dR},${dG},${dB},0.0)`);
    grad.addColorStop(1.00, `rgba(${dR},${dG},${dB},0.0)`);

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    return PIXI.Texture.from(canvas);
  }
}
