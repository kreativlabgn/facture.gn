import { Injectable } from "@nestjs/common";

export class ProviderTimeoutError extends Error {}

@Injectable()
export class CircuitBreakerService {
  async callWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
    let timer: NodeJS.Timeout;
    try {
      return await Promise.race([
        fn(),
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new ProviderTimeoutError(`Timeout après ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer!);
    }
  }
}
