import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getPrismaClient, type PrismaClient } from "@facture-gn/db";
import { PdpInvoiceService } from "./pdp-invoice.service";
import { buildPdpJobId, ETAX_INVOICING_UNITARY } from "./pdp.constants";
import type { CreatePdpInvoiceDto } from "./dto/create-pdp-invoice.dto";

// Test d'intégration RÉEL — nécessite un Postgres JOIGNABLE.
//
// ── CE QUE CE TEST PROUVE, ET QU'AUCUN TEST UNITAIRE NE PEUT PROUVER ──────────
// La collision d'idempotence est une COURSE : deux requêtes du même connecteur
// Odoo, poussées en parallèle, passent toutes deux la lecture d'idempotence
// (aucune ligne n'existe encore) puis tentent toutes deux l'insertion. Seule une
// vraie contrainte Postgres tranche. Un mock, lui, rendrait toujours l'ordre que
// le test a écrit.
//
// Et surtout : SOUS RLS FORCÉE, Prisma ne peut pas nommer la colonne en conflit.
// Postgres supprime le DETAIL « Key (...) already exists » quand le rôle courant
// n'a pas le droit de voir la ligne, et Prisma en dérive meta.target — privé de
// lui, il rend target: null. Une implémentation exigeant un tableau ne
// reconnaîtrait donc JAMAIS la collision en production, et chaque 200 idempotent
// retomberait en 500 opaque, alors que toute la suite unitaire resterait verte.
// C'est exactement la régression mesurée le 2026-09-07 (voir prisma-errors.ts).
//
// ── POURQUOI UNE SONDE, ET PAS `describe.runIf(Boolean(DATABASE_URL))` ───────
// La présence de DATABASE_URL ne dit RIEN de la joignabilité de la base :
// `packages/db/.env` la définit, et Prisma la charge dans process.env dès
// l'import de @facture-gn/db. La condition est donc TOUJOURS vraie, y compris
// sur un poste sans serveur — le beforeAll tente alors d'écrire, échoue, et
// Vitest marque les tests « skipped » tout en faisant échouer le fichier. C'est
// l'état dans lequel se trouve invoice-numbering.service.integration.spec.ts
// sur ce poste au 09/09/2026 (ni Postgres ni Docker Desktop, constat déjà porté
// par la migration device_enrollment / 20260907030000) : rouge en local, sans
// que rien ne dise pourquoi.
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

const CONNECTEUR_ODOO = "INV/2026/00042";

const DTO_B2B = {
  clientUniqueId: CONNECTEUR_ODOO,
  transactionType: "b2b",
  totalHT: BigInt(100_000_000),
  totalVAT: BigInt(18_000_000),
  issueDate: new Date("2026-09-09T10:00:00.000Z"),
  lines: [{ description: "Prestation", quantity: 2, unitPrice: BigInt(50_000_000) }],
} as unknown as CreatePdpInvoiceDto;

const PAYLOAD_BRUT = { clientUniqueId: CONNECTEUR_ODOO, source: "odoo-17", totalHT: "1000000" };

function compteur() {
  return { inc: vi.fn() };
}

