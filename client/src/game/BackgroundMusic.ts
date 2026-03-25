export class BackgroundMusic {
  private audioContext: AudioContext | null;

  private masterGain: GainNode | null;

  private patternTimer: number | null;

  private stepIndex: number;

  private readonly melody: Array<number | null>;

  public constructor() {
    this.audioContext = null;
    this.masterGain = null;
    this.patternTimer = null;
    this.stepIndex = 0;

    // Beethoven - Ode to Joy (public domain composition), synth-only playback.
    this.melody = [
      329.63, 329.63, 349.23, 392.0,
      392.0, 349.23, 329.63, 293.66,
      261.63, 261.63, 293.66, 329.63,
      329.63, 293.66, 293.66, null,
      329.63, 329.63, 349.23, 392.0,
      392.0, 349.23, 329.63, 293.66,
      261.63, 261.63, 293.66, 329.63,
      293.66, 261.63, 261.63, null
    ];

    const unlock = (): void => {
      void this.ensureRunning();
    };

    window.addEventListener("pointerdown", unlock, { passive: true, once: true });
    window.addEventListener("keydown", unlock, { passive: true, once: true });
  }

  public async ensureRunning(): Promise<void> {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = 0.16;
      this.masterGain.connect(this.audioContext.destination);
    }

    if (this.audioContext.state === "suspended") {
      try {
        await this.audioContext.resume();
      } catch {
        return;
      }
    }

    if (this.patternTimer !== null) {
      return;
    }

    this.playStep();
    this.patternTimer = window.setInterval(() => {
      this.playStep();
    }, 340);
  }

  private playStep(): void {
    if (!this.audioContext || !this.masterGain || this.audioContext.state !== "running") {
      return;
    }

    const note = this.melody[this.stepIndex % this.melody.length];
    const now = this.audioContext.currentTime;

    if (note) {
      this.spawnVoice(note, now, 0.3, "triangle", 0.12);
      this.spawnVoice(note * 0.5, now, 0.32, "sine", 0.05);
    }

    this.stepIndex += 1;
  }

  private spawnVoice(
    frequency: number,
    startTime: number,
    duration: number,
    type: OscillatorType,
    level: number
  ): void {
    if (!this.audioContext || !this.masterGain) {
      return;
    }

    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, startTime);

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(level, startTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(startTime);
    osc.stop(startTime + duration + 0.03);
  }
}
