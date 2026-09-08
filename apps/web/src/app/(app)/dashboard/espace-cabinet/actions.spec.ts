import { beforeEach, describe, expect, it, vi } from "vitest";

const requireSessionTokenMock = vi.fn();
const listMyPracticesMock = vi.fn();
const redirectMock = vi.fn();
const cookieSetMock = vi.fn();

vi.mock("@/lib/session", async () => {
  const actual = await vi.importActual<typeof import("@/lib/session")>("@/lib/session");
  return { ...actual, requireSessionToken: () => requireSessionTokenMock() };
});

vi.mock("next/headers", () => ({
  cookies: async () => ({ set: (...args: unknown[]) => cookieSetMock(...args) }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    redirectMock(url);
    // redirect() lève en vrai (NEXT_REDIRECT) : le simuler garantit qu'aucun
    // code ne s'exécute après, comme en production.
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

vi.mock("@/lib/trust-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/trust-api")>("@/lib/trust-api");
  return { ...actual, listMyPractices: (...args: unknown[]) => listMyPracticesMock(...args) };
});

const { entrerDansCabinetAction } = await import("./actions");
const { ACTIVE_PRACTICE_COOKIE } = await import("@/lib/active-practice");

function formulaire(practiceId: string): FormData {
  const data = new FormData();
  data.set("practiceId", practiceId);
  return data;
}

const MIEN = { id: "p-mien", name: "Cabinet Diallo", type: "cabinet_comptable", tier: "partner_free", role: "practice_admin" };

beforeEach(() => {
  vi.clearAllMocks();
  requireSessionTokenMock.mockResolvedValue("jeton");
  listMyPracticesMock.mockResolvedValue([MIEN]);
});

describe("entrerDansCabinetAction — franchissement du seuil", () => {
  it("pose le cabinet actif et entre dans l'espace", async () => {
    await expect(entrerDansCabinetAction(formulaire("p-mien"))).rejects.toThrow(/NEXT_REDIRECT/);

    expect(cookieSetMock).toHaveBeenCalledWith(
      ACTIVE_PRACTICE_COOKIE,
      "p-mien",
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }),
    );
    expect(redirectMock).toHaveBeenCalledWith("/cabinet");
  });

  // LE TEST QUI COMPTE. Un identifiant fabriqué — celui d'un cabinet dont on
  // n'est pas membre — ne doit jamais être écrit. Le cookie n'autorise rien (il
  // est reconfronté à la liste réelle à chaque lecture) et trust-api refuse de
  // toute façon en 403, mais on ne laisse pas non plus croire que le choix a
  // été pris en compte.
  it("refuse un cabinet dont le compte n'est pas membre", async () => {
    await expect(entrerDansCabinetAction(formulaire("p-du-confrere"))).rejects.toThrow(
      /NEXT_REDIRECT/,
    );

    expect(cookieSetMock).not.toHaveBeenCalled();
    expect(redirectMock).toHaveBeenCalledWith("/dashboard/espace-cabinet");
  });

  it("refuse un identifiant vide", async () => {
    await expect(entrerDansCabinetAction(formulaire(""))).rejects.toThrow(/NEXT_REDIRECT/);
    expect(cookieSetMock).not.toHaveBeenCalled();
  });

  it("n'entre nulle part quand le compte n'a aucun cabinet", async () => {
    listMyPracticesMock.mockResolvedValue([]);

    await expect(entrerDansCabinetAction(formulaire("p-mien"))).rejects.toThrow(/NEXT_REDIRECT/);

    expect(cookieSetMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalledWith("/cabinet");
  });

  // Le cookie de contexte ne doit pas survivre au jeton : sur un téléphone
  // partagé, il rouvrirait l'application sur le cabinet choisi par quelqu'un
  // d'autre.
  it("le cookie expire avec la session, jamais après", async () => {
    const { SESSION_MAX_AGE_SECONDS } = await import("@/lib/session");
    await expect(entrerDansCabinetAction(formulaire("p-mien"))).rejects.toThrow(/NEXT_REDIRECT/);

    expect(cookieSetMock.mock.calls[0][2].maxAge).toBe(SESSION_MAX_AGE_SECONDS);
  });
});
