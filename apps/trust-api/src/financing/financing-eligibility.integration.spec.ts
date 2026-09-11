import { PreconditionFailedException } from "@nestjs/common";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPrismaClient, type PrismaClient } from "@facture-gn/db";
import { FinancingService } from "./financing.service";
import { financeableInvoiceWhere } from "./is-financeable";

// Crash-test de non-régression du Capital Layer, contre un vrai Postgres.
// Prouve qu'une facture ENCAISSÉE ou EN LITIGE est refusée au rachat par le
// serveur lui-même, et pas seulement masquée par l'écran de la PME.
//
// La joignabilité de la base est SONDÉE, jamais déduite de DATABASE_URL :
// Prisma charge packages/db/.env dès l'import de @facture-gn/db, si bien que
// `Boolean(process.env.DATABASE_URL)` est vrai même sans serveur en face — un
// beforeAll qui écrirait alors dans le vide ferait échouer la suite sur un
// diagnostic trompeur. Sans base, les tests sont ignorés avec une trace.
describe("Financement — éligibilité réelle sous Postgres (K4, ADR-031/088/089)", () => {
  let prisma: PrismaClient;
  let service: FinancingService;

  let joignable = false;
  let organizationId: string;
  let customerId: string;
  let publicBuyerAccountId: string;
  let partnerId: string;
  let actorId: string;
  let factureEncaissee: string;
  let factureEnLitige: string;
  let factureCedable: string;

  const dto = { financialPartnerId: "", disbursementMethod: "bank_transfer" as const };

  beforeAll(async () => {
    prisma = getPrismaClient();
    try {
      await prisma.$queryRaw`SELECT 1`;
      joignable = true;
    } catch {
      return;
    }

    service = new FinancingService(prisma);

    // Seed IDEMPOTENT, ancré sur des clés fixes plutôt que sur des uuid neufs.
    // Raison : invoice_event est append-only (ADR-015, trigger Postgres qui
    // refuse tout DELETE), donc une exécution qui cède la facture témoin laisse
    // une trace indestructible — et avec elle une facture indestructible, car
    // invoice_event.invoice_id référence invoice. Un seed à uuid neuf ferait
    // donc grossir la base d'une organisation à chaque lancement. Ici les mêmes
    // lignes sont réutilisées, et seule la trace de décaissement s'ajoute :
    // c'est exactement ce qu'un registre append-only doit faire.
    const NIF = "NIF-BANC-ESSAI-FINANCEMENT";

    const org =
      (await prisma.organization.findFirst({ where: { nif: NIF } })) ??
      (await prisma.organization.create({
        data: {
          name: "Fournisseur Marchés Publics — banc d'essai",
          regimeFiscal: "tpu",
          legalForm: "commercial",
          nif: NIF,
        },
      }));
    organizationId = org.id;

    const compte =
      (await prisma.publicBuyerAccount.findFirst({
        where: { name: "Direction des Grands Travaux — banc d'essai" },
      })) ??
      (await prisma.publicBuyerAccount.create({
        data: {
          name: "Direction des Grands Travaux — banc d'essai",
          verificationStatus: "verified",
        },
      }));
    publicBuyerAccountId = compte.id;

    // Les cinq conditions historiques sont TOUTES satisfaites : compte acheteur
    // vérifié, lien confirmé, facture visée, jamais cédée. Ce qui distingue les
    // trois factures ci-dessous n'est donc que le statut et le litige — sans
    // quoi ce test prouverait le refus pour la mauvaise raison.
    const client =
      (await prisma.customer.findFirst({ where: { organizationId } })) ??
      (await prisma.customer.create({
        data: {
          organizationId,
          name: "Direction des Grands Travaux",
          isPublicEntity: true,
          isPublicEntityConfirmed: true,
          publicBuyerAccountId,
        },
      }));
    customerId = client.id;

    // invoice_event.actor_id porte une clé étrangère vers user : la trace de
    // décaissement exige un acteur qui existe vraiment, un uuid inventé la fait
    // échouer au commit.
    const acteur =
      (await prisma.user.findFirst({ where: { name: "Testeur Financement" } })) ??
      (await prisma.user.create({ data: { name: "Testeur Financement" } }));
    actorId = acteur.id;

    const partenaire = await prisma.financialPartner.upsert({
      where: { name: "Akiba Finance — banc d'essai" },
      update: { status: "active" },
      create: { name: "Akiba Finance — banc d'essai", type: "banque", status: "active" },
    });
    partnerId = partenaire.id;
    dto.financialPartnerId = partnerId;

    const commun = {
      organizationId,
      customerId,
      validatedByAdministration: true,
      totalHt: 40_000_000n,
      totalTva: 0n,
      totalTtc: 40_000_000n,
    };

    // Les trois factures sont RÉUTILISÉES d'une exécution à l'autre, et remises
    // dans leur état de départ. `financedByPartnerId: null` est ce qui rend le
    // témoin rejouable : la cession de l'exécution précédente est annulée par
    // un UPDATE, jamais par un DELETE que le registre refuserait.
    factureEncaissee = await remettreEnEtat(prisma, organizationId, "BANC-ESSAI-ENCAISSEE", {
      ...commun,
      status: "paid",
      amountPaid: 40_000_000n,
      amountDue: 0n,
    });
    factureEnLitige = await remettreEnEtat(prisma, organizationId, "BANC-ESSAI-LITIGE", {
      ...commun,
      status: "issued",
      disputeStatus: "disputed",
      amountDue: 40_000_000n,
    });
    factureCedable = await remettreEnEtat(prisma, organizationId, "BANC-ESSAI-CEDABLE", {
      ...commun,
      status: "issued",
      amountDue: 40_000_000n,
    });
  });

  beforeEach((ctx) => {
    if (!joignable) ctx.skip();
  });

  afterAll(async () => {
    if (!joignable) return;
    // Aucun DELETE : invoice_event est append-only (ADR-015) et sa trace
    // retient la facture. On repose seulement la facture témoin dans son état
    // de départ, pour que la prochaine exécution parte du même point.
    await prisma.invoice.updateMany({
      where: { organizationId },
      data: { financedByPartnerId: null, financedAt: null },
    });
  });

  it("refuse le rachat d'une créance déjà encaissée, et laisse la facture intacte", async () => {
    const erreur = await service
      .chooseFinancing(factureEncaissee, dto, actorId, organizationId)
      .catch((e: unknown) => e);

    expect(erreur).toBeInstanceOf(PreconditionFailedException);
    expect((erreur as PreconditionFailedException).getStatus()).toBe(412);
    expect(((erreur as PreconditionFailedException).getResponse() as { code: string }).code).toBe(
      "FINANCING_INVOICE_ALREADY_SETTLED",
    );

    // Le refus ne vaut que s'il n'a rien écrit : c'est la ligne en base qui
    // fait foi, pas l'exception.
    const apres = await prisma.invoice.findUniqueOrThrow({ where: { id: factureEncaissee } });
    expect(apres.financedByPartnerId).toBeNull();
    expect(apres.financedAt).toBeNull();
  });

  it("refuse le rachat d'une créance sous litige actif, bien qu'elle soit émise et visée", async () => {
    const erreur = await service
      .chooseFinancing(factureEnLitige, dto, actorId, organizationId)
      .catch((e: unknown) => e);

    expect(erreur).toBeInstanceOf(PreconditionFailedException);
    expect(((erreur as PreconditionFailedException).getResponse() as { code: string }).code).toBe(
      "FINANCING_INVOICE_DISPUTED",
    );

    const apres = await prisma.invoice.findUniqueOrThrow({ where: { id: factureEnLitige } });
    expect(apres.financedByPartnerId).toBeNull();
  });

  it("ne propose aucun rail de financement sur une facture encaissée ou contestée", async () => {
    for (const invoiceId of [factureEncaissee, factureEnLitige]) {
      const options = await service.getFinancingOptions(invoiceId, organizationId);
      expect(options.financeable).toBe(false);
      expect(options.partners).toEqual([]);
    }
  });

  it("la clause `where` transactionnelle ne revendique AUCUNE ligne encaissée — la garde tient au niveau SQL", async () => {
    // C'est la garde qui protège réellement de la concurrence : si un règlement
    // tombe entre la lecture et le commit, c'est Postgres qui refuse, pas le
    // prédicat. On l'exerce ici directement, sans passer par le service.
    const revendique = await prisma.invoice.updateMany({
      where: { ...financeableInvoiceWhere(factureEncaissee), organizationId },
      data: { financedByPartnerId: partnerId, financedAt: new Date() },
    });
    expect(revendique.count).toBe(0);

    const enLitige = await prisma.invoice.updateMany({
      where: { ...financeableInvoiceWhere(factureEnLitige), organizationId },
      data: { financedByPartnerId: partnerId, financedAt: new Date() },
    });
    expect(enLitige.count).toBe(0);
  });

  it("laisse passer la créance légitime — le durcissement ne ferme pas le rail (témoin)", async () => {
    // Sans ce témoin, tous les tests ci-dessus passeraient encore si le
    // financement était cassé pour TOUT LE MONDE.
    const resultat = await service.chooseFinancing(factureCedable, dto, actorId, organizationId);
    expect(resultat.financedByPartnerId).toBe(partnerId);

    const apres = await prisma.invoice.findUniqueOrThrow({ where: { id: factureCedable } });
    expect(apres.financedByPartnerId).toBe(partnerId);
    expect(apres.financedAt).not.toBeNull();

    // Les montants restent des BigInt de bout en bout, jamais des Number : un
    // montant en GNF dépasse Number.MAX_SAFE_INTEGER bien avant d'être exotique.
    const trace = await prisma.invoiceEvent.findFirstOrThrow({
      where: { invoiceId: factureCedable, type: "financing_disbursed" },
    });
    expect(typeof trace.amount).toBe("bigint");
    expect(trace.amount).toBe(40_000_000n);
  });

  it("une fois cédée, la même créance ne peut plus l'être une seconde fois (K5)", async () => {
    // Enchaîne volontairement sur le témoin : la facture vient d'être cédée.
    await expect(
      service.chooseFinancing(factureCedable, dto, actorId, organizationId),
    ).rejects.toThrow();
  });
});

/** Réutilise la facture portant `numero` si elle existe, sinon la crée, et
 *  la remet dans l'état attendu par le test. Les factures ne sont jamais
 *  supprimées : dès qu'un événement s'y attache, le registre append-only
 *  (ADR-015) les rend indestructibles. */
async function remettreEnEtat(
  prisma: PrismaClient,
  organizationId: string,
  numero: string,
  data: Record<string, unknown>,
): Promise<string> {
  const existante = await prisma.invoice.findFirst({ where: { organizationId, number: numero } });
  if (existante) {
    await prisma.invoice.update({
      where: { id: existante.id },
      data: { ...data, financedByPartnerId: null, financedAt: null } as never,
    });
    return existante.id;
  }
  const creee = await prisma.invoice.create({ data: { ...data, number: numero } as never });
  return creee.id;
}
