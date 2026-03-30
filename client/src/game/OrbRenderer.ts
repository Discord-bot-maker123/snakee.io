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

      // sinVal in [-1, 1] drives all animation — one shared clock per orb.
      const pulseSpeed = entry.tier === 2 ? 2.4 : 1.8;
      const sinVal     = Math.sin(this.pulseTime * pulseSpeed + entry.floatSeed);

      // Body: very subtle size breathe only — the glow handles brightness.
      const scaleBreath = entry.tier === 2 ? 0.05 : 0.04;
      const bodyPulse   = 1.0 + sinVal * scaleBreath;

      // Glow alpha: gentle pulse — colours brighten ~90% then return to depth.
      // Not a dramatic wash; just enough to feel alive.
      //   common  → 0.10 … 0.42
      //   death   → 0.18 … 0.65
      const glowMin   = entry.tier === 2 ? 0.18 : 0.10;
      const glowMax   = entry.tier === 2 ? 0.65 : 0.42;
      const glowAlpha = glowMin + (sinVal + 1) * 0.5 * (glowMax - glowMin);

      // Brownian drift
      const driftRadius = entry.value >= 7 ? 8 : entry.value >= 3 ? 5 : 3;
      const dx  = Math.sin(this.pulseTime * 0.9  + entry.floatSeed * 1.7) * driftRadius;
      const dy  = Math.cos(this.pulseTime * 0.75 + entry.floatSeed * 2.1) * driftRadius;
      const orbX = orb.x + dx;
      const orbY = orb.y + dy;

      // Apply body — always fully opaque; depth comes from the texture shading.
      entry.body.x      = orbX;
      entry.body.y      = orbY;
      entry.body.scaleX = entry.baseScale * bodyPulse;
      entry.body.scaleY = entry.baseScale * bodyPulse;
      entry.body.alpha  = 1.0;
      entry.body.tint   = 0xffffff;

      // Apply glow — the wide pulse is what creates the "wash to white" effect.
      entry.glow.x      = orbX;
      entry.glow.y      = orbY;
      entry.glow.scaleX = entry.baseScale * entry.glowMultiplier * bodyPulse;
      entry.glow.scaleY = entry.baseScale * entry.glowMultiplier * bodyPulse;
      entry.glow.alpha  = glowAlpha;
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

  // Layer 1 — sphere with circumference shadow.
  //
  // Radial gradient from center outward:
  //   center      → slightly lighter color (ambient center brightness)
  //   mid         → full orb color
  //   outer ring  → darkens all the way around the circumference
  //   edge        → near-black shadow on the entire rim
  //
  // Small top-left specular dot adds gloss without making it directionally lit.
  // Layer 1 — front-facing sphere viewed from above.
  //
  // Pass 1: Radial fill — full color in center, dark rim all around.
  //   The circumference is dark (shadow) so the orb reads as round, not flat.
  //
  // Pass 2: Top highlight — offset radial at upper-center fading to transparent.
  //   Adds the bright white "north pole" cap without making the rest of the
  //   sphere look side-viewed. Most of the face stays full color.
  private createBodyTexture(color: number, tier: number): PIXI.Texture {
    const R = (color >> 16) & 0xff;
    const G = (color >>  8) & 0xff;
    const B =  color        & 0xff;

    // Slightly lighter center color (ambient lift)
    const lR = Math.min(255, Math.round(R + (255 - R) * 0.15));
    const lG = Math.min(255, Math.round(G + (255 - G) * 0.15));
    const lB = Math.min(255, Math.round(B + (255 - B) * 0.15));

    // Dark version for rim shadow
    const dR = Math.round(R * 0.16);
    const dG = Math.round(G * 0.16);
    const dB = Math.round(B * 0.16);

    const size = 128;
    const cx   = size / 2;
    const cy   = size / 2;
    const r    = size / 2 - 1;

    const canvas = document.createElement("canvas");
    canvas.width  = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    // Pass 1 — base radial: full color center, dark at circumference edge
    const base = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    base.addColorStop(0.00, `rgba(${lR},${lG},${lB},1.00)`); // center: slight lift
    base.addColorStop(0.55, `rgba(${R},${G},${B},1.00)`);    // full color
    base.addColorStop(0.78, `rgba(${R},${G},${B},1.00)`);    // holds wide
    base.addColorStop(0.90, `rgba(${dR},${dG},${dB},1.00)`); // shadow ring starts
    base.addColorStop(0.97, `rgba(2,2,4,1.00)`);             // near-black
    base.addColorStop(1.00, `rgba(0,0,0,1.00)`);             // black edge
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);

    // Pass 2 — top highlight: offset radial near the upper-center of the disc
    // cx, cy - r*0.35 places the highlight center above the geometric center
    // so the bright cap sits at the top without spanning the whole face.
    const hx = cx;
    const hy = cy - r * 0.35;
    const hr = r * (tier === 2 ? 0.70 : 0.58); // death orbs get a bigger highlight
    const highlight = ctx.createRadialGradient(hx, hy, 0, hx, hy, hr);
    highlight.addColorStop(0.00, `rgba(255,255,255,0.92)`); // bright white peak
    highlight.addColorStop(0.30, `rgba(255,255,255,0.55)`);
    highlight.addColorStop(0.65, `rgba(255,255,255,0.12)`);
    highlight.addColorStop(1.00, `rgba(255,255,255,0.00)`); // fades to nothing
    ctx.fillStyle = highlight;
    ctx.fillRect(0, 0, size, size);

    ctx.restore();

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
