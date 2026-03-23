import type { DeathMsg } from "snakee-shared/types";

export class DeathScreen {
  private readonly root: HTMLDivElement;

  private readonly details: HTMLDivElement;

  private readonly playAgainButton: HTMLButtonElement;

  public constructor(parent: HTMLElement, onPlayAgain: () => void) {
    this.root = document.createElement("div");
    this.root.className = "death-overlay hidden";

    const card = document.createElement("div");
    card.className = "death-card";

    const title = document.createElement("h2");
    /* changed by gemini */
    title.textContent = "GAME OVER";

    this.details = document.createElement("p");

    this.playAgainButton = document.createElement("button");
    this.playAgainButton.textContent = "PLAY AGAIN";
    this.playAgainButton.addEventListener("click", () => {
      this.hide();
      onPlayAgain();
    });

    card.appendChild(title);
    card.appendChild(this.details);
    card.appendChild(this.playAgainButton);
    this.root.appendChild(card);

    parent.appendChild(this.root);
  }

  public show(message: DeathMsg): void {
    const killerText = message.killerName
      ? `Killer: ${message.killerName}`
      : message.killerId
        ? `Killer: ${message.killerId}`
        : "Hit an obstacle";
    this.details.textContent = `${killerText} | Score: ${message.finalScore}`;
    this.root.classList.remove("hidden");
  }

  public hide(): void {
    this.root.classList.add("hidden");
  }
}
