import { describe, expect, it, vi, beforeEach } from "vitest";

// Fix minor-followups 2026-08-24, revue post-fix #2 — mergeCustomerAction
// détermine quelle fiche client est DÉFINITIVEMENT supprimée (fusion
// irréversible, cf. commentaire E4/ADR-038 dans actions.ts) : ce test fige le
// seul comportement critique, le sens (normal vs inversé) dans lequel
// canonicalCustomerId/duplicateCustomerId sont transmis à mergeCustomer().
// Reste minimal — pas de suite exhaustive, le repo n'a qu'un seul autre
// fichier de test frontend (route-protection.spec.ts).

const requireSessionTokenMock = vi.fn();
const mergeCustomerMock = vi.fn();
const revalidatePathMock = vi.fn();
const redirectMock = vi.fn();

vi.mock("@/lib/session", () => ({
  requireSessionToken: () => requireSessionTokenMock(),
}));

vi.mock("@/lib/trust-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/trust-api")>("@/lib/trust-api");
  return {
    ...actual,
    mergeCustomer: (...args: unknown[]) => mergeCustomerMock(...args),
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => redirectMock(...args),
}));

function buildFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

describe("mergeCustomerAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionTokenMock.mockResolvedValue("session-token");
    mergeCustomerMock.mockResolvedValue({ id: "canonical-customer" });
  });

  it("sens normal (inverted absent) — canonicalCustomerId=pageCustomerId, duplicateCustomerId=candidateCustomerId", async () => {
    const { mergeCustomerAction } = await import("./actions");
    const formData = buildFormData({
      pageCustomerId: "page-customer",
      candidateCustomerId: "candidate-customer",
      confirmed: "on",
    });

    const result = await mergeCustomerAction(null, formData);

    expect(result).toBeNull();
    expect(mergeCustomerMock).toHaveBeenCalledWith("session-token", "page-customer", "candidate-customer");
    // Pas de redirection : la fiche affichée (pageCustomerId) reste la
    // canonique, donc toujours valide après fusion.
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("sens inversé (inverted=on) — canonicalCustomerId=candidateCustomerId, duplicateCustomerId=pageCustomerId", async () => {
    const { mergeCustomerAction } = await import("./actions");
    const formData = buildFormData({
      pageCustomerId: "page-customer",
      candidateCustomerId: "candidate-customer",
      inverted: "on",
      confirmed: "on",
    });

    const result = await mergeCustomerAction(null, formData);

    expect(result).toBeNull();
    expect(mergeCustomerMock).toHaveBeenCalledWith("session-token", "candidate-customer", "page-customer");
    // La fiche affichée (pageCustomerId) vient d'être supprimée : redirection
    // obligatoire vers la fiche survivante (candidateCustomerId = canonical).
    expect(redirectMock).toHaveBeenCalledWith("/dashboard/customers/candidate-customer");
  });
});
