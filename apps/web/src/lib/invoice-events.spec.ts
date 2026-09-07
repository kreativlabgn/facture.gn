import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { invoiceEventLabel, knownInvoiceEventTypes } from "./invoice-events";

describe("invoiceEventLabel", () => {
  it("traduit un type connu et lui donne un ton", () => {
    expect(invoiceEventLabel("dispute_raised")).toEqual({
      label: "Litige ouvert par le client",
      ton: "alerte",
    });
  });

  // Perdre une ligne d'une trace WORM (ADR-015) parce qu'un libellé manque
  // serait bien pire que d'afficher un intitulé disgracieux : un type inconnu
  // reste visible, sous son nom technique rendu lisible.
  it("n'escamote jamais un type inconnu", () => {
    expect(invoiceEventLabel("evenement_du_futur")).toEqual({
      label: "evenement du futur",
      ton: "neutre",
    });
  });

  // Garde-fou contre la dérive : un InvoiceEventType ajouté au schéma sans
  // libellé ici s'afficherait en anglais technique au commerçant. Le test lit
  // l'enum à la source plutôt que d'en recopier une liste qui vieillirait.
  it("couvre tous les InvoiceEventType du schéma Prisma", () => {
    const schema = readFileSync(
      path.resolve(__dirname, "../../../../packages/db/prisma/schema.prisma"),
      "utf8",
    );
    const bloc = schema.match(/enum InvoiceEventType \{([\s\S]*?)\n\}/);
    expect(bloc, "enum InvoiceEventType introuvable dans schema.prisma").toBeTruthy();

    const duSchema = bloc![1]
      .split("\n")
      .map((ligne) => ligne.replace(/\/\/.*$/, "").trim())
      .filter((ligne) => /^[a-z_]+$/.test(ligne));

    expect(duSchema.length).toBeGreaterThan(20);
    const traduits = new Set(knownInvoiceEventTypes());
    const manquants = duSchema.filter((type) => !traduits.has(type));
    expect(manquants, `types sans libellé français : ${manquants.join(", ")}`).toEqual([]);
  });

  // L'inverse : un libellé qui ne correspond à aucun type du schéma est du code
  // mort qui laisse croire que le cas est couvert.
  it("ne traduit aucun type qui n'existe pas au schéma", () => {
    const schema = readFileSync(
      path.resolve(__dirname, "../../../../packages/db/prisma/schema.prisma"),
      "utf8",
    );
    const duSchema = new Set(
      schema
        .match(/enum InvoiceEventType \{([\s\S]*?)\n\}/)![1]
        .split("\n")
        .map((ligne) => ligne.replace(/\/\/.*$/, "").trim())
        .filter((ligne) => /^[a-z_]+$/.test(ligne)),
    );
    const orphelins = knownInvoiceEventTypes().filter((type) => !duSchema.has(type));
    expect(orphelins, `libellés sans type correspondant : ${orphelins.join(", ")}`).toEqual([]);
  });
});
