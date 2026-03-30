import * as PIXI from "pixi.js";
import { ORB_PULSE_SPEED } from "snakee-shared/constants";
import type { OrbState } from "snakee-shared/types";

type OrbSprite = {
  body:      PIXI.Particle;  // Layer 1 — normal blend, opaque luminous ball
  glow:      PIXI.Particle;  // Layer 2 — additive blend, wide colored bloom
  color:     number;
  baseScale: number;
  value:     number;
  floatSeed: number;
};

export class OrbRenderer {
  private readonly layer: PIXI.Container;

  private readonly bodyTextureCache: Map<number, PIXI.Texture>;
  private readonly glowTextureCache: Map<number, PIXI.Texture>;
  private readonly bodyContainerCache: Map<number, PIXI.ParticleContainer>;
  private readonly glowContainerCache: Map<number, PIXI.ParticleContainer>;

  private readonly sprites: Map<string, OrbSprite>;
  private pulseTime: number;

  public constructor(layer: PIXI.Container) {
    this.layer = layer;
    this.layer.sortableChildren = true;
    this.bodyTextureCache = new Map();
    this.glowTextureCache = new Map();
    this.bodyContainerCache = new Map();
    this.glowContainerCache = new Map();
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
        const bodyTexture  = this.getBodyTexture(orb.color);
        const glowTexture  = this.getGlowTexture(orb.color);
        const bodyContainer = this.getBodyContainer(orb.color);
        const glowContainer = this.getGlowContainer(orb.color);

        const body = new PIXI.Particle({ texture: bodyTexture, anchorX: 0.5, anchorY: 0.5, alpha: 1 });
        const glow = new PIXI.Particle({ texture: glowTexture, anchorX: 0.5, anchorY: 0.5, alpha: 1 });

        bodyContainer.addParticle(body);
        glowContainer.addParticle(glow);

        const seed = orb.id.charCodeAt(0) * 0.37 + orb.id.length * 1.13;

        entry = {
          body,
          glow,
          color:     orb.color,
          baseScale: (orb.size / 10) * 0.08,
          value:     orb.value,
          floatSeed: seed,
        };
        this.sprites.set(orb.id, entry);
      }

      // Body pulse
      const pulseAmp  = 0.07;
      const bodyPulse = 1 - pulseAmp + Math.sin(this.pulseTime * 1.6 + entry.floatSeed) * pulseAmp;

      // Glow pulse — slightly lagged phase so bloom breathes after the body
      const glowPulseAmp = 0.05;
      const glowPulse    = 1 - glowPulseAmp + Math.sin(this.pulseTime * 1.6 + entry.floatSeed + 0.4) * glowPulseAmp;

      // Brownian drift
      const driftRadius = entry.value >= 7 ? 8 : entry.value >= 3 ? 5 : 3;
      const dx  = Math.sin(this.pulseTime * 0.9  + entry.floatSeed * 1.7) * driftRadius;
      const dy  = Math.cos(this.pulseTime * 0.75 + entry.floatSeed * 2.1) * driftRadius;
      const orbX = orb.x + dx;
      const orbY = orb.y + dy;

      // Alpha breathing
      const alpha = 0.90 + Math.sin(this.pulseTime * 1.4 + entry.floatSeed) * 0.08;

      // Apply body
      entry.body.x      = orbX;
      entry.body.y      = orbY;
      entry.body.scaleX = entry.baseScale * bodyPulse;
      entry.body.scaleY = entry.baseScale * bodyPulse;
      entry.body.alpha  = alpha;
      entry.body.tint   = 0xffffff;

