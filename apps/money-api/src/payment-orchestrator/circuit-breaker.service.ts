import { Injectable } from "@nestjs/common";

export class ProviderTimeoutError extends Error {}

type CircuitState = "closed" | "open" | "half-open";

// ADR-073 : un timeout pur (Promise.race) ne dégrade pas un provider en panne
// permanente — il est appelé à chaque requête jusqu'au timeout. Un vrai circuit
// breaker (OPEN → fail-fast, HALF-OPEN → un appel de probabilité) coupe le
// provider après un seuil d'échecs consécutifs.
//
// Seuil : 5 échecs consécutifs, fenêtre 60s, cooldown 30s. Les échecs sont
// comptés par appel, pas par seconde : un provider lent mais qui répond reste
// closed ; un provider qui timeout ou rejette passe en open.
//
// L'état est conservé en mémoire par instance du service (singleton Nest) — pas
// de persistence. Une redémarrage reset le circuit, ce qui est acceptable : un
// provider redevenu disponible sera réessayé immédiatement.
const CONSECUTIVE_FAILURE_THRESHOLD = 5;
export const OPEN_WINDOW_MS = 60_000;
export const HALF_OPEN_COOLDOWN_MS = 30_000;

@Injectable()
export class CircuitBreakerService {
  private state: CircuitState = "closed";
  private consecutiveFailures = 0;
  private openedAt: number | null = null;
  private lastFailureAt: number | null = null;

  async callWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
    if (this.state === "open") {
      if (this.openedAt && Date.now() - this.openedAt < OPEN_WINDOW_MS) {
        throw new ProviderTimeoutError(
          `Circuit ouvert pour le provider depuis ${Math.round((Date.now() - this.openedAt) / 1000)}s — réessai dans ${Math.round((OPEN_WINDOW_MS - (Date.now() - this.openedAt)) / 1000)}s`,
        );
      }
      // Fenêtre écoulée : on passe en half-open et on laisse passer un appel de
      // probabilité (pas de reset immédiat : si l'appel échoue, on repasse en
      // open ; si il réussit, on reset le compteur).
      this.state = "half-open";
    }

    let timer: NodeJS.Timeout;
    try {
      const result = await Promise.race([
        fn(),
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new ProviderTimeoutError(`Timeout après ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    } finally {
      clearTimeout(timer!);
    }
  }

  private onSuccess(): void {
    this.consecutiveFailures = 0;
    this.openedAt = null;
    this.lastFailureAt = null;
    if (this.state === "half-open") {
      this.state = "closed";
    }
  }

  private onFailure(): void {
    this.lastFailureAt = Date.now();
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD) {
      this.state = "open";
      this.openedAt = Date.now();
    }
  }

  // Exposé pour les tests et la supervision : un provider "sain" est en closed
  // avec 0 échec consécutif.
  get health(): { state: CircuitState; consecutiveFailures: number } {
    return { state: this.state, consecutiveFailures: this.consecutiveFailures };
  }
}