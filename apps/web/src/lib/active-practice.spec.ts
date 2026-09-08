import { describe, expect, it } from "vitest";
import { pickActivePractice } from "./active-practice";
import type { PracticeSummary } from "./trust-api";

const cabinet = (id: string, name: string): PracticeSummary => ({
  id,
  name,
  type: "cabinet_comptable",
  tier: "partner_free",
  role: "practice_admin",
});

const MIEN = cabinet("p-mien", "Cabinet Diallo");
const CONFRERE = cabinet("p-confrere", "CGA de Matam");

describe("pickActivePractice", () => {
  it("retient le cabinet demandé", () => {
    expect(pickActivePractice([MIEN, CONFRERE], "p-confrere")).toBe(CONFRERE);
  });

  it("sans préférence, prend le premier — le plus ancien rattachement", () => {
    expect(pickActivePractice([MIEN, CONFRERE], null)).toBe(MIEN);
  });

  // LE TEST QUI COMPTE. Le cookie n'est pas une autorisation : son contenu est
  // reconfronté à la liste réelle du porteur du JWT. Un identifiant fabriqué —
  // celui d'un cabinet dont on n'est pas membre — est ignoré, jamais utilisé.
  // Le falsifier ne donne accès à rien ; au pire il reste sans effet.
  it("ignore un cabinet qui n'est pas dans la liste du porteur du jeton", () => {
    expect(pickActivePractice([MIEN], "p-confrere")).toBe(MIEN);
  });

  it("ignore aussi une valeur vide ou absurde", () => {
    expect(pickActivePractice([MIEN], "")).toBe(MIEN);
    expect(pickActivePractice([MIEN], "../../autre")).toBe(MIEN);
  });

  it("sans aucun cabinet, il n'y a rien à activer", () => {
    expect(pickActivePractice([], "p-confrere")).toBeNull();
    expect(pickActivePractice([], null)).toBeNull();
  });
});
