import { Injectable } from "@nestjs/common";

export class ProviderTimeoutError extends Error {}

@Injectable()
export class CircuitBreakerService {
  async callWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new ProviderTimeoutError(`Timeout après ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
  }
}
