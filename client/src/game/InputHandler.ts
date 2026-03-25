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

  private readonly boundMouseMove: (event: MouseEvent) => void;
  private readonly boundTouchMove: (event: TouchEvent) => void;
  private readonly boundContextMenu: (event: Event) => void;
  private readonly boundMouseDown: (event: MouseEvent) => void;
  private readonly boundMouseUp: (event: MouseEvent) => void;
  private readonly boundKeyDown: (event: KeyboardEvent) => void;
  private readonly boundKeyUp: (event: KeyboardEvent) => void;

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

    this.boundMouseMove = (event: MouseEvent) => {
      this.angle = this.computeAngle(event.clientX, event.clientY);
    };
    this.boundTouchMove = (event: TouchEvent) => {
      const touch = event.touches.item(0);
      if (touch) {
        this.angle = this.computeAngle(touch.clientX, touch.clientY);
      }
    };
    this.boundContextMenu = (event: Event) => {
      event.preventDefault();
    };
    this.boundMouseDown = (event: MouseEvent) => {
      if (event.button === 2) {
        this.boosting = true;
      }
    };
    this.boundMouseUp = (event: MouseEvent) => {
      if (event.button === 2) {
        this.boosting = false;
      }
    };
    this.boundKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        this.boosting = true;
      }
    };
    this.boundKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        this.boosting = false;
      }
    };

    this.bindEvents();
    this.startSending();
  }

  public destroy(): void {
    if (this.sendTimer !== null) {
      window.clearInterval(this.sendTimer);
      this.sendTimer = null;
    }

    this.root.removeEventListener("mousemove", this.boundMouseMove);
    this.root.removeEventListener("touchmove", this.boundTouchMove);
    this.root.removeEventListener("contextmenu", this.boundContextMenu);
    this.root.removeEventListener("mousedown", this.boundMouseDown);
    this.root.removeEventListener("mouseup", this.boundMouseUp);
    window.removeEventListener("keydown", this.boundKeyDown);
    window.removeEventListener("keyup", this.boundKeyUp);
  }

  public isBoosting(): boolean {
    return this.boosting;
  }

  public setPlayerScreenPos(x: number, y: number): void {
    this.playerScreenX = x;
    this.playerScreenY = y;
  }

  private bindEvents(): void {
    this.root.addEventListener("mousemove", this.boundMouseMove);
    this.root.addEventListener("touchmove", this.boundTouchMove);
    this.root.addEventListener("contextmenu", this.boundContextMenu);
    this.root.addEventListener("mousedown", this.boundMouseDown);
    this.root.addEventListener("mouseup", this.boundMouseUp);
    window.addEventListener("keydown", this.boundKeyDown);
    window.addEventListener("keyup", this.boundKeyUp);
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
