import * as PIXI from "pixi.js";
import { ORB_PULSE_SPEED } from "snakee-shared/constants";
import type { OrbState } from "snakee-shared/types";

type OrbSprite = {
  body:          PIXI.Particle;  // Layer 1 — normal blend, opaque luminous ball
  glow:          PIXI.Particle;  // Layer 2 — additive blend, wide colored bloom
  color:         number;
  tier:          number;         // 0=common 1=uncommon 2=death
  baseScale:     number;
  glowMultiplier: number;        // death orbs use tighter glow than others
  value:         number;
  floatSeed:     number;
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
        const tier         = orb.value >= 7 ? 2 : orb.value >= 3 ? 1 : 0;
        const cacheKey     = orb.color * 4 + tier;
        const bodyTexture  = this.getBodyTexture(cacheKey, orb.color, tier);
        const glowTexture  = this.getGlowTexture(cacheKey, orb.color, tier);
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
          color:          orb.color,
          tier,
          baseScale:      (orb.size / 10) * 0.12,
          // Death orbs: tighter glow (compact) — other tiers: wide bloom
          glowMultiplier: tier === 2 ? 2.4 : 3.5,
          value:          orb.value,
          floatSeed:      seed,
        };
        this.sprites.set(orb.id, entry);
      }

      // Pulse — death orbs throb more dramatically
      const pulseAmp   = entry.tier === 2 ? 0.14 : 0.07;
      const pulseSpeed = entry.tier === 2 ? 2.4  : 1.6;
      const bodyPulse  = 1 - pulseAmp + Math.sin(this.pulseTime * pulseSpeed + entry.floatSeed) * pulseAmp;

      // Glow pulse — slightly lagged phase so bloom breathes after the body
      const glowPulseAmp = entry.tier === 2 ? 0.10 : 0.05;
      const glowPulse    = 1 - glowPulseAmp + Math.sin(this.pulseTime * pulseSpeed + entry.floatSeed + 0.4) * glowPulseAmp;

      // Brownian drift
      const driftRadius = entry.value >= 7 ? 8 : entry.value >= 3 ? 5 : 3;
      const dx  = Math.sin(this.pulseTime * 0.9  + entry.floatSeed * 1.7) * driftRadius;
      const dy  = Math.cos(this.pulseTime * 0.75 + entry.floatSeed * 2.1) * driftRadius;
      const orbX = orb.x + dx;
      const orbY = orb.y + dy;

      // Alpha breathing — death orbs stay brighter (less alpha dip)
      const alphaBase = entry.tier === 2 ? 0.96 : 0.90;
      const alphaAmp  = entry.tier === 2 ? 0.04 : 0.08;
      const alpha = alphaBase + Math.sin(this.pulseTime * 1.4 + entry.floatSeed) * alphaAmp;

      // Apply body
      entry.body.x      = orbX;
      entry.body.y      = orbY;
      entry.body.scaleX = entry.baseScale * bodyPulse;
      entry.body.scaleY = entry.baseScale * bodyPulse;
      entry.body.alpha  = alpha;
      entry.body.tint   = 0xffffff;

      // Apply glow
      entry.glow.x      = orbX;
      entry.glow.y      = orbY;
      entry.glow.scaleX = entry.baseScale * entry.glowMultiplier * glowPulse;
      entry.glow.scaleY = entry.baseScale * entry.glowMultiplier * glowPulse;
      entry.glow.alpha  = alpha * (entry.tier === 2 ? 1.0 : 0.85);
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

  private getBodyTexture(key: number, color: number, tier: number): PIXI.Texture {
    let t = this.bodyTextureCache.get(key);
    if (!t) {
      t = this.createBodyTexture(color, tier);
      this.bodyTextureCache.set(key, t);
    }
    return t;
  }

  private getGlowTexture(key: number, color: number, tier: number): PIXI.Texture {
    let t = this.glowTextureCache.get(key);
    if (!t) {
      t = this.createGlowTexture(color, tier);
      this.glowTextureCache.set(key, t);
    }
    return t;
  }

  // Layer 1 — 3D sphere illusion.
  // Base: color shading (lighter center → full color → dark rim).
  // Specular: offset white highlight at top-left, shows surface curvature.
  // Death orbs (tier 2): near-white center, stronger specular — looks molten.
  private createBodyTexture(color: number, tier: number): PIXI.Texture {
    const R = (color >> 16) & 0xff;
    const G = (color >>  8) & 0xff;
    const B =  color        & 0xff;

    // Center brightness: death=85% toward white, common=40%
    const centerBlend = tier === 2 ? 0.85 : 0.40;
    const lR = Math.round(R + (255 - R) * centerBlend);
    const lG = Math.round(G + (255 - G) * centerBlend);
    const lB = Math.round(B + (255 - B) * centerBlend);

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

    // Pass 2: Specular highlight — death orbs get a stronger, wider flare
    const hx       = cx - r * 0.28;
    const hy       = cy - r * 0.28;
    const specR    = tier === 2 ? r * 0.58 : r * 0.48;
    const specPeak = tier === 2 ? 0.98      : 0.92;
    const spec = ctx.createRadialGradient(hx, hy, 0, hx, hy, specR);
    spec.addColorStop(0.00, `rgba(255,255,255,${specPeak})`);
    spec.addColorStop(0.25, `rgba(255,255,255,${tier === 2 ? 0.80 : 0.65})`);
    spec.addColorStop(0.60, `rgba(255,255,255,${tier === 2 ? 0.28 : 0.18})`);
    spec.addColorStop(1.00, `rgba(255,255,255,0.00)`);
    ctx.fillStyle = spec;
    ctx.fillRect(0, 0, size, size);

    return PIXI.Texture.from(canvas);
  }

  // Layer 2 — additive bloom.
  // Death orbs (tier 2): higher intensity with tighter falloff (compact + bright).
  // Other tiers: wide soft bloom.
  private createGlowTexture(color: number, tier: number): PIXI.Texture {
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

    if (tier === 2) {
      // Death orbs: intense bright core, steep falloff (compact)
      grad.addColorStop(0.00, `rgba(${R},${G},${B},0.90)`);
      grad.addColorStop(0.20, `rgba(${R},${G},${B},0.75)`);
      grad.addColorStop(0.45, `rgba(${R},${G},${B},0.40)`);
      grad.addColorStop(0.72, `rgba(${R},${G},${B},0.12)`);
      grad.addColorStop(1.00, `rgba(${R},${G},${B},0.00)`);
    } else {
      // Common / uncommon: soft wide bloom
      grad.addColorStop(0.00, `rgba(${R},${G},${B},0.50)`);
      grad.addColorStop(0.30, `rgba(${R},${G},${B},0.40)`);
      grad.addColorStop(0.60, `rgba(${R},${G},${B},0.20)`);
      grad.addColorStop(0.85, `rgba(${R},${G},${B},0.06)`);
      grad.addColorStop(1.00, `rgba(${R},${G},${B},0.00)`);
    }

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    return PIXI.Texture.from(canvas);
  }
}
