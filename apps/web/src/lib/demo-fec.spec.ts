import { describe, expect, it } from "vitest";
import { FACTURES_MARCHAND_DEMO } from "./demo-accounts";
import { genererFecDemo } from "./demo-fec";

// Le FEC est un format LÉGAL : 18 colonnes, tabulées, dans cet ordre. Un
// cabinet qui l'ouvre dans son outil ne lit pas notre code, il lit le fichier —
// une colonne décalée ne se voit qu'au moment où l'import échoue chez lui.
// D'où ces tests, qui vérifient la FORME autant que les chiffres.

const COLONNES = 18;

/** Découpe le fichier en lignes SANS `trim()`.
 *
 *  Une écriture FEC finit par deux colonnes vides (Montantdevise, Idevise),
 *  donc par deux TABULATIONS — que `trim()` considère comme des blancs et
 *  supprime. La dernière ligne perdait ainsi 2 de ses 18 colonnes, et le test
 *  accusait le générateur d'un défaut qui était le sien. On ne retire donc que
 *  le saut de ligne final, à l'octet près. */
function lignes(): string[] {
  return genererFecDemo().replace(/\n$/, "").split("\n");
}

describe("export FEC de démonstration", () => {
  it("commence par l'en-tête légal des 18 colonnes", () => {
    const [entete] = lignes();
    expect(entete.split("\t")).toHaveLength(COLONNES);
    expect(entete.split("\t")[0]).toBe("JournalCode");
    expect(entete.split("\t")[COLONNES - 1]).toBe("Idevise");
  });

  it("écrit exactement 18 colonnes sur CHAQUE écriture, en-tête compris", () => {
    for (const ligne of lignes()) {
      expect(ligne.split("\t")).toHaveLength(COLONNES);
    }
  });

  it("numérote les écritures sans trou, à partir de 1", () => {
    const numeros = lignes()
      .slice(1)
      .map((ligne) => Number(ligne.split("\t")[2]));
    expect(numeros[0]).toBe(1);
    expect(numeros).toEqual(numeros.map((_, index) => index + 1));
  });

  it("porte les dates en YYYYMMDD, jamais en ISO", () => {
    for (const ligne of lignes().slice(1)) {
      expect(ligne.split("\t")[3]).toMatch(/^\d{8}$/);
    }
  });

  // Le contrôle qu'un comptable fait en premier. Une balance qui ne tombe pas
  // juste disqualifie le fichier entier, quel qu'en soit le reste.
  it("équilibre les débits et les crédits au centime", () => {
    let debits = BigInt(0);
    let credits = BigInt(0);

    for (const ligne of lignes().slice(1)) {
      const colonnes = ligne.split("\t");
      debits += centimes(colonnes[11]);
      credits += centimes(colonnes[12]);
    }

    expect(debits).toBe(credits);
    expect(debits).toBeGreaterThan(BigInt(0));
  });

  it("n'écrit jamais un débit ET un crédit sur la même écriture", () => {
    for (const ligne of lignes().slice(1)) {
      const colonnes = ligne.split("\t");
      expect(colonnes[11] === "" || colonnes[12] === "").toBe(true);
    }
  });

  // ADR-062 : N écritures par facture, jamais une ligne agrégée. Une facture
  // encaissée en porte deux de plus, au journal de banque.
  it("ouvre un journal de banque pour les seules factures encaissées", () => {
    const reglements = lignes()
      .slice(1)
      .filter((ligne) => ligne.split("\t")[0] === "BQ");
    const encaissees = FACTURES_MARCHAND_DEMO.filter((facture) => facture.encaissee);

    expect(reglements).toHaveLength(encaissees.length * 2);

    // Une facture contestée n'a rien encaissé : lui inventer un règlement
    // ferait mentir la balance, et c'est précisément ce qu'un cabinet vérifie.
    const referencesReglees = new Set(reglements.map((ligne) => ligne.split("\t")[8]));
    for (const facture of FACTURES_MARCHAND_DEMO.filter((item) => item.litige)) {
      expect(referencesReglees.has(facture.numero)).toBe(false);
    }
  });

  it("ventile chaque facture en HT + TVA qui retombent exactement sur le TTC", () => {
    const ventes = lignes()
      .slice(1)
      .filter((ligne) => ligne.split("\t")[0] === "VE");

    const premiere = FACTURES_MARCHAND_DEMO[FACTURES_MARCHAND_DEMO.length - 1];
    const sesLignes = ventes.filter((ligne) => ligne.split("\t")[8] === premiere.numero);

    const ttc = centimes(sesLignes[0].split("\t")[11]);
    const ht = centimes(sesLignes[1].split("\t")[12]);
    const tva = centimes(sesLignes[2].split("\t")[12]);

    expect(ttc).toBe(BigInt(premiere.montantCentimes));
    expect(ht + tva).toBe(ttc);
  });

  it("classe les écritures du plus ancien au plus récent", () => {
    const dates = lignes()
      .slice(1)
      .map((ligne) => ligne.split("\t")[3]);
    expect([...dates].sort()).toEqual(dates);
  });
});

/** « 1234.56 » → 123456 centimes. Une colonne vide vaut zéro. */
function centimes(montant: string): bigint {
  if (montant === "") {
    return BigInt(0);
  }
  const [entier, fraction] = montant.split(".");
  return BigInt(entier) * BigInt(100) + BigInt(fraction);
}
