export type RateLimitPolicy = {
  limit: number;
  windowMs: number;
};

export type RateLimitDecision =
  | { allowed: true; remaining: number }
  | { allowed: false; remaining: 0; retryAfterSeconds: number };

export interface RateLimiter {
  consume(key: string, policy: RateLimitPolicy, now: Date): Promise<RateLimitDecision>;
}

type Bucket = { startedAt: number; count: number };

/** Suitable for one process and tests. Production should use the same interface with Redis. */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  async consume(key: string, policy: RateLimitPolicy, now: Date): Promise<RateLimitDecision> {
    const timestamp = now.getTime();
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.startedAt + policy.windowMs <= timestamp) {
      bucket = { startedAt: timestamp, count: 0 };
      this.buckets.set(key, bucket);
    }

    if (bucket.count >= policy.limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.startedAt + policy.windowMs - timestamp) / 1_000)),
      };
    }

    bucket.count += 1;
    return { allowed: true, remaining: policy.limit - bucket.count };
  }
}
