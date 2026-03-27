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

        // 256 px texture; body fills ~30 % of radius.
        // Scale chosen so the solid ball matches the orb tier radius:
        //   size 4  → ~5 px body radius
        //   size 10 → ~13 px body radius  (≈ SNAKE_BODY_RADIUS)
        //   size 18 → ~24 px body radius  (large death orb)
        entry = {
          particle,
          color: orb.color,
          baseScale: (orb.size / 10) * 0.35,
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
  //   0 – 0.30  solid colored ball (slightly lighter at centre → 3-D sphere)
  //   0.30–0.45  sharp edge falloff
  //   0.45–0.72  soft glow bloom
  //   0.72–1.00  faint outer halo
  private createOrbTexture(color: number): PIXI.Texture {
    const R = (color >> 16) & 0xff;
    const G = (color >> 8)  & 0xff;
    const B =  color        & 0xff;

    const size   = 256;
    const center = size / 2;

    const canvas = document.createElement("canvas");
    canvas.width  = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;

    // ── Main body + glow ──────────────────────────────────────────────────
    const body = ctx.createRadialGradient(center, center, 0, center, center, center);
    body.addColorStop(0.00, `rgba(${R},${G},${B},1.00)`);  // solid center
    body.addColorStop(0.18, `rgba(${R},${G},${B},0.98)`);  // solid ball body
    body.addColorStop(0.30, `rgba(${R},${G},${B},0.90)`);  // edge of ball
    body.addColorStop(0.42, `rgba(${R},${G},${B},0.52)`);  // transition to glow
    body.addColorStop(0.58, `rgba(${R},${G},${B},0.22)`);  // soft bloom
    body.addColorStop(0.76, `rgba(${R},${G},${B},0.07)`);  // diffuse outer halo
    body.addColorStop(1.00, `rgba(${R},${G},${B},0.00)`);  // transparent edge

    ctx.fillStyle = body;
    ctx.fillRect(0, 0, size, size);

    // ── Top-left specular highlight (3-D sphere feel) ─────────────────────
    const hR = Math.min(255, R + 90);
    const hG = Math.min(255, G + 90);
    const hB = Math.min(255, B + 90);
    const hx = center * 0.70;
    const hy = center * 0.66;
    const hr = center * 0.26;
    const hl = ctx.createRadialGradient(hx, hy, 0, hx, hy, hr);
    hl.addColorStop(0.0, `rgba(${hR},${hG},${hB},0.60)`);
    hl.addColorStop(1.0, `rgba(${hR},${hG},${hB},0.00)`);

    ctx.fillStyle = hl;
    ctx.fillRect(0, 0, size, size);

    return PIXI.Texture.from(canvas);
  }
}
