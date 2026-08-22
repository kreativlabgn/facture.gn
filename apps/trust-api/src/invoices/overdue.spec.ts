import { describe, expect, it } from "vitest";
import { isOverdue, OVERDUE_THRESHOLD_DAYS } from "./overdue";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * ONE_DAY_MS);
}

describe("isOverdue (I2, seuil Grille-Offres §3.1)", () => {
  it("OVERDUE_THRESHOLD_DAYS vaut 30 (seul point d'ancrage documentaire trouvé)", () => {
    expect(OVERDUE_THRESHOLD_DAYS).toBe(30);
  });

  it("une facture issued émise il y a 31 jours est en retard", () => {
    expect(isOverdue({ status: "issued", issuedAt: daysAgo(31) })).toBe(true);
  });

  it("une facture issued émise il y a 15 jours n'est pas en retard", () => {
    expect(isOverdue({ status: "issued", issuedAt: daysAgo(15) })).toBe(false);
  });

  it("une facture partially_paid émise il y a 31 jours est en retard", () => {
    expect(isOverdue({ status: "partially_paid", issuedAt: daysAgo(31) })).toBe(true);
  });

  it("une facture paid n'est jamais en retard, même émise il y a 100 jours", () => {
    expect(isOverdue({ status: "paid", issuedAt: daysAgo(100) })).toBe(false);
  });

  it("une facture voided n'est jamais en retard", () => {
    expect(isOverdue({ status: "voided", issuedAt: daysAgo(100) })).toBe(false);
  });

  it("une facture draft (issuedAt null) n'est jamais en retard", () => {
    expect(isOverdue({ status: "draft", issuedAt: null })).toBe(false);
  });
});
