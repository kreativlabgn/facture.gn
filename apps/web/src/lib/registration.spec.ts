import { describe, expect, it } from "vitest";
import { normalizeMsisdn, validateRegistration, type RegistrationInput } from "./registration";

const valid: RegistrationInput = {
  name: "Aissatou Barry",
  msisdn: "+224620000001",
  password: "MotDePasseDev2026",
};

const fields = (input: RegistrationInput) => validateRegistration(input).map((violation) => violation.field);

describe("registration — normalisation du numéro", () => {
  it("laisse intacte la forme canonique", () => {
    expect(normalizeMsisdn("+224620000001")).toBe("+224620000001");
  });

  it("retire les espaces du carnet d'adresses", () => {
    expect(normalizeMsisdn("+224 620 00 00 01")).toBe("+224620000001");
    expect(normalizeMsisdn("+224-620-000-001")).toBe("+224620000001");
  });

  it("accepte le 00224 international et le 224 nu", () => {
    expect(normalizeMsisdn("00224620000001")).toBe("+224620000001");
    expect(normalizeMsisdn("224620000001")).toBe("+224620000001");
  });

  it("préfixe un numéro local saisi sans indicatif", () => {
    expect(normalizeMsisdn("620000001")).toBe("+224620000001");
  });

  it("rend tel quel ce qui n'est pas reconnaissable, sans inventer d'indicatif", () => {
    expect(normalizeMsisdn("bonjour")).toBe("bonjour");
    expect(normalizeMsisdn("")).toBe("");
  });
});

describe("registration — validation", () => {
  it("accepte une saisie conforme", () => {
    expect(validateRegistration(valid)).toEqual([]);
  });

  it("accepte 8 comme 9 chiffres après l'indicatif", () => {
    expect(validateRegistration({ ...valid, msisdn: "+22462000001" })).toEqual([]);
    expect(validateRegistration({ ...valid, msisdn: "+224620000001" })).toEqual([]);
  });

  it("refuse un numéro trop court, trop long, ou d'un autre pays", () => {
    expect(fields({ ...valid, msisdn: "+2246200000" })).toEqual(["msisdn"]);
    expect(fields({ ...valid, msisdn: "+2246200000012" })).toEqual(["msisdn"]);
    expect(fields({ ...valid, msisdn: "+33612345678" })).toEqual(["msisdn"]);
  });

  it("refuse un mot de passe de moins de 8 caractères", () => {
    expect(fields({ ...valid, password: "1234567" })).toEqual(["password"]);
    expect(validateRegistration({ ...valid, password: "12345678" })).toEqual([]);
  });

  it("refuse un nom vide ou fait d'espaces", () => {
    expect(fields({ ...valid, name: "   " })).toEqual(["name"]);
  });

  it("remonte toutes les violations d'un coup", () => {
    expect(fields({ name: "", msisdn: "620", password: "court" })).toEqual(["name", "msisdn", "password"]);
  });
});
