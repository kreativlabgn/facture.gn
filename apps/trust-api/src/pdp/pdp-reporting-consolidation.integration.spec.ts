import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getPrismaClient, type PrismaClient } from "@facture-gn/db";
import { OrganizationSigningKeyService } from "../certification/organization-signing-key.service";
import { InvoiceNumberingService } from "../invoices/invoice-numbering.service";
import { InvoicesService } from "../invoices/invoices.service";
import { PdpConsolidationService } from "./pdp-consolidation.service";
import { PdpReportingNumberingService } from "./pdp-reporting-numbering.service";

// Test d'intégration LOURD — nécessite un Postgres JOIGNABLE.
//
// ── CE QU'IL PROUVE, ET QU'AUCUN TEST UNITAIRE NE PEUT PROUVER ───────────────
//
// 1. LA SOMME TRAVERSE LA BASE SANS PERDRE UN CENTIME. Les montants font
//    l'aller-retour par des colonnes BIGINT réelles. Un mock rendrait les mêmes
//    bigint qu'on lui a donnés ; ici, si un maillon de la chaîne (Prisma, le
//    driver, la colonne) repassait par un flottant, l'écart apparaîtrait — et
//    les montants sont choisis non ronds exprès pour ça.
//
// 2. LE VERROU DE LIGNES EST RÉEL. `SELECT ... FOR UPDATE` ne s'observe pas
//    autrement que sur une vraie base : deux consolidations lancées en parallèle
//    passeraient toutes deux la lecture des lignes `pending` si rien ne les
//    sérialisait, et déclareraient DEUX FOIS la même TVA à la DGI. Un mock
//    rendrait toujours l'ordre que le test a écrit.
//
// 3. LA CHAÎNE DE CERTIFICATION EST COMPLÈTE. Le Z passe par le VRAI
//    InvoicesService.issue() : numéro Article 23 pris dans la séquence
//    `invoice_sequence`, signature Ed25519 par la clé racine de l'organisation,
//    chaînage sur le hash précédent. Aucune de ces primitives n'est simulée.
//
// 4. LES DEUX NUMÉROTATIONS COEXISTENT. Le numéro légal FG-YYYY-NNNNNN et le
//    rang de série ZR-YYYY-NNNNNN sortent de deux compteurs distincts, tous deux
//    incrémentés atomiquement par ON CONFLICT DO UPDATE — un mécanisme qui n'a
//    aucun sens hors d'un Postgres.
//
// ── POURQUOI UNE SONDE, ET PAS `describe.runIf(Boolean(DATABASE_URL))` ───────
// La présence de DATABASE_URL ne dit RIEN de la joignabilité de la base :
// `packages/db/.env` la définit, et Prisma la charge dans process.env dès
// l'import de @facture-gn/db. La condition serait donc TOUJOURS vraie, y compris
// sur un poste sans serveur — le beforeAll tenterait alors d'écrire, échouerait,
// et Vitest marquerait les tests « skipped » tout en faisant échouer le fichier.
//
// Le SELECT 1 lève l'ambiguïté : base joignable → la suite tourne pour de vrai,
// et ne peut donc pas se dérober en silence en CI ; base absente → elle est
// franchement ignorée, sans faux échec à trier.
//
// La sonde vit dans beforeAll et NON en tête de fichier : trust-api compile en
// CommonJS, où le `await` de plus haut niveau est une erreur de compilation
// (TS1378) — invisible sous Vitest, qui transforme en ESM, mais fatale au
// `tsc --noEmit` de la CI.
let baseJoignable = false;

const NOMBRE_DE_TICKETS = 50;

/** Montants VOLONTAIREMENT non ronds, et volontairement grands.
 *
 *  8 413 213,14 GNF HT se relit 8413213.139999999 en IEEE-754 : c'est l'écart
 *  classique, et il ne devient visible qu'après plusieurs dizaines d'additions.
 *  Le total du lot dépasse par ailleurs 4 × 10^10 centimes — au-delà de ce
 *  qu'un `number` JavaScript additionne sans perte au-delà de 2^53. Un chiffre
 *  d'affaires de caisse annuel de cet ordre est parfaitement banal en GNF. */
