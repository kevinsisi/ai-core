import { KeyPool } from "../key-pool/key-pool.js";

export class LeaseHeartbeat {
  private timer: ReturnType<typeof setInterval> | null = null;

  private leaseError: Error | null = null;

  private currentKey: string;

  private readonly intervalMs: number;

  constructor(private readonly pool: KeyPool, apiKey: string, intervalMs?: number) {
    this.currentKey = apiKey;
    this.intervalMs =
      intervalMs ?? Math.max(250, Math.min(60_000, Math.floor(pool.getAllocationLeaseMs() / 2)));
    this.start();
  }

  private start(): void {
    this.stop();
    this.leaseError = null;
    this.timer = setInterval(() => {
      this.pool
        .renewLease(this.currentKey)
        .then((renewed) => {
          if (!renewed) {
            this.leaseError = new Error(`Lost key lease for ${this.currentKey}`);
            this.stop();
          }
        })
        .catch((error) => {
          this.leaseError = error instanceof Error ? error : new Error(String(error));
          this.stop();
        });
    }, this.intervalMs);

    if (this.timer && typeof this.timer.unref === "function") {
      this.timer.unref();
    }
  }

  switchKey(apiKey: string): void {
    if (apiKey === this.currentKey) return;
    this.currentKey = apiKey;
    this.start();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  getError(): Error | null {
    return this.leaseError;
  }
}
