import { FACTURES_MARCHAND_DEMO, type FactureDemo } from "./demo-accounts";

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT FEC DE DÉMONSTRATION — Fichier des Écritures Comptables.
//
// 18 colonnes tabulées, UTF-8, format de l'article A47 A-1 du LPF : exactement
// celui que produit `apps/trust-api/src/fec/`. Un cabinet qui ouvre ce fichier
// dans son outil doit y retrouver la structure qu'il connaît, sinon la
// démonstration ne démontre rien.
//
// ── POURQUOI CE CODE EXISTE EN DOUBLE ───────────────────────────────────────
// Parce que `web` ne dépend pas d'`apps/trust-api` : la frontière entre les
// deux ne passe que par HTTP, et il n'y a aucun paquet de types partagés dans
// ce monorepo. La duplication est donc ASSUMÉE, exactement comme lib/fiscal.ts
// recopie le DTO d'organisation et lib/permissions.ts les @Roles() du backend.
//
// La limite de l'exercice, écrite noir sur blanc : ce fichier ne fabrique un
// FEC que pour le jeu de démonstration. Le vrai export d'une vraie
// organisation passe par trust-api, qui reste seul à connaître les paiements,
// les avoirs et les arrhes. Ce module ne doit JAMAIS être branché sur des
// données réelles — il ne saurait pas les représenter fidèlement.
//
// ── HYPOTHÈSE COMPTABLE ─────────────────────────────────────────────────────
// Comptes SYSCOHADA repris de fec-generation.ts, avec la même réserve qui y est
// écrite : à faire valider par un comptable avant tout usage réel.
// ─────────────────────────────────────────────────────────────────────────────

const EN_TETE_FEC = [
  "JournalCode",
  "JournalLib",
  "EcritureNum",
  "EcritureDate",
  "CompteNum",
  "CompteLib",
  "CompAuxNum",
  "CompAuxLib",
  "PieceRef",
  "PieceDate",
  "EcritureLib",
  "Debit",
  "Credit",
  "EcritureLet",
  "DateLet",
  "ValidDate",
  "Montantdevise",
  "Idevise",
].join("\t");

const COMPTE_CLIENT = { num: "411", lib: "Clients" };
const COMPTE_VENTES = { num: "707", lib: "Ventes de marchandises" };
const COMPTE_TVA = { num: "443", lib: "État, TVA facturée" };
const COMPTE_BANQUE = { num: "521", lib: "Banques locales" };

/** Taux de TVA guinéen en points de base — 1800 = 18 %, miroir de
 *  `taxRateBps` côté trust-api (etax-declaration.ts). */
const TVA_BPS = BigInt(1800);
const BPS_DENOMINATEUR = BigInt(10000);

/** `YYYYMMDD`, en UTC — un export lu à Conakry et un export lu à Paris doivent
 *  porter la même date pour la même facture. */
function dateFec(iso: string): string {
  const date = new Date(iso);
  const annee = date.getUTCFullYear();
  const mois = String(date.getUTCMonth() + 1).padStart(2, "0");
  const jour = String(date.getUTCDate()).padStart(2, "0");
  return `${annee}${mois}${jour}`;
}

/** centimes GNF → GNF à deux décimales. Une colonne de montant ABSENTE reste
 *  vide, jamais « 0.00 » : par écriture, Debit et Credit s'excluent, et un zéro
 *  écrit dans les deux colonnes ferait basculer un contrôle de balance. */
function montantFec(centimes: bigint | null): string {
  if (centimes === null) {
    return "";
  }
  const entier = centimes / BigInt(100);
  const fraction = (centimes % BigInt(100)).toString().padStart(2, "0");
  return `${entier}.${fraction}`;
}

interface LigneFec {
  journalCode: string;
  journalLib: string;
  ecritureNum: number;
  ecritureDate: string;
  compteNum: string;
  compteLib: string;
  pieceRef: string;
  pieceDate: string;
  ecritureLib: string;
  debit: bigint | null;
  credit: bigint | null;
}

function ligneFec(champs: LigneFec): string {
  return [
    champs.journalCode,
    champs.journalLib,
    String(champs.ecritureNum),
    dateFec(champs.ecritureDate),
    champs.compteNum,
    champs.compteLib,
    // CompAuxNum / CompAuxLib / EcritureLet / DateLet / Montantdevise / Idevise
    // restent vides : ni compte auxiliaire, ni lettrage, ni devise étrangère
    // dans ce jeu de données — mêmes colonnes vides que l'export réel.
    "",
    "",
    champs.pieceRef,
    dateFec(champs.pieceDate),
    champs.ecritureLib,
    montantFec(champs.debit),
    montantFec(champs.credit),
    "",
    "",
    dateFec(champs.ecritureDate),
    "",
    "",
  ].join("\t");
}

