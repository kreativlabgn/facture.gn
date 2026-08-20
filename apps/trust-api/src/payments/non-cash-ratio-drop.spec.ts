import { describe, expect, it } from "vitest";
import { detectNonCashRatioDrop } from "./non-cash-ratio-drop";

describe("detectNonCashRatioDrop (G3, ADR-091 — chute brutale du ratio non-cash)", () => {
  it("signale une chute d'au moins 50% du ratio non-cash pour une organisation déjà convertie", () => {
    const dropped = detectNonCashRatioDrop({ priorNonCashRatio: 0.8, recentNonCashRatio: 0.3 });

    expect(dropped).toBe(true);
  });

  it("ignore une chute légère (< 50% relatif)", () => {
    const dropped = detectNonCashRatioDrop({ priorNonCashRatio: 0.8, recentNonCashRatio: 0.6 });

    expect(dropped).toBe(false);
  });

  it("ignore une organisation jamais convertie (ratio antérieur sous le plancher) — rien à faire chuter", () => {
    const dropped = detectNonCashRatioDrop({ priorNonCashRatio: 0.2, recentNonCashRatio: 0.0 });

    expect(dropped).toBe(false);
  });

  it("ignore une hausse du ratio non-cash (jamais un faux positif)", () => {
    const dropped = detectNonCashRatioDrop({ priorNonCashRatio: 0.5, recentNonCashRatio: 0.9 });

    expect(dropped).toBe(false);
  });

  it("signale une chute totale (0.6 → 0)", () => {
    const dropped = detectNonCashRatioDrop({ priorNonCashRatio: 0.6, recentNonCashRatio: 0 });

    expect(dropped).toBe(true);
  });
});