function ticketDeCaisse(index: number) {
  return {
    totalHtCentimes: BigInt(841_321_314 + index),
    totalVatCentimes: BigInt(151_437_836 + index),
  };
}

function totauxAttendus(nombre = NOMBRE_DE_TICKETS) {
  let ht = BigInt(0);
  let tva = BigInt(0);
  for (let index = 0; index < nombre; index += 1) {
    const ticket = ticketDeCaisse(index);
    ht += ticket.totalHtCentimes;
    tva += ticket.totalVatCentimes;
  }
  return { ht, tva };
}

function compteur() {
  return { inc: vi.fn() };
}

describe("PdpConsolidationService — Z de caisse e-Reporting (Postgres réel)", () => {
  let prisma: PrismaClient;
  let service: PdpConsolidationService;
  let organizationId: string;
  let apiKeyId: string;
  let userId: string;

  /** Dépose `nombre` micro-ventes B2C en attente, comme le ferait un connecteur
   *  de caisse (OwoDesk) sur toute une matinée. `flow: e_reporting` — ces
   *  lignes-là n'ont JAMAIS de job unitaire, elles attendent le cron. */
  async function deposerTickets(nombre = NOMBRE_DE_TICKETS): Promise<string[]> {
    const ids: string[] = [];
    for (let index = 0; index < nombre; index += 1) {
      const { totalHtCentimes, totalVatCentimes } = ticketDeCaisse(index);
      const ligne = await prisma.pdpRawTransaction.create({
        data: {
          organizationId,
          apiKeyId,
          clientUniqueId: `POS/${randomUUID()}`,
          flow: "e_reporting",
          status: "pending",
          totalHtCentimes,
          totalVatCentimes,
          totalTtcCentimes: totalHtCentimes + totalVatCentimes,
          payload: { source: "owodesk-caisse-1", ticket: index },
          receivedAt: new Date(Date.UTC(2026, 8, 9, 6, index)),
        },
        select: { id: true },
      });
      ids.push(ligne.id);
    }
    return ids;
  }

  beforeAll(async () => {
    prisma = getPrismaClient();

    // La sonde. Un échec ici ne signifie PAS que le test échoue : il signifie
    // qu'il n'y a rien à tester sur cette machine.
    try {
      await prisma.$queryRaw`SELECT 1`;
      baseJoignable = true;
    } catch {
      return;
    }

    // Clé de chiffrement enveloppe des clés de signature. Valeur de test, jamais
    // un secret réel : OrganizationSigningKeyService l'exige à la construction
    // (fail-fast voulu), et sans elle rien de ce fichier ne peut s'instancier.
    process.env.CERTIFICATION_MASTER_KEY ??= "a".repeat(64);

    const user = await prisma.user.create({ data: { name: `Caissier PDP ${randomUUID()}` } });
    userId = user.id;

    const organization = await prisma.organization.create({
      data: {
        name: "Supérette PDP SARL",
        // normal_tva → 1800 bps. Le taux du régime est le SEUL admis sur la
        // ligne de synthèse (C4, ADR-033 : jamais un taux fourni par l'appelant).
        regimeFiscal: "normal_tva",
        legalForm: "commercial",
        nif: `NIF-ZR-${randomUUID()}`,
        commercialTier: "enterprise",
      },
    });
    organizationId = organization.id;

    const cle = await prisma.apiKey.create({
      data: {
        organizationId,
        environment: "production",
        keyHash: `argon2id-factice-${randomUUID()}`,
        keySuffix: randomUUID().slice(-4),
        createdByUserId: userId,
      },
    });
    apiKeyId = cle.id;

    const certification = new OrganizationSigningKeyService(prisma);
    // Sans clé racine active, certifyForOrganization() refuse d'émettre : la
    // provisionner fait partie du cycle de vie normal d'une organisation.
    await certification.provisionRootKey(organizationId);

    // La VRAIE chaîne d'émission. Seul le client de lien de paiement est un
    // bouchon : générer un lien pour un Z de caisse ferait un appel réseau vers
    // money-api sans rapport avec ce qui est testé ici (et `tryGenerate` est déjà
    // « meilleur effort » côté production, jamais couplé à la certification).
    const invoices = new InvoicesService(
      prisma,
      new InvoiceNumberingService(prisma),
      certification,
      { tryGenerate: async () => null } as never,
    );

    service = new PdpConsolidationService(
      prisma,
      invoices,
      new PdpReportingNumberingService(),
      compteur() as never,
      compteur() as never,
      compteur() as never,
      compteur() as never,
    );
  });

  // Dérobe chaque test quand la base n'est pas joignable — la seule façon, sous
  // Vitest, de conditionner une suite à un état que seul un appel asynchrone
  // peut établir. `describe.runIf` serait évalué trop tôt (à la collecte), et un
  // `await` de plus haut niveau ne compile pas en CommonJS.
  beforeEach((contexte) => {
    if (!baseJoignable) {
      contexte.skip();
    }
  });

  afterAll(async () => {
    if (!baseJoignable) {
      return;
    }
    // Ordre imposé par les FK — toutes en onDelete: Restrict, précisément pour
    // qu'une pièce fiscale ne disparaisse jamais dans le sillage d'autre chose.
    await prisma.pdpRawTransaction.deleteMany({ where: { organizationId } });
    await prisma.invoiceEvent.deleteMany({ where: { invoice: { organizationId } } });
    await prisma.invoiceLine.deleteMany({ where: { invoice: { organizationId } } });
    await prisma.invoice.deleteMany({ where: { organizationId } });
    await prisma.pdpReportingSequence.deleteMany({ where: { organizationId } });
    await prisma.invoiceSequence.deleteMany({ where: { organizationId } });
    await prisma.organizationSigningKey.deleteMany({ where: { organizationId } });
    await prisma.apiKey.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  // ══ LE test du cahier des charges ════════════════════════════════════════
  describe("50 micro-ventes de caisse compilées en un Z unique", () => {
    let ticketIds: string[];
    let resultat: Awaited<ReturnType<PdpConsolidationService["consolidatePeriodicReporting"]>>;

    beforeAll(async () => {
      if (!baseJoignable) {
        return;
      }
      ticketIds = await deposerTickets();
      resultat = await service.consolidatePeriodicReporting(organizationId);
    });

    it("n'émet qu'UNE facture de synthèse pour les 50 tickets", async () => {
      const factures = await prisma.invoice.findMany({ where: { organizationId } });

      expect(factures).toHaveLength(1);
      expect(factures[0].id).toBe(resultat.invoiceId);
      expect(resultat.ticketCount).toBe(NOMBRE_DE_TICKETS);
      expect(resultat.skipped).toBe(false);
    });

    // LE point du test : pas un centime perdu, pas un centime inventé, après un
    // aller-retour complet par des colonnes BIGINT.
    it("somme les 50 tickets au centime près, à l'aller comme au retour", async () => {
      const attendu = totauxAttendus();
      const facture = await prisma.invoice.findFirstOrThrow({ where: { organizationId } });

      expect(facture.totalHt).toBe(attendu.ht);
      expect(facture.totalTva).toBe(attendu.tva);
      expect(facture.totalTtc).toBe(attendu.ht + attendu.tva);
      // Et la valeur exacte, écrite en dur : si la sommation régressait vers un
      // flottant, c'est CE nombre qui bougerait — pas une comparaison qui se
      // recalculerait avec le même bug.
      expect(facture.totalHt).toBe(BigInt(42_066_066_925));
      expect(facture.totalTva).toBe(BigInt(7_571_893_025));

      // Recomposition depuis les lignes tampons elles-mêmes, relues en base :
      // c'est l'égalité que le contrôleur DGI vérifiera.
      const tickets = await prisma.pdpRawTransaction.findMany({
        where: { id: { in: ticketIds } },
        select: { totalHtCentimes: true, totalVatCentimes: true },
      });
      let ht = BigInt(0);
      let tva = BigInt(0);
      for (const ticket of tickets) {
        ht += ticket.totalHtCentimes;
        tva += ticket.totalVatCentimes;
      }
      expect(ht).toBe(facture.totalHt);
      expect(tva).toBe(facture.totalTva);
    });

    // La chaîne d'émission complète, jamais simulée.
    it("certifie le Z par le chemin d'émission légal", async () => {
      const facture = await prisma.invoice.findFirstOrThrow({ where: { organizationId } });

      expect(facture.status).toBe("issued");
      // Numéro Article 23, pris dans la séquence de l'organisation.
      expect(facture.number).toMatch(/^FG-\d{4}-\d{6}$/);
      expect(facture.certificationId).toMatch(/^GN-.+-\d{4}-.+$/);
      expect(facture.certificationId).toBe(resultat.certificationId);
      // Signature Ed25519 et chaînage : premiers maillons de la chaîne de cette
      // organisation, donc previousHash = sentinelle.
      expect(facture.hash).toBeTruthy();
      expect(facture.previousHash).toBe("GENESIS");
      expect(facture.signature).toBeTruthy();
      expect(facture.signingKeyId).toBeTruthy();
      expect(facture.issuedAt).toBeInstanceOf(Date);
      // Canal SERVEUR — ce document vient de l'API, pas d'un comptoir.
      expect(facture.emissionChannel).toBe("api");
      // Vente de caisse anonyme : on n'invente pas un « client divers ».
      expect(facture.customerId).toBeNull();
    });

    // Les DEUX numérotations, chacune dans son registre. Le rang de série ne
    // remplace jamais le numéro légal — il le complète.
    it("porte un rang de série e-Reporting distinct du numéro légal", async () => {
      const facture = await prisma.invoice.findFirstOrThrow({ where: { organizationId } });

      expect(facture.reportingSeriesNumber).toMatch(/^ZR-\d{4}-\d{6}$/);
      // Premier Z de cette organisation : rang 1, jamais 0.
      expect(facture.reportingSeriesNumber).toBe(`ZR-${new Date().getFullYear()}-000001`);
      expect(facture.reportingSeriesNumber).toBe(resultat.reportingSeriesNumber);
      expect(facture.reportingSeriesNumber).not.toBe(facture.number);

      // Les deux compteurs ont réellement bougé, chacun de son côté.
      const serieZr = await prisma.pdpReportingSequence.findFirstOrThrow({ where: { organizationId } });
      const serieLegale = await prisma.invoiceSequence.findFirstOrThrow({ where: { organizationId } });
      expect(serieZr.lastNumber).toBe(1);
      expect(serieLegale.lastNumber).toBe(1);
    });

    // ADR-108 — le prix unitaire de la ligne de synthèse est un HT. Sans ce
    // marquage, le PDF l'intitulerait « P.U. TTC » et sommerait en un
    // sous-total TTC qui vaudrait le HT.
    it("écrit une ligne de synthèse unique, marquée HT_FIRST", async () => {
      const facture = await prisma.invoice.findFirstOrThrow({ where: { organizationId } });
      const lignes = await prisma.invoiceLine.findMany({ where: { invoiceId: facture.id } });

      expect(lignes).toHaveLength(1);
      expect(lignes[0].saisieRegime).toBe("HT_FIRST");
      expect(lignes[0].unitPrice).toBe(facture.totalHt);
      expect(lignes[0].quantity).toBe(1);
      expect(lignes[0].taxRateBps).toBe(1800);
      expect(lignes[0].description).toContain(facture.reportingSeriesNumber);
      expect(lignes[0].description).toContain(`${NOMBRE_DE_TICKETS} ticket(s)`);
    });

    // La piste d'audit DESCENDANTE : d'un Z certifié vers les tickets bruts.
    it("bascule les 50 lignes tampons en certified et les rattache au Z", async () => {
      const facture = await prisma.invoice.findFirstOrThrow({ where: { organizationId } });
      const tickets = await prisma.pdpRawTransaction.findMany({ where: { id: { in: ticketIds } } });

      expect(tickets).toHaveLength(NOMBRE_DE_TICKETS);
      for (const ticket of tickets) {
        expect(ticket.status).toBe("certified");
        expect(ticket.consolidatedInvoiceId).toBe(facture.id);
        expect(ticket.certificationId).toBe(facture.certificationId);
        expect(ticket.processedAt).toBeInstanceOf(Date);
        expect(ticket.failureReason).toBeNull();
        // L'INVARIANT DU FLUX UNITAIRE EST INTACT. invoice_id porte un index
        // UNIQUE : si le rattachement du lot passait par lui, la 2ᵉ ligne
        // violerait la contrainte. Il reste donc nul sur tout le flux
        // e-reporting, et le e-invoicing garde sa barrière.
        expect(ticket.invoiceId).toBeNull();
      }
    });

    // La jointure remonte dans l'autre sens aussi : c'est ce que la FK et son
    // index existent pour servir.
    it("permet de retrouver les 50 tickets depuis le Z", async () => {
      const facture = await prisma.invoice.findFirstOrThrow({
        where: { organizationId },
        include: { pdpConsolidatedTransactions: { select: { id: true } } },
      });

      expect(facture.pdpConsolidatedTransactions).toHaveLength(NOMBRE_DE_TICKETS);
      expect(new Set(facture.pdpConsolidatedTransactions.map((t) => t.id))).toEqual(new Set(ticketIds));
    });

    // Le lot est soldé : un second passage ne doit RIEN produire. Sans ce
    // garde, chaque exécution horaire du cron émettrait un Z vide de plus, et
    // consommerait un numéro Article 23 pour rien.
    it("ne produit aucun second Z sur un lot déjà soldé", async () => {
      const rejeu = await service.consolidatePeriodicReporting(organizationId);

      expect(rejeu.skipped).toBe(true);
      expect(rejeu.invoiceId).toBeNull();
      expect(await prisma.invoice.count({ where: { organizationId } })).toBe(1);
    });

    // L'organisation a disparu de l'énumération du cron : c'est ce qui empêche
    // l'éventail de reposer indéfiniment des jobs sans travail.
    it("sort de l'énumération des organisations à compiler", async () => {
      const aCompiler = await service.listOrganizationsWithPendingReporting();

      expect(aCompiler).not.toContain(organizationId);
    });
  });

  // ══ Le verrou, sous concurrence réelle ═══════════════════════════════════
  describe("deux compilations simultanées de la même caisse", () => {
    // CE QUE SEUL UN VRAI POSTGRES TRANCHE. Sans `FOR UPDATE`, les deux
    // transactions liraient les mêmes lignes `pending` et produiraient deux Z
    // sur les mêmes ventes — la même TVA déclarée deux fois à la DGI, et une
    // transmission fiscale ne se retire pas.
    it("ne produit qu'UN seul Z, et n'oublie aucun ticket", async () => {
      const avant = await prisma.invoice.count({ where: { organizationId } });
      const ticketIds = await deposerTickets(10);

      // allSettled et non all : la perdante de la course peut légitimement
      // recevoir un conflit REJOUABLE (verrou d'émission expiré, statut déjà
      // `issued`). Ce qui doit être vrai est l'état de la BASE, pas le sort de
      // chaque appel.
      await Promise.allSettled([
        service.consolidatePeriodicReporting(organizationId),
        service.consolidatePeriodicReporting(organizationId),
      ]);

      const tickets = await prisma.pdpRawTransaction.findMany({ where: { id: { in: ticketIds } } });
      const zProduits = new Set(tickets.map((ticket) => ticket.consolidatedInvoiceId));

      // Un seul Z pour les 10 tickets — jamais deux.
      expect(zProduits.size).toBe(1);
      expect(await prisma.invoice.count({ where: { organizationId } })).toBe(avant + 1);

      // Et le total de ce Z est bien celui des 10 tickets, sans double compte.
      const attendu = totauxAttendus(10);
      const z = await prisma.invoice.findFirstOrThrow({
        where: { id: [...zProduits][0] as string },
      });
      expect(z.totalHt).toBe(attendu.ht);
      expect(z.totalTva).toBe(attendu.tva);
    });

    // Le rang de série suit, sans trou ni doublon : c'est l'upsert atomique
    // ON CONFLICT DO UPDATE qui le garantit, jamais un SELECT puis un UPDATE.
    it("incrémente la série ZR d'exactement un rang", async () => {
      const serie = await prisma.pdpReportingSequence.findFirstOrThrow({ where: { organizationId } });

      expect(serie.lastNumber).toBe(2);
    });
  });
});
