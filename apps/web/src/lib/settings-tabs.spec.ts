import { describe, expect, it } from "vitest";
import { SETTINGS_TABS, resolveSettingsTab } from "./settings-tabs";

describe("resolveSettingsTab — l'onglet vit dans l'URL", () => {
  it("reconnaît les quatre onglets", () => {
    for (const onglet of SETTINGS_TABS) {
      expect(resolveSettingsTab(onglet.cle)).toBe(onglet.cle);
    }
  });

  // L'identité légale par défaut : c'est ce qu'un commerçant vient chercher en
  // premier dans ses paramètres, et le seul onglet que TOUS les paliers ont.
  it("retombe sur l'identité légale", () => {
    expect(resolveSettingsTab(undefined)).toBe("identite");
    expect(resolveSettingsTab("")).toBe("identite");
    // `?tab=` vient de l'URL — donc de n'importe où, y compris d'un lien
    // fabriqué. Un écran vide serait une façon gratuite de faire croire à une
    // panne.
    expect(resolveSettingsTab("onglet_inexistant")).toBe("identite");
  });

  // Next rend un TABLEAU pour `?tab=a&tab=b` : comparer un objet à une chaîne
  // échouerait en silence et renverrait l'onglet par défaut sans le dire.
  it("prend la première valeur quand l'URL en porte plusieurs", () => {
    expect(resolveSettingsTab(["equipe", "api"])).toBe("equipe");
  });

  it("chaque onglet porte un libellé non vide", () => {
    expect(SETTINGS_TABS).toHaveLength(4);
    for (const onglet of SETTINGS_TABS) {
      expect(onglet.label.length).toBeGreaterThan(0);
    }
  });
});
