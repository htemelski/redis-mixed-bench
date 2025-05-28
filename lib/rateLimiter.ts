
/**
 * RateLimiter class that implements a token bucket algorithm for rate limiting operations
 */
export class RateLimiter {
  private tokens: number;
  private lastRefillTimestamp: number;
  private readonly maxTokens: number;
  private readonly tokensPerSecond: number;

  /**
   * Creates a new RateLimiter
   * @param maxOpsPerSecond Maximum operations per second (0 means unlimited)
   */
  constructor(maxOpsPerSecond: number) {
    this.tokensPerSecond = maxOpsPerSecond;
    this.maxTokens = maxOpsPerSecond;
    // Start with a small fraction of max tokens to prevent initial burst
    this.tokens = 1; 
    this.lastRefillTimestamp = Date.now();
  }

  /**
   * Waits for a token to become available, then consumes it
   * @returns Promise that resolves when a token is available and consumed
   */
  async acquire(): Promise<void> {
    // If rate limiting is disabled, return immediately
    if (this.tokensPerSecond <= 0) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.tryAcquire(resolve);
    });
  }

  /**
   * Internal method to try acquiring a token, with retry
   */
  private tryAcquire(resolve: () => void): void {
    this.refillTokens();

    if (this.tokens >= 1) {
      // Token available, consume it
      this.tokens -= 1;
      resolve();
    } else {
      // No token available, wait and try again
      const waitTime = Math.max(5, Math.ceil(1000 / this.tokensPerSecond));
      setTimeout(() => this.tryAcquire(resolve), waitTime);
    }
  }

  /**
   * Refills tokens based on elapsed time
   */
  private refillTokens(): void {
    const now = Date.now();
    const elapsedTimeInSeconds = (now - this.lastRefillTimestamp) / 1000;
    
    if (elapsedTimeInSeconds > 0) {
      // Calculate how many tokens to add based on elapsed time
      const newTokens = elapsedTimeInSeconds * this.tokensPerSecond;
      
      // Update tokens, but don't exceed max
      this.tokens = Math.min(this.maxTokens, this.tokens + newTokens);
      this.lastRefillTimestamp = now;
    }
  }

  /**
   * Gets the current rate limit in operations per second
   * @returns The rate limit in operations per second
   */
  getRateLimit(): number {
    return this.tokensPerSecond;
  }
}