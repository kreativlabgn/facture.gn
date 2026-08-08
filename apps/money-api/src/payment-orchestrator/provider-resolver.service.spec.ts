import { describe, expect, it } from "vitest";
import { DjomyStubProvider } from "./providers/djomy-stub.provider";
import { MonerooStubProvider } from "./providers/moneroo-stub.provider";
import { ProviderResolverService } from "./provider-resolver.service";

describe("ProviderResolverService", () => {
  it("résout djomy vers l'instance DjomyStubProvider injectée", () => {
    const djomy = new DjomyStubProvider();
    const moneroo = new MonerooStubProvider();
    const resolver = new ProviderResolverService(djomy, moneroo);

    expect(resolver.resolve("djomy")).toBe(djomy);
  });

  it("résout moneroo vers l'instance MonerooStubProvider injectée", () => {
    const djomy = new DjomyStubProvider();
    const moneroo = new MonerooStubProvider();
    const resolver = new ProviderResolverService(djomy, moneroo);

    expect(resolver.resolve("moneroo")).toBe(moneroo);
  });

  it("retourne null pour un provider pas encore implémenté (orange_direct/mtn_direct, V1)", () => {
    const resolver = new ProviderResolverService(new DjomyStubProvider(), new MonerooStubProvider());

    expect(resolver.resolve("orange_direct")).toBeNull();
    expect(resolver.resolve("mtn_direct")).toBeNull();
  });
});