describe("PdpInvoiceService — collision d'idempotence concurrentielle (Postgres réel)", () => {
  let prisma: PrismaClient;
  let queue: { add: ReturnType<typeof vi.fn> };
  let service: PdpInvoiceService;
  let organizationId: string;
  let autreOrganizationId: string;
  let apiKeyId: string;
  let autreApiKeyId: string;
  let userId: string;

  async function creerOrganisation(nom: string) {
    const org = await prisma.organization.create({
      data: {
        name: nom,
        regimeFiscal: "tpu",
        legalForm: "commercial",
        nif: `NIF-PDP-${randomUUID()}`,
        commercialTier: "enterprise",
      },
    });
    const cle = await prisma.apiKey.create({
      data: {
        organizationId: org.id,
        environment: "production",
        keyHash: `argon2id-factice-${randomUUID()}`,
        keySuffix: randomUUID().slice(-4),
        createdByUserId: userId,
      },
    });
    return { organizationId: org.id, apiKeyId: cle.id };
  }

  beforeAll(async () => {
    prisma = getPrismaClient();

    // La sonde. Un échec ici ne signifie PAS que le test échoue : il signifie
    // qu'il n'y a rien à tester sur cette machine. Le drapeau est lu par le
    // beforeEach ci-dessous, qui dérobe alors chaque test, et par le afterAll,
    // qui n'a rien à nettoyer.
    try {
      await prisma.$queryRaw`SELECT 1`;
      baseJoignable = true;
    } catch {
      return;
    }

    const user = await prisma.user.create({ data: { name: `Intégrateur PDP ${randomUUID()}` } });
    userId = user.id;

    ({ organizationId, apiKeyId } = await creerOrganisation("Cliente PDP SARL"));
    ({ organizationId: autreOrganizationId, apiKeyId: autreApiKeyId } =
      await creerOrganisation("Voisine PDP SARL"));

    queue = { add: vi.fn().mockResolvedValue({}) };
    service = new PdpInvoiceService(
      prisma,
      queue as never,
      compteur() as never,
      compteur() as never,
      compteur() as never,
    );
  });

  // Dérobe chaque test quand la base n'est pas joignable — la seule façon,
  // sous Vitest, de conditionner une suite à un état que seul un appel
  // asynchrone peut établir. `describe.runIf` serait évalué trop tôt (à la
  // collecte), et un `await` de plus haut niveau ne compile pas en CommonJS.
  beforeEach((contexte) => {
    if (!baseJoignable) {
      contexte.skip();
    }
  });

  afterAll(async () => {
    if (!baseJoignable) {
      return;
    }
    await prisma.pdpRawTransaction.deleteMany({
      where: { organizationId: { in: [organizationId, autreOrganizationId] } },
    });
    await prisma.apiKey.deleteMany({ where: { id: { in: [apiKeyId, autreApiKeyId] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [organizationId, autreOrganizationId] } } });
    await prisma.user.delete({ where: { id: userId } });
  });

  // LE test du cahier des charges. 20 requêtes simultanées portant le MÊME
  // clientUniqueId — la forme exacte d'un connecteur Odoo qui pousse son lot du
  // matin sur plusieurs connexions après un timeout réseau.
  it("20 dépôts concurrents du même clientUniqueId ne produisent qu'UNE ligne", async () => {
    const client = { organizationId, apiKeyId };

    const resultats = await Promise.all(
      Array.from({ length: 20 }, () => service.ingest(DTO_B2B, client, PAYLOAD_BRUT)),
    );

    // Aucune requête n'a échoué : la perdante de la course rend un 200
    // idempotent, jamais un 500.
    expect(resultats).toHaveLength(20);

    const lignes = await prisma.pdpRawTransaction.findMany({
      where: { organizationId, clientUniqueId: CONNECTEUR_ODOO },
    });
    expect(lignes).toHaveLength(1);

    // Toutes les réponses désignent la MÊME ligne : un connecteur qui rejoue
    // reçoit toujours le même identifiant de transaction, quelle que soit la
    // requête qui a gagné la course.
    expect(new Set(resultats.map((r) => r.transactionId))).toEqual(new Set([lignes[0].id]));

    // Exactement une acceptée, toutes les autres reconnues comme des rejeux.
    expect(resultats.filter((r) => r.outcome === "accepted")).toHaveLength(1);
    expect(resultats.filter((r) => r.outcome === "duplicate")).toHaveLength(19);
  });

  // Le corollaire opérationnel : la déduplication BullMQ repose sur un jobId
  // déterministe, dérivé de l'uuid de la ligne — donc identique pour les 20
  // requêtes. Le worker ne certifiera la facture qu'une fois.
  it("les 20 requêtes visent toutes le même jobId, sous le nom ETAX_INVOICING_UNITARY", async () => {
    const ligne = await prisma.pdpRawTransaction.findFirstOrThrow({
      where: { organizationId, clientUniqueId: CONNECTEUR_ODOO },
    });

    const jobIds = new Set(queue.add.mock.calls.map((appel) => appel[2].jobId));
    const noms = new Set(queue.add.mock.calls.map((appel) => appel[0]));

    expect(jobIds).toEqual(new Set([buildPdpJobId(ligne.id)]));
    expect(noms).toEqual(new Set([ETAX_INVOICING_UNITARY]));
    // Aucun jobId ne peut contenir « : » — BullMQ le rejetterait.
    expect([...jobIds].every((id) => !String(id).includes(":"))).toBe(true);
  });

  // L'idempotence est COMPOSITE. Un @unique seul sur client_unique_id
  // interdirait à deux PME d'utiliser la même numérotation ERP — le cas NORMAL.
  it("le même clientUniqueId chez une autre organisation crée bien une seconde ligne", async () => {
    const resultat = await service.ingest(
      DTO_B2B,
      { organizationId: autreOrganizationId, apiKeyId: autreApiKeyId },
      PAYLOAD_BRUT,
    );

    expect(resultat.outcome).toBe("accepted");

    const total = await prisma.pdpRawTransaction.count({ where: { clientUniqueId: CONNECTEUR_ODOO } });
    expect(total).toBe(2);
  });

  // Une fois le document certifié (ce que fera le worker), tout rejeu rend
  // immédiatement le reçu fiscal et son QR — 200 OK synchrone, sans nouveau job.
  it("un rejeu après certification rend le reçu et son QR, sans réenfiler", async () => {
    const certificationId = `GN-99999999-2026-${randomUUID().slice(0, 6).toUpperCase()}`;
    await prisma.pdpRawTransaction.updateMany({
      where: { organizationId, clientUniqueId: CONNECTEUR_ODOO },
      data: { status: "certified", certificationId, processedAt: new Date() },
    });
    queue.add.mockClear();

    const resultat = await service.ingest(DTO_B2B, { organizationId, apiKeyId }, PAYLOAD_BRUT);

    expect(resultat.outcome).toBe("duplicate");
    expect(resultat.status).toBe("certified");
    expect(resultat.receipt?.certificationId).toBe(certificationId);
    expect(resultat.receipt?.verificationUrl).toContain(certificationId);
    expect(resultat.receipt?.qrCode).toMatch(/^data:image\/png;base64,/);
    expect(queue.add).not.toHaveBeenCalled();
  });

  // ── Étanchéité sous la clause RLS ─────────────────────────────────────────
  // Le service ne lit JAMAIS hors de son scope : la ligne de la voisine existe
  // (le test précédent l'a créée) et porte le même clientUniqueId, mais un dépôt
  // scopé sur la première organisation ne peut ni la voir ni la rendre.
  it("ne rend jamais la ligne d'une autre organisation portant le même clientUniqueId", async () => {
    const chezLaVoisine = await prisma.pdpRawTransaction.findFirstOrThrow({
      where: { organizationId: autreOrganizationId, clientUniqueId: CONNECTEUR_ODOO },
    });

    const resultat = await service.ingest(DTO_B2B, { organizationId, apiKeyId }, PAYLOAD_BRUT);

    expect(resultat.transactionId).not.toBe(chezLaVoisine.id);
  });

  // Le corps ERP est archivé INTACT : c'est la pièce à produire si un client
  // conteste ce que son ERP a réellement envoyé.
  it("archive le corps ERP tel que reçu", async () => {
    const ligne = await prisma.pdpRawTransaction.findFirstOrThrow({
      where: { organizationId, clientUniqueId: CONNECTEUR_ODOO },
    });

    expect(ligne.payload).toEqual(PAYLOAD_BRUT);
  });

  // Les montants traversent la base en BigInt centimal, sans dérive.
  it("persiste les montants en centimes, TTC dérivé de HT + TVA", async () => {
    const ligne = await prisma.pdpRawTransaction.findFirstOrThrow({
      where: { organizationId, clientUniqueId: CONNECTEUR_ODOO },
    });

    expect(ligne.totalHtCentimes).toBe(BigInt(100_000_000));
    expect(ligne.totalVatCentimes).toBe(BigInt(18_000_000));
    expect(ligne.totalTtcCentimes).toBe(BigInt(118_000_000));
  });
});
