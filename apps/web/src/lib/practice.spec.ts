import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PRACTICE_TYPES,
  PRACTICE_TYPE_LABELS,
  practiceTypeLabel,
  validatePractice,
} from "./practice";

const VALIDE = {
  name: "Cabinet Barry & Associés",
  type: "cabinet_comptable",
  phone: "+224620000001",
  email: "",
};

describe("types de structure", () => {
  // Garde-fou contre la dérive : un PracticeType ajouté au schéma sans libellé
  // ici s'afficherait en identifiant technique dans le sélecteur. Le test lit
  // l'enum à la source plutôt que d'en recopier une liste qui vieillirait.
  it("couvre exactement l'enum ProfessionalPracticeType du schéma Prisma", () => {
    const schema = readFileSync(
      path.resolve(__dirname, "../../../../packages/db/prisma/schema.prisma"),
      "utf8",
    );
    const bloc = schema.match(/enum ProfessionalPracticeType \{([\s\S]*?)\n\}/);
    expect(bloc, "enum ProfessionalPracticeType introuvable dans schema.prisma").toBeTruthy();

    const duSchema = bloc![1]
      .split("\n")
      .map((ligne) => ligne.replace(/\/\/.*$/, "").trim())
      .filter((ligne) => /^[a-z_]+$/.test(ligne));

    expect([...duSchema].sort()).toEqual([...PRACTICE_TYPES].sort());
  });

  it("donne un libellé lisible à chaque type", () => {
    for (const type of PRACTICE_TYPES) {
      expect(PRACTICE_TYPE_LABELS[type]).toBeTruthy();
      expect(PRACTICE_TYPE_LABELS[type]).not.toContain("_");
    }
  });

  // Un type inconnu ne doit jamais faire disparaître l'information : il
  // s'affiche tel quel plutôt que de rendre une chaîne vide.
  it("rend un type inconnu tel quel", () => {
    expect(practiceTypeLabel("nouveau_type")).toBe("nouveau_type");
  });
});

describe("validatePractice", () => {
  it("accepte une saisie complète et valide", () => {
    expect(validatePractice(VALIDE)).toEqual([]);
  });

  it("exige un nom", () => {
    const violations = validatePractice({ ...VALIDE, name: "   " });
    expect(violations.map((v) => v.field)).toEqual(["name"]);
  });

  it("exige un type parmi ceux du schéma", () => {
    const violations = validatePractice({ ...VALIDE, type: "association" });
    expect(violations.map((v) => v.field)).toEqual(["type"]);
  });

  // Même format que le DTO partagé (msisdnSchema) : un numéro accepté ici mais
  // refusé par trust-api produirait une erreur incompréhensible après coup.
  it.each(["620000001", "+2246200", "+33612345678", "+2246200000012"])(
    "refuse le numéro %s",
    (phone) => {
      expect(validatePractice({ ...VALIDE, phone }).map((v) => v.field)).toEqual(["phone"]);
    },
  );

  it.each(["+224620000001", "+22462000000"])("accepte le numéro %s", (phone) => {
    expect(validatePractice({ ...VALIDE, phone })).toEqual([]);
  });

  // L'e-mail est facultatif côté DTO : une chaîne vide est valide, une chaîne
  // mal formée ne l'est pas.
  it("laisse passer un e-mail absent", () => {
    expect(validatePractice({ ...VALIDE, email: "" })).toEqual([]);
  });

  it("refuse un e-mail mal formé", () => {
    expect(validatePractice({ ...VALIDE, email: "contact@" }).map((v) => v.field)).toEqual(["email"]);
  });

  it("signale tous les champs fautifs d'un coup", () => {
    const violations = validatePractice({ name: "", type: "x", phone: "0", email: "z" });
    expect(violations.map((v) => v.field).sort()).toEqual(["email", "name", "phone", "type"]);
  });
});
