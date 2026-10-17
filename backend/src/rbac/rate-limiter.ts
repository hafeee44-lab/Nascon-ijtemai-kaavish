// Sliding-log limiter: at most `limit` accepted requests per key in any rolling `windowMs`.
// Rejected requests are not logged, so a client is let back in once old hits age out.
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly limit: number, private readonly windowMs: number, private readonly now = () => Date.now()) {}

  /** Returns 0 when allowed, otherwise milliseconds until the next slot frees up. */
  hit(key: string): number {
    const t = this.now();
    const log = (this.hits.get(key) ?? []).filter((x) => x > t - this.windowMs);
    if (log.length >= this.limit) {
      this.hits.set(key, log);
      return Math.max(1, log[0] + this.windowMs - t);
    }
    log.push(t);
    this.hits.set(key, log);
    return 0;
  }
}
