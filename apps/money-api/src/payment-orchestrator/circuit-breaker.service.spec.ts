import { describe, expect, it } from "vitest";
import { CircuitBreakerService, ProviderTimeoutError } from "./circuit-breaker.service";

describe("CircuitBreakerService", () => {
  it("retourne le résultat d'un appel qui répond avant le timeout", async () => {
    const breaker = new CircuitBreakerService();

    const result = await breaker.callWithTimeout(async () => "lien-djomy-genere", 50);

    expect(result).toBe("lien-djomy-genere");
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
});
