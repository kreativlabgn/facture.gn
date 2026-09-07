import { describe, expect, it } from "vitest";
import {
  isTransactionTimeout,
  isUniqueConstraintViolation,
  isUniqueViolation,
} from "./prisma-errors";

// La FORME RÉELLE de l'erreur en production, relevée le 2026-09-07 sur
// facture_gn_dev : sous FORCE ROW LEVEL SECURITY, Postgres supprime le DETAIL
// « Key (colonne)=(valeur) already exists » — la ligne en conflit appartient à
// une autre organisation, invisible au rôle. Prisma en dérive meta.target, donc
// il rend null.
const SOUS_RLS = { code: "P2002", meta: { modelName: "Referral", target: null } };

// La forme qu'on obtient en superutilisateur, et la seule que les specs du
// dépôt fabriquaient — c'est pourquoi le défaut est passé inaperçu.
const SANS_RLS = { code: "P2002", meta: { target: ["referred_organization_id"] } };

describe("isUniqueConstraintViolation", () => {
  it("reconnaît la colonne quand Prisma la nomme", () => {
    expect(isUniqueConstraintViolation(SANS_RLS, "referred_organization_id")).toBe(true);
  });

  it("écarte une autre colonne quand Prisma la nomme", () => {
    expect(isUniqueConstraintViolation(SANS_RLS, "nif")).toBe(false);
  });

  // LE TEST QUI MANQUAIT. Sans ce repli, chaque 409 prévu retombait en 500
  // opaque en production : numérotation de facture, idempotence des paiements
  // et des remboursements, NIF déjà pris.
  it("accepte une violation dont la colonne est masquée par RLS", () => {
    expect(isUniqueConstraintViolation(SOUS_RLS, "referred_organization_id")).toBe(true);
  });

  it("accepte aussi quand meta est absent", () => {
    expect(isUniqueConstraintViolation({ code: "P2002" }, "nif")).toBe(true);
  });

  it("n'attrape rien d'autre qu'une violation d'unicité", () => {
    expect(isUniqueConstraintViolation({ code: "P2028" }, "nif")).toBe(false);
    expect(isUniqueConstraintViolation({ code: "P2025", meta: { target: null } }, "nif")).toBe(false);
    expect(isUniqueConstraintViolation(new Error("panne"), "nif")).toBe(false);
    expect(isUniqueConstraintViolation(null, "nif")).toBe(false);
    expect(isUniqueConstraintViolation(undefined, "nif")).toBe(false);
  });
});

describe("isUniqueViolation", () => {
  it("ne regarde que le code", () => {
    expect(isUniqueViolation(SOUS_RLS)).toBe(true);
    expect(isUniqueViolation(SANS_RLS)).toBe(true);
    expect(isUniqueViolation({ code: "P2003" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

describe("isTransactionTimeout", () => {
  it("ne reconnaît que P2028", () => {
    expect(isTransactionTimeout({ code: "P2028" })).toBe(true);
    expect(isTransactionTimeout(SOUS_RLS)).toBe(false);
    expect(isTransactionTimeout(null)).toBe(false);
  });
});