/** Ventile un TTC en HT + TVA. Les montants de démonstration sont saisis TTC
 *  (le régime du parcours marchand) : la TVA est donc DÉDUITE du total, jamais
 *  ajoutée par-dessus. L'ordre compte — calculer le HT puis prendre le reste
 *  garantit que HT + TVA retombe exactement sur le TTC, au centime, quel que
 *  soit l'arrondi de la division entière. */
function ventilerTtc(ttcCentimes: string): { ht: bigint; tva: bigint; ttc: bigint } {
  const ttc = BigInt(ttcCentimes);
  const ht = (ttc * BPS_DENOMINATEUR) / (BPS_DENOMINATEUR + TVA_BPS);
  return { ht, tva: ttc - ht, ttc };
}

/** Le FEC complet du marchand de démonstration : en-tête, puis N écritures par
 *  facture (ADR-062 — jamais une ligne agrégée). Une facture encaissée porte en
 *  plus son écriture de règlement au journal de banque. */
export function genererFecDemo(factures: FactureDemo[] = FACTURES_MARCHAND_DEMO): string {
  const lignes: string[] = [EN_TETE_FEC];
  let numero = 0;

  // Du plus ancien au plus récent : un journal se lit dans l'ordre où les
  // écritures sont nées. La liste d'écran, elle, est antichronologique — c'est
  // l'inverse, et c'est normal : on consulte le récent, on archive le vieux.
  const chronologique = [...factures].reverse();

  for (const facture of chronologique) {
    const { ht, tva, ttc } = ventilerTtc(facture.montantCentimes);
    const commun = {
      journalCode: "VE",
      journalLib: "Journal des ventes",
      ecritureDate: facture.emiseLe,
      pieceRef: facture.numero,
      pieceDate: facture.emiseLe,
      ecritureLib: `Facture ${facture.numero}`,
    };

    lignes.push(
      ligneFec({
        ...commun,
        ecritureNum: ++numero,
        compteNum: COMPTE_CLIENT.num,
        compteLib: COMPTE_CLIENT.lib,
        debit: ttc,
        credit: null,
      }),
    );
    lignes.push(
      ligneFec({
        ...commun,
        ecritureNum: ++numero,
        compteNum: COMPTE_VENTES.num,
        compteLib: COMPTE_VENTES.lib,
        debit: null,
        credit: ht,
      }),
    );
    if (tva > BigInt(0)) {
      lignes.push(
        ligneFec({
          ...commun,
          ecritureNum: ++numero,
          compteNum: COMPTE_TVA.num,
          compteLib: COMPTE_TVA.lib,
          debit: null,
          credit: tva,
        }),
      );
    }

    // Une facture contestée n'a rien encaissé : elle s'arrête au journal des
    // ventes. Lui inventer un règlement ferait mentir la balance — et c'est
    // précisément ce qu'un cabinet vient vérifier.
    if (facture.encaissee) {
      const reglement = {
        journalCode: "BQ",
        journalLib: "Journal de banque",
        ecritureDate: facture.emiseLe,
        pieceRef: facture.numero,
        pieceDate: facture.emiseLe,
        ecritureLib: `Règlement ${facture.numero}`,
      };
      lignes.push(
        ligneFec({
          ...reglement,
          ecritureNum: ++numero,
          compteNum: COMPTE_BANQUE.num,
          compteLib: COMPTE_BANQUE.lib,
          debit: ttc,
          credit: null,
        }),
      );
      lignes.push(
        ligneFec({
          ...reglement,
          ecritureNum: ++numero,
          compteNum: COMPTE_CLIENT.num,
          compteLib: COMPTE_CLIENT.lib,
          debit: null,
          credit: ttc,
        }),
      );
    }
  }

  return `${lignes.join("\n")}\n`;
}

/** Nom de fichier attendu par un cabinet : SIRET/NIF, la mention FEC, la date
 *  de clôture. Ici le NIF est celui du jeu de démonstration. */
export const NOM_FICHIER_FEC_DEMO = "DEMO000000000FEC20261231.txt";
