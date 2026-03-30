import * as PIXI from "pixi.js";
import { Text, TextStyle } from "pixi.js";
import { SNAKE_BODY_RADIUS } from "snakee-shared/constants";
import type { SnakeState } from "snakee-shared/types";

type SnakeDisplay = {
  container: PIXI.Container;
  body: PIXI.Graphics;
  head: PIXI.Graphics;
  nameText: Text;
  prevTravelAngle?: number;
};

type SnakeTheme = {
  primary: number;
  secondary: number;
};

// Vivid colours matching the reference slither.io screenshot
const SNAKE_THEMES: SnakeTheme[] = [
  { primary: 0x40aaee, secondary: 0x0277bd },  // vivid blue
  { primary: 0x48c840, secondary: 0x1b7a22 },  // vivid green
  { primary: 0xf03a30, secondary: 0xb71c1c },  // vivid red
  { primary: 0xb060d8, secondary: 0x7b1fa2 },  // vivid purple
  { primary: 0xee6680, secondary: 0xad1457 },  // vivid pink
  { primary: 0xf5d020, secondary: 0xe65100 },  // vivid yellow
  { primary: 0x26c9b8, secondary: 0x00695c },  // teal
  { primary: 0xf07030, secondary: 0xbf360c },  // orange
  { primary: 0x90d040, secondary: 0x558b2f },  // lime
  { primary: 0xf040a0, secondary: 0xad1457 },  // magenta
  { primary: 0x40d4f0, secondary: 0x0097a7 },  // cyan
  { primary: 0xff8855, secondary: 0xbf360c },  // salmon
];

export class SnakeRenderer {
  private readonly layer: PIXI.Container;

  private readonly displays: Map<string, SnakeDisplay>;

  private readonly nameStyle: TextStyle;

  public constructor(layer: PIXI.Container) {
    this.layer = layer;
    this.displays = new Map<string, SnakeDisplay>();
    this.nameStyle = new TextStyle({
      fontFamily: "'Arial Rounded MT Bold', 'Arial', sans-serif",
      fontSize: 13,
      fill: 0xffffff,
      stroke: { color: 0x000000, width: 3 },
      align: "center"
    });
  }

  public render(snakes: SnakeState[], playerId?: string, mouseWorld?: { x: number; y: number }): void {
    const seen = new Set<string>();

    for (const snake of snakes) {
      if (!snake.alive || snake.segments.length === 0) {
        continue;
      }
      seen.add(snake.id);
      const display = this.ensureDisplay(snake.id);
      this.drawSnake(display, snake, snake.id === playerId ? mouseWorld : undefined);
    }

    for (const [id, display] of this.displays.entries()) {
      if (!seen.has(id)) {
        this.layer.removeChild(display.container);
        display.container.destroy({ children: true });
        this.displays.delete(id);
      }
    }
  }

  private ensureDisplay(id: string): SnakeDisplay {
    const existing = this.displays.get(id);
    if (existing) {
      return existing;
    }

    const container = new PIXI.Container();
    const body = new PIXI.Graphics();
    const head = new PIXI.Graphics();
    const nameText = new Text({ text: "", style: this.nameStyle });
    nameText.anchor.set(0.5, 1);

    container.addChild(body);
    container.addChild(head);
    container.addChild(nameText);
    this.layer.addChild(container);

    const created: SnakeDisplay = { container, body, head, nameText };
    this.displays.set(id, created);
    return created;
  }

