import { describe, expect, it, vi } from "vitest";
import { OPEN_WINDOW_MS, CircuitBreakerService, ProviderTimeoutError } from "./circuit-breaker.service";

describe("CircuitBreakerService", () => {
  it("retourne le résultat d'un appel qui répond avant le timeout", async () => {
    const breaker = new CircuitBreakerService();

    const result = await breaker.callWithTimeout(async () => "lien-djomy-genere", 50);

    expect(result).toBe("lien-djomy-genere");
    expect(breaker.health.state).toBe("closed");
  });

  it("rejette avec ProviderTimeoutError un appel qui dépasse le timeout — jamais un appel qui pend indéfiniment", async () => {
    const breaker = new CircuitBreakerService();
    const appelBloque = () => new Promise<string>(() => {}); // ne résout jamais

    await expect(breaker.callWithTimeout(appelBloque, 30)).rejects.toThrow(ProviderTimeoutError);
  });

  it("propage l'erreur d'origine si l'appel échoue avant le timeout (pas une erreur de timeout)", async () => {
    const breaker = new CircuitBreakerService();
    const appelEnErreur = () => Promise.reject(new Error("Djomy indisponible"));

    await expect(breaker.callWithTimeout(appelEnErreur, 50)).rejects.toThrow("Djomy indisponible");
  });

  it("ouvre le circuit après le seuil d'échecs consécutifs", async () => {
    const breaker = new CircuitBreakerService();
    const echec = () => Promise.reject(new Error("provider down"));

    for (let i = 0; i < 4; i++) {
      await expect(breaker.callWithTimeout(echec, 20)).rejects.toThrow("provider down");
    }
    expect(breaker.health.state).toBe("closed");
    expect(breaker.health.consecutiveFailures).toBe(4);

    await expect(breaker.callWithTimeout(echec, 20)).rejects.toThrow("provider down");
    expect(breaker.health.state).toBe("open");
  });

  it("fail-fast en circuit ouvert : aucun appel provider n'est déclenché", async () => {
    const breaker = new CircuitBreakerService();
    const echec = () => Promise.reject(new Error("provider down"));

    for (let i = 0; i < 5; i++) {
      await expect(breaker.callWithTimeout(echec, 20)).rejects.toThrow("provider down");
    }
    const spy = vi.fn(() => Promise.resolve("ok"));
    await expect(breaker.callWithTimeout(spy, 20)).rejects.toThrow(ProviderTimeoutError);
    expect(spy).not.toHaveBeenCalled();
  });

  it("repasse en half-open après la fenêtre d'ouverture et reset sur succès", async () => {
    const breaker = new CircuitBreakerService();
    const echec = () => Promise.reject(new Error("provider down"));

    for (let i = 0; i < 5; i++) {
      await expect(breaker.callWithTimeout(echec, 20)).rejects.toThrow("provider down");
    }
    expect(breaker.health.state).toBe("open");

    // Avance le temps au-delà de la fenêtre d'ouverture.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + OPEN_WINDOW_MS + 1000);
    try {
      const reussi = () => Promise.resolve("recupere");
      const result = await breaker.callWithTimeout(reussi, 20);
      expect(result).toBe("recupere");
      expect(breaker.health.state).toBe("closed");
    } finally {
      vi.useRealTimers();
    }
  });
});