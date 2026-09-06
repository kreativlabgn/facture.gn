import { describe, expect, it, vi, beforeEach } from "vitest";

// registerAction enchaîne DEUX appels API et pose le cookie de session : c'est
// le seul endroit du tunnel où une erreur laisse un compte créé sans session.
// Ces tests figent l'enchaînement, la normalisation du numéro (le même msisdn
// doit servir aux deux appels, sinon le login échoue sur un compte qui vient
// d'être créé) et le fait que le mot de passe ne revienne jamais à l'écran.

const registerMock = vi.fn();
const loginMock = vi.fn();
const cookieSetMock = vi.fn();
const redirectMock = vi.fn();

vi.mock("next/headers", () => ({
  cookies: async () => ({ set: (...args: unknown[]) => cookieSetMock(...args) }),
}));

vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => redirectMock(...args),
}));

vi.mock("@/lib/trust-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/trust-api")>("@/lib/trust-api");
  return {
    ...actual,
    register: (...args: unknown[]) => registerMock(...args),
    login: (...args: unknown[]) => loginMock(...args),
  };
});

function buildFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

const valid = { name: "Aissatou Barry", msisdn: "+224620000001", password: "MotDePasseDev2026" };

describe("registerAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerMock.mockResolvedValue({ userId: "user-1" });
    loginMock.mockResolvedValue({ accessToken: "jwt-token" });
  });

  it("inscrit, se connecte, pose la session et envoie vers l'onboarding", async () => {
    const { registerAction } = await import("./actions");

    await registerAction(null, buildFormData(valid));

    expect(registerMock).toHaveBeenCalledWith(valid);
    expect(loginMock).toHaveBeenCalledWith(valid.msisdn, valid.password);
    expect(cookieSetMock).toHaveBeenCalledWith(
      "fg_session",
      "jwt-token",
      expect.objectContaining({ httpOnly: true, path: "/", sameSite: "lax" }),
    );
    expect(redirectMock).toHaveBeenCalledWith("/onboarding");
  });

  // Le numéro saisi au doigt porte souvent les espaces du carnet d'adresses.
  // Les deux appels doivent recevoir la MÊME forme canonique : normaliser pour
  // register() puis rappeler login() avec la saisie brute créerait un compte
  // sur lequel on ne saurait pas se connecter.
  it("normalise le numéro une seule fois, pour les deux appels", async () => {
    const { registerAction } = await import("./actions");

    await registerAction(null, buildFormData({ ...valid, msisdn: "620 00 00 01" }));

    expect(registerMock).toHaveBeenCalledWith(expect.objectContaining({ msisdn: "+224620000001" }));
    expect(loginMock).toHaveBeenCalledWith("+224620000001", valid.password);
  });

  it("bloque avant tout appel API quand la saisie est invalide", async () => {
    const { registerAction } = await import("./actions");

    const result = await registerAction(null, buildFormData({ ...valid, password: "court" }));

    expect(registerMock).not.toHaveBeenCalled();
    expect(result?.fieldErrors?.password).toContain("8 caractères");
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("ne renvoie jamais le mot de passe à l'écran", async () => {
    const { registerAction } = await import("./actions");

    const result = await registerAction(null, buildFormData({ ...valid, name: "" }));

    expect(result?.values).toEqual({ name: "", msisdn: valid.msisdn });
    expect(JSON.stringify(result)).not.toContain(valid.password);
  });

  // trust-api répond volontairement « Code invalide ou expiré » sur un numéro
  // déjà connu (anti-énumération). Le relayer tel quel est un choix : le
  // reformuler en « ce numéro a déjà un compte » annulerait la protection.
  it("relaie le message de trust-api sans le reformuler", async () => {
    const { TrustApiError } = await import("@/lib/trust-api");
    registerMock.mockRejectedValue(new TrustApiError("Code invalide ou expiré", 401));
    const { registerAction } = await import("./actions");

    const result = await registerAction(null, buildFormData(valid));

    expect(result?.error).toBe("Code invalide ou expiré");
    expect(cookieSetMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  // Le compte EXISTE à ce stade : annoncer un échec d'inscription ferait
  // réessayer l'utilisateur, qui buterait alors sur un numéro déjà pris.
  it("dit que le compte est créé quand seule la connexion échoue", async () => {
    loginMock.mockRejectedValue(new Error("réseau"));
    const { registerAction } = await import("./actions");

    const result = await registerAction(null, buildFormData(valid));

    expect(registerMock).toHaveBeenCalled();
    expect(result?.error).toContain("bien été créé");
    expect(cookieSetMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
