import type { InputMsg } from "snakee-shared/types";
import { INPUT_SEND_RATE } from "snakee-shared/constants";
import type { SocketClient } from "../net/Socket";

const SEND_INTERVAL_MS = 1000 / INPUT_SEND_RATE;

export class InputHandler {
  private angle: number;

  private boosting: boolean;

  private seq: number;

  private readonly root: HTMLElement;

  private sendTimer: number | null;

  private readonly socket: SocketClient;

  private playerScreenX: number;
  private playerScreenY: number;

  public constructor(root: HTMLElement, socket: SocketClient) {
    this.root = root;
    this.socket = socket;
    this.angle = 0;
    this.boosting = false;
    this.seq = 0;
    this.sendTimer = null;
    this.playerScreenX = 0;
    this.playerScreenY = 0;

    // Default to center of screen until player position is provided
    const bounds = this.root.getBoundingClientRect();
    this.playerScreenX = bounds.left + bounds.width * 0.5;
    this.playerScreenY = bounds.top + bounds.height * 0.5;

    this.bindEvents();
    this.startSending();
  }

  public destroy(): void {
    if (this.sendTimer !== null) {
      window.clearInterval(this.sendTimer);
      this.sendTimer = null;
    }
  }

  public isBoosting(): boolean {
    return this.boosting;
  }

  public setPlayerScreenPos(x: number, y: number): void {
    this.playerScreenX = x;
    this.playerScreenY = y;
  }

  private bindEvents(): void {
    this.root.addEventListener("mousemove", (event: MouseEvent) => {
      this.angle = this.computeAngle(event.clientX, event.clientY);
    });

    this.root.addEventListener("touchmove", (event: TouchEvent) => {
      const touch = event.touches.item(0);
      if (touch) {
        this.angle = this.computeAngle(touch.clientX, touch.clientY);
      }
    });

    this.root.addEventListener("contextmenu", (event: Event) => {
      event.preventDefault();
    });

    this.root.addEventListener("mousedown", (event: MouseEvent) => {
      if (event.button === 2) {
        this.boosting = true;
      }
    });

    this.root.addEventListener("mouseup", (event: MouseEvent) => {
      if (event.button === 2) {
        this.boosting = false;
      }
    });

    window.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.code === "Space") {
        this.boosting = true;
      }
    });

    window.addEventListener("keyup", (event: KeyboardEvent) => {
      if (event.code === "Space") {
        this.boosting = false;
      }
    });
  }

  private computeAngle(clientX: number, clientY: number): number {
    // Angle is calculated relative to the player's actual screen position
    return Math.atan2(clientY - this.playerScreenY, clientX - this.playerScreenX);
  }

  private startSending(): void {
    this.sendTimer = window.setInterval(() => {
      const payload: InputMsg = {
        type: "input",
        angle: this.angle,
        boosting: this.boosting,
        seq: this.seq,
        timestamp: Date.now()
      };
      this.seq += 1;
      this.socket.sendInput(payload);
    }, SEND_INTERVAL_MS);
  }
}
