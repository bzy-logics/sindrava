/** Exponential backoff with ±jitter, used for WebSocket reconnects. */
export class Backoff {
  private current: number;

  constructor(
    readonly min = 500,
    readonly max = 10_000,
    readonly factor = 2,
    /** Fractional jitter: 0.2 means the delay is scaled by [0.8, 1.2). */
    readonly jitter = 0.2,
    private readonly random: () => number = Math.random,
  ) {
    this.current = min;
  }

  /** Delay (ms) for the next attempt; grows the base delay up to `max`. */
  next(): number {
    const base = this.current;
    this.current = Math.min(this.max, Math.round(this.current * this.factor));
    return base * (1 - this.jitter + this.random() * 2 * this.jitter);
  }

  reset() {
    this.current = this.min;
  }
}
