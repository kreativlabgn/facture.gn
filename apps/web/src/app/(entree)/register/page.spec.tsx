import { describe, expect, it, vi, beforeEach } from "vitest";

// Un visiteur déjà connecté qui clique « Inscrire mon cabinet » (returnTo=
// /nouveau-cabinet, cf. lib/espaces.ts) a déjà le compte requis — marchand et
// cabinet partagent le même type de compte (auth-contexte.ts). Avant ce
// correctif, la garde « déjà connecté » de cette page ignorait returnTo et
// renvoyait TOUJOURS sur /dashboard, c'est-à-dire la boutique du marchand :
// le tunnel cabinet s'interrompait sans un mot. Ces tests figent la
// redirection attendue, avec la même garde anti-open-redirect
// (destinationInterne) que registerAction et route-protection.ts.

const redirectMock = vi.fn();
let sessionToken: string | null = null;

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (sessionToken ? { value: sessionToken } : undefined) }),
}));

vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => redirectMock(...args),
}));

function searchParamsOf(returnTo?: string) {
  return Promise.resolve(returnTo === undefined ? {} : { returnTo });
}

describe("RegisterPage — visiteur déjà connecté", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionToken = "jwt-existant";
  });

  it("honore returnTo=/nouveau-cabinet plutôt que d'imposer /dashboard", async () => {
    const { default: RegisterPage } = await import("./page");

    await RegisterPage({ searchParams: searchParamsOf("/nouveau-cabinet") });

    expect(redirectMock).toHaveBeenCalledWith("/nouveau-cabinet");
  });

  it("honore returnTo=/cabinet", async () => {
    const { default: RegisterPage } = await import("./page");

    await RegisterPage({ searchParams: searchParamsOf("/cabinet") });

    expect(redirectMock).toHaveBeenCalledWith("/cabinet");
  });

  it("retombe sur /dashboard sans returnTo (non-régression)", async () => {
    const { default: RegisterPage } = await import("./page");

    await RegisterPage({ searchParams: searchParamsOf(undefined) });

    expect(redirectMock).toHaveBeenCalledWith("/dashboard");
  });

  it("rejette un returnTo externe et retombe sur /dashboard (anti-open-redirect)", async () => {
    const { default: RegisterPage } = await import("./page");

    await RegisterPage({ searchParams: searchParamsOf("https://evil.com") });

    expect(redirectMock).toHaveBeenCalledWith("/dashboard");
  });

  it("rejette un returnTo en contre-oblique et retombe sur /dashboard", async () => {
    const { default: RegisterPage } = await import("./page");

    await RegisterPage({ searchParams: searchParamsOf("/\\evil.com") });

    expect(redirectMock).toHaveBeenCalledWith("/dashboard");
  });

  it("ne redirige pas sans session (le formulaire d'inscription doit s'afficher)", async () => {
    sessionToken = null;
    const { default: RegisterPage } = await import("./page");

    await RegisterPage({ searchParams: searchParamsOf("/nouveau-cabinet") });

    expect(redirectMock).not.toHaveBeenCalled();
  });
});