  private drawSnake(display: SnakeDisplay, snake: SnakeState, lookTarget?: { x: number; y: number }): void {
    display.body.clear();
    display.head.clear();

    const head = snake.segments[0];
    const theme = SNAKE_THEMES[this.themeIndexFromId(snake.id)];
    const segs = snake.segments;

    const scoreFactor = Math.min(2.5, 1 + Math.sqrt(snake.score || 0) * 0.04);
    const bodyRadius = SNAKE_BODY_RADIUS * 1.5 * scoreFactor;
    const headRadius = bodyRadius * 1.05;

    // Pass 1: Base body — solid colour tube
    for (let i = segs.length - 1; i >= 1; i -= 1) {
      const seg = segs[i];
      display.body.beginFill(theme.primary, 1);
      display.body.drawCircle(seg.x, seg.y, bodyRadius);
      display.body.endFill();
    }

    // Pass 2: Ring bands — full-width arc perpendicular to travel direction,
    // one per segment boundary, giving the ribbed tube appearance
    const arcR = bodyRadius * 0.97;
    for (let i = segs.length - 1; i >= 2; i -= 1) {
      const seg  = segs[i];
      const next = segs[i - 1];
      const angle = Math.atan2(next.y - seg.y, next.x - seg.x);
      // Arc from right-perp to left-perp through the forward face = full-width ring
      display.body.lineStyle(1.6, 0x000000, 0.28);
      display.body.moveTo(
        seg.x + Math.cos(angle + Math.PI * 0.5) * arcR,
        seg.y + Math.sin(angle + Math.PI * 0.5) * arcR
      );
      display.body.arc(seg.x, seg.y, arcR, angle + Math.PI * 0.5, angle - Math.PI * 0.5, true);
    }
    display.body.lineStyle(0);

    // Pass 3: Top cylindrical highlight — wide bright ellipse giving the 3D tube look
    for (let i = segs.length - 1; i >= 1; i -= 1) {
      const seg = segs[i];
      // Outer broad glow
      display.body.beginFill(0xffffff, 0.34);
      display.body.drawEllipse(
        seg.x,
        seg.y - bodyRadius * 0.14,
        bodyRadius * 0.76,
        bodyRadius * 0.46
      );
      display.body.endFill();
      // Inner gloss peak
      display.body.beginFill(0xffffff, 0.22);
      display.body.drawEllipse(
        seg.x,
        seg.y - bodyRadius * 0.24,
        bodyRadius * 0.38,
        bodyRadius * 0.20
      );
      display.body.endFill();
    }

    // Pass 4: Boost inner glow
    if (snake.boosting) {
      for (let i = segs.length - 1; i >= 1; i -= 1) {
        const seg = segs[i];
        display.body.beginFill(0xffffff, 0.22);
        display.body.drawCircle(seg.x, seg.y, bodyRadius * 0.45);
        display.body.endFill();
      }
    }

    // --- Head ---
    display.head.beginFill(theme.primary, 1);
    display.head.drawCircle(head.x, head.y, headRadius);
    display.head.endFill();

    // Head cylindrical highlight (same treatment as body)
    display.head.beginFill(0xffffff, 0.34);
    display.head.drawEllipse(
      head.x,
      head.y - headRadius * 0.14,
      headRadius * 0.76,
      headRadius * 0.46
    );
    display.head.endFill();
    display.head.beginFill(0xffffff, 0.22);
    display.head.drawEllipse(
      head.x,
      head.y - headRadius * 0.24,
      headRadius * 0.38,
      headRadius * 0.20
    );
    display.head.endFill();

    // --- Eyes ---
    const neck = snake.segments[1] ?? { x: head.x - 1, y: head.y };
    const travelAngle = Math.atan2(head.y - neck.y, head.x - neck.x);

    let pupilAngle: number;
    if (lookTarget) {
      // Player: pupils follow mouse
      pupilAngle = Math.atan2(lookTarget.y - head.y, lookTarget.x - head.x);
    } else {
      // Bot: pupils lead the turn — shift in the direction of rotation
      const prev = display.prevTravelAngle ?? travelAngle;
      // Normalise delta to [-π, π]
      let delta = travelAngle - prev;
      delta = ((delta + Math.PI) % (Math.PI * 2)) - Math.PI;
      // Amplify and clamp so pupils visibly shift when turning
      const lead = Math.max(-0.6, Math.min(0.6, delta * 8));
      pupilAngle = travelAngle + lead;
    }
    display.prevTravelAngle = travelAngle;

    const eyeSize    = headRadius * 0.44;
    const pupilSize  = eyeSize * 0.62;
    const eyeOffset  = headRadius * 0.52;
    const pupilTravel = eyeSize * 0.30;

    // Left eye
    const lx = head.x + Math.cos(travelAngle - 0.62) * eyeOffset;
    const ly = head.y + Math.sin(travelAngle - 0.62) * eyeOffset;
    display.head.beginFill(0xffffff, 1);
    display.head.drawCircle(lx, ly, eyeSize);
    display.head.endFill();
    const lpx = lx + Math.cos(pupilAngle) * pupilTravel;
    const lpy = ly + Math.sin(pupilAngle) * pupilTravel;
    display.head.beginFill(0x111111, 1);
    display.head.drawCircle(lpx, lpy, pupilSize);
    display.head.endFill();

    // Right eye
    const rx = head.x + Math.cos(travelAngle + 0.62) * eyeOffset;
    const ry = head.y + Math.sin(travelAngle + 0.62) * eyeOffset;
    display.head.beginFill(0xffffff, 1);
    display.head.drawCircle(rx, ry, eyeSize);
    display.head.endFill();
    const rpx = rx + Math.cos(pupilAngle) * pupilTravel;
    const rpy = ry + Math.sin(pupilAngle) * pupilTravel;
    display.head.beginFill(0x111111, 1);
    display.head.drawCircle(rpx, rpy, pupilSize);
    display.head.endFill();

    // --- Name label ---
    display.nameText.text = snake.name;
    display.nameText.style.fontSize = 13 * scoreFactor;
    display.nameText.position.set(head.x, head.y - headRadius - 10);
  }

  private stableHash(id: string): number {
    let hash = 0;
    for (let i = 0; i < id.length; i += 1) {
      hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    }
    return hash;
  }

  private themeIndexFromId(id: string): number {
    return this.stableHash(id) % SNAKE_THEMES.length;
  }

}
