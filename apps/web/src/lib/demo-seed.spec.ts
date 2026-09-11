import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CABINET_DEMO,
  FACTURES_MARCHAND_DEMO,
  MANDATS_CABINET_DEMO,
  MARCHAND_DEMO,
  MOT_DE_PASSE_DEMO,
  portefeuilleDemo,
} from "./demo-accounts";

// ─────────────────────────────────────────────────────────────────────────────
// LA VITRINE ET LE COMPTE RÉEL DOIVENT RACONTER LA MÊME HISTOIRE.
//
// Deux artefacts décrivent les mêmes comptes de démonstration :
//
//   scripts/demo-dataset.json   ce que le seed CRÉE réellement en base
//   lib/demo-accounts.ts        ce que les écrans /demo/* AFFICHENT
//
// Ils sont séparés à dessein — l'un est lu par un script Node hors du bundle,
// l'autre par des composants React — et c'est précisément pour ça qu'ils
// dérivent. Le jour où ils divergent, un visiteur lit « 45 000 000 GNF » sur la
// page d'accueil, se connecte avec les identifiants affichés juste à côté, et
// tombe sur un autre chiffre. Il ne conclura pas qu'un fichier JSON a bougé :
// il conclura que la plateforme ment.
//
// Ce fichier est le point de contact. Il n'a aucune opinion sur le contenu —
// il exige seulement que les deux le portent à l'identique.
// ─────────────────────────────────────────────────────────────────────────────

const RACINE = path.resolve(__dirname, "..", "..", "..", "..");
const CHEMIN_JEU = path.join(RACINE, "scripts", "demo-dataset.json");

interface FactureSemee {
  numero: string;
  client: string;
  emiseLe: string;
  montantGnf: number;
  approuvee: boolean;
  litige: boolean;
  encaissee: boolean;
}

const jeu = JSON.parse(readFileSync(CHEMIN_JEU, "utf8")) as {
  password: string;
  merchant: { msisdn: string; organization: { name: string } };
  practice: { msisdn: string; name: string; registrationNumber: string };
  mandatedOrganizations: { name: string }[];
  invoices: FactureSemee[];
};

describe("le seed et la vitrine décrivent le même marchand", () => {
  it("porte les mêmes identifiants de connexion", () => {
    expect(MARCHAND_DEMO.telephone).toBe(jeu.merchant.msisdn);
    expect(MARCHAND_DEMO.motDePasse).toBe(jeu.password);
    expect(MOT_DE_PASSE_DEMO).toBe(jeu.password);
  });

  it("annonce un mot de passe que trust-api accepterait", () => {
    // auth/dto/register.dto.ts → password: z.string().min(8). Un mot de passe
    // plus court ne peut PAS exister en base : l'afficher recréerait à
    // l'identique le bug d'origine — un identifiant qui invite au geste et le
    // fait échouer.
    expect(MOT_DE_PASSE_DEMO.length).toBeGreaterThanOrEqual(8);
  });

  it("nomme la même organisation", () => {
    expect(MARCHAND_DEMO.organisation).toBe(jeu.merchant.organization.name);
  });

  it("porte facture pour facture le même carnet", () => {
    // Comparaison ligne à ligne plutôt que sur le seul total : deux carnets
    // peuvent totaliser 45 000 000 GNF avec des factures entièrement
    // différentes, et l'écran de démonstration montre les lignes, pas la somme.
    const vitrine = FACTURES_MARCHAND_DEMO.map((facture) => ({
      numero: facture.numero,
      client: facture.client,
      emiseLe: facture.emiseLe,
      montantGnf: Number(facture.montantCentimes) / 100,
      approuvee: facture.approuvee,
      litige: facture.litige,
      encaissee: facture.encaissee,
    }));

    expect(vitrine).toEqual(jeu.invoices);
  });

  it("totalise 45 000 000 GNF des deux côtés", () => {
    const semé = jeu.invoices.reduce((somme, f) => somme + f.montantGnf, 0);
    expect(semé).toBe(45_000_000);
    expect(Number(portefeuilleDemo().volumeCentimes) / 100).toBe(semé);
  });

  it("garde des montants deux à deux distincts", () => {
    // Le seed rapproche une facture déjà émise d'une ligne du jeu PAR SON
    // TOTAL : c'est ce qui lui permet de reprendre après une interruption sans
    // réémettre. Deux factures au même montant lui feraient sauter la seconde,
    // et le carnet resterait incomplet sans que rien ne le signale.
    const montants = jeu.invoices.map((f) => f.montantGnf);
    expect(new Set(montants).size).toBe(montants.length);
  });
});

describe("le seed et la vitrine décrivent le même cabinet", () => {
  it("porte les mêmes identifiants et le même numéro d'Ordre", () => {
    expect(CABINET_DEMO.telephone).toBe(jeu.practice.msisdn);
    expect(CABINET_DEMO.motDePasse).toBe(jeu.password);
    expect(CABINET_DEMO.numeroOcaecg).toBe(jeu.practice.registrationNumber);
    expect(CABINET_DEMO.raisonSociale).toBe(jeu.practice.name);
  });

  it("supervise autant de mandats qu'il en sème", () => {
    // Le marchand compte parmi les mandants : le seed crée quatre
    // organisations de plus, et lui accorde le cinquième mandat.
    expect(jeu.mandatedOrganizations).toHaveLength(MANDATS_CABINET_DEMO.length - 1);
  });

  it("nomme les mêmes entreprises sous mandat", () => {
    const semees = [jeu.merchant.organization.name, ...jeu.mandatedOrganizations.map((o) => o.name)];
    const affichees = MANDATS_CABINET_DEMO.map((m) => m.organisation);
    expect([...semees].sort()).toEqual([...affichees].sort());
  });
});

describe("les deux comptes sont joignables par un numéro guinéen canonique", () => {
  // trust-api n'accepte que +224 suivi de 8 ou 9 chiffres (msisdnSchema).
  // Afficher une forme locale sur la carte ferait échouer le visiteur qui la
  // recopie — c'est exactement le geste qu'on a déjà cassé une fois.
  const CANONIQUE = /^\+224\d{8,9}$/;

  it("affiche le marchand au format que le serveur accepte", () => {
    expect(MARCHAND_DEMO.telephone).toMatch(CANONIQUE);
  });

  it("affiche le cabinet au format que le serveur accepte", () => {
    expect(CABINET_DEMO.telephone).toMatch(CANONIQUE);
  });

  it("ne fait jamais porter le même numéro aux deux comptes", () => {
    expect(MARCHAND_DEMO.telephone).not.toBe(CABINET_DEMO.telephone);
  });
});
