import "./styles.css";
import { GameScene } from "./game/GameScene";

const root = document.getElementById("game-root");
if (!root) {
  throw new Error("Missing #game-root element");
}

void (async () => {
  try {
    await GameScene.create(root);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const fallback = document.createElement("pre");
    fallback.style.color = "#ff9ea8";
    fallback.style.padding = "12px";
    fallback.style.fontSize = "13px";
    fallback.textContent = `Game bootstrap failed: ${message}`;
    root.appendChild(fallback);
    // Keep this visible for quick debugging in-browser.
    // eslint-disable-next-line no-console
    console.error(error);
  }
})();