      // Apply glow (wider, slightly more transparent)
      entry.glow.x      = orbX;
      entry.glow.y      = orbY;
      entry.glow.scaleX = entry.baseScale * 3.5 * glowPulse;
      entry.glow.scaleY = entry.baseScale * 3.5 * glowPulse;
      entry.glow.alpha  = alpha * 0.85;
      entry.glow.tint   = 0xffffff;
    }

    for (const [id, entry] of this.sprites.entries()) {
      if (!seen.has(id)) {
        this.bodyContainerCache.get(entry.color)?.removeParticle(entry.body);
        this.glowContainerCache.get(entry.color)?.removeParticle(entry.glow);
        this.sprites.delete(id);
      }
    }

  }

  // --- Container factories ---

  private getBodyContainer(color: number): PIXI.ParticleContainer {
    let c = this.bodyContainerCache.get(color);
    if (!c) {
      c = new PIXI.ParticleContainer({
        dynamicProperties: { position: true, vertex: true, color: true },
      });
      // blendMode left at default ("normal") — renders opaque sphere
      c.zIndex = 0;
      this.layer.addChild(c);
      this.bodyContainerCache.set(color, c);
    }
    return c;
  }

  private getGlowContainer(color: number): PIXI.ParticleContainer {
    let c = this.glowContainerCache.get(color);
    if (!c) {
      c = new PIXI.ParticleContainer({
        dynamicProperties: { position: true, vertex: true, color: true },
      });
      c.blendMode = "add";
      c.zIndex = 1;
      this.layer.addChild(c);
      this.glowContainerCache.set(color, c);
    }
    return c;
  }

  // --- Texture factories ---

  private getBodyTexture(color: number): PIXI.Texture {
    let t = this.bodyTextureCache.get(color);
    if (!t) {
      t = this.createBodyTexture(color);
      this.bodyTextureCache.set(color, t);
    }
    return t;
  }

  private getGlowTexture(color: number): PIXI.Texture {
    let t = this.glowTextureCache.get(color);
    if (!t) {
      t = this.createGlowTexture(color);
      this.glowTextureCache.set(color, t);
    }
    return t;
  }

  // Layer 1 — 3D sphere illusion.
  // Base: color shading (lighter center → full color → dark rim).
  // Specular: offset white highlight at top-left, shows surface curvature.
  private createBodyTexture(color: number): PIXI.Texture {
    const R = (color >> 16) & 0xff;
    const G = (color >>  8) & 0xff;
    const B =  color        & 0xff;

    // Lighter tint for ambient center (40% toward white)
    const lR = Math.round(R + (255 - R) * 0.40);
    const lG = Math.round(G + (255 - G) * 0.40);
    const lB = Math.round(B + (255 - B) * 0.40);

    // Darker shade for rim (30% of original — gives depth)
    const dR = Math.round(R * 0.30);
    const dG = Math.round(G * 0.30);
    const dB = Math.round(B * 0.30);

    const size = 128;
    const cx   = size / 2;
    const cy   = size / 2;
    const r    = size / 2;

    const canvas = document.createElement("canvas");
    canvas.width  = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;

    // Pass 1: Sphere base — lighter center, full color mid, dark rim
    const base = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    base.addColorStop(0.00, `rgba(${lR},${lG},${lB},1.00)`);   // lit center
    base.addColorStop(0.45, `rgba(${R},${G},${B},1.00)`);       // full saturated color
    base.addColorStop(0.82, `rgba(${dR},${dG},${dB},1.00)`);    // dark rim
    base.addColorStop(1.00, `rgba(${dR},${dG},${dB},0.00)`);    // transparent edge
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);

    // Pass 2: Specular highlight — offset top-left, shows surface curvature
    const hx = cx - r * 0.28;   // ~28% left of center
    const hy = cy - r * 0.28;   // ~28% above center
    const spec = ctx.createRadialGradient(hx, hy, 0, hx, hy, r * 0.48);
    spec.addColorStop(0.00, `rgba(255,255,255,0.92)`);
    spec.addColorStop(0.25, `rgba(255,255,255,0.65)`);
    spec.addColorStop(0.60, `rgba(255,255,255,0.18)`);
    spec.addColorStop(1.00, `rgba(255,255,255,0.00)`);
    ctx.fillStyle = spec;
    ctx.fillRect(0, 0, size, size);

    return PIXI.Texture.from(canvas);
  }

  // Layer 2 — wide additive bloom.
  // Sits on top of the body and illuminates the hex tiles beneath.
  // White center adds brightness; colored fringe creates the wide colored halo.
  private createGlowTexture(color: number): PIXI.Texture {
    const R = (color >> 16) & 0xff;
    const G = (color >>  8) & 0xff;
    const B =  color        & 0xff;

    const size = 128;
    const cx   = size / 2;
    const cy   = size / 2;
    const r    = size / 2;

    const canvas = document.createElement("canvas");
    canvas.width  = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;

    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0.00, `rgba(${R},${G},${B},0.50)`);   // colored core (no white — body handles that)
    grad.addColorStop(0.30, `rgba(${R},${G},${B},0.40)`);   // strong bloom
    grad.addColorStop(0.60, `rgba(${R},${G},${B},0.20)`);   // wide halo
    grad.addColorStop(0.85, `rgba(${R},${G},${B},0.06)`);   // faint fringe lights background
    grad.addColorStop(1.00, `rgba(${R},${G},${B},0.00)`);   // transparent
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    return PIXI.Texture.from(canvas);
  }
}
