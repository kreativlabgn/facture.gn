// Fixtures de validation E2E de l'étape 3 du runbook RLS
// (docs/runbooks/rls-rollout.md) — DÉVELOPPEMENT LOCAL UNIQUEMENT.
//
// Se connecte via DIRECT_URL, c'est-à-dire le rôle PROPRIÉTAIRE : les fixtures
// doivent pouvoir écrire dans les deux organisations à la fois, ce que le rôle
// applicatif `facture_app` ne peut plus faire depuis l'étape 3. C'est
// précisément ce qu'on cherche à démontrer ensuite côté HTTP.
//
// ── ÉCARTS AVEC LE SCHÉMA, corrigés ici ─────────────────────────────────────
// La version initiale de ce script visait un schéma différent. Sept points la
// rendaient inexécutable, tous vérifiés dans packages/db/prisma/schema.prisma :
//   1. User n'a ni `email` ni `password` → `name` + `passwordHash`. L'identité
//      de connexion est le msisdn (UserPhone), jamais un e-mail.
//   2. Le hachage est argon2id (auth/password.service.ts), pas bcrypt : un hash
//      bcrypt ne serait jamais vérifié au login.
//   3. Le login exige `^\+224\d{8,9}$` (auth/dto/login.dto.ts) : « 620000001 »
//      est rejeté à la validation, il faut « +224620000001 ».
//   4. UserPhone.verified → `verifiedAt: DateTime?`.
//   5. RegimeFiscal est un enum minuscule (normal_tva, tpu, …), pas
//      « REEL_SIMPLIFIE ».
//   6. Organization.legalForm est REQUIS et manquait.
//   7. Invoice : `number`, `totalTtc`, `status: "issued"` — pas
//      `invoiceNumber` / `totalAmountBps` / `"ISSUED"`. OrganizationRole est
//      minuscule (`owner`).

// PrismaClient vient de @facture-gn/db (qui reexporte @prisma/client) : c est
// la seule voie resolvable depuis apps/trust-api, comme dans tout le service.
import { PrismaClient } from "@facture-gn/db";
import * as argon2 from "argon2";

const MOT_DE_PASSE = "MotDePasseDev2026";
// UUID obligatoires : GET /invoices valide organizationId par z.string().uuid()
// (common/dto/organization-scoped-list-query.dto.ts). Des identifiants litteraux
// comme "org-1" passent en base (colonne texte) mais sont rejetes en 400 par
// l API — le decalage ne se verrait qu au premier appel HTTP.
const ORG_1 = "11111111-1111-4111-8111-111111111111";
const ORG_2 = "22222222-2222-4222-8222-222222222222";
const MSISDN_1 = "+224620000001";
const MSISDN_2 = "+224620000002";

async function run() {
  const url = process.env.DIRECT_URL;
  if (!url) {
    throw new Error("DIRECT_URL manquant — les fixtures doivent tourner avec le rôle propriétaire");
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  console.log("Initialisation des fixtures RLS…");

  // Purge d un eventuel passage anterieur avec des identifiants non-UUID.
  await prisma.invoice.deleteMany({ where: { organizationId: { in: ["org-1", "org-2"] } } });
  await prisma.organizationMember.deleteMany({ where: { organizationId: { in: ["org-1", "org-2"] } } });
  await prisma.organization.deleteMany({ where: { id: { in: ["org-1", "org-2"] } } });
  const passwordHash = await argon2.hash(MOT_DE_PASSE, { type: argon2.argon2id });

  await prisma.organization.upsert({
    where: { id: ORG_1 },
    update: { name: "Boutique Matam Standard" },
    create: {
      id: ORG_1,
      name: "Boutique Matam Standard",
      regimeFiscal: "normal_tva",
      legalForm: "commercial",
      nif: "111222333",
    },
  });

  await prisma.organization.upsert({
    where: { id: ORG_2 },
    update: { name: "Commerce Kaloum Distribution" },
    create: {
      id: ORG_2,
      name: "Commerce Kaloum Distribution",
      regimeFiscal: "tpu",
      legalForm: "commercial",
      nif: "444555666",
    },
  });

  // L'identité se résout par le TÉLÉPHONE : on part de UserPhone (unique) pour
  // retrouver ou créer le User, jamais d'un e-mail qui n'existe pas au schéma.
  async function marchand(msisdn: string, nom: string, organizationId: string) {
    const existant = await prisma.userPhone.findUnique({ where: { msisdn } });
    const user = existant
      ? await prisma.user.update({ where: { id: existant.userId }, data: { name: nom, passwordHash } })
      : await prisma.user.create({ data: { name: nom, passwordHash } });

    await prisma.userPhone.upsert({
      where: { msisdn },
      update: { userId: user.id, verifiedAt: new Date() },
      create: { msisdn, userId: user.id, isPrimary: true, verifiedAt: new Date() },
    });

    await prisma.organizationMember.upsert({
      where: { organizationId_userId: { organizationId, userId: user.id } },
      update: { role: "owner", revokedAt: null },
      create: { organizationId, userId: user.id, role: "owner" },
    });

    return user.id;
  }

  const u1 = await marchand(MSISDN_1, "Alpha Condé Marchand", ORG_1);
  const u2 = await marchand(MSISDN_2, "Ibrahima Diallo Marchand", ORG_2);

  await prisma.invoice.deleteMany({ where: { organizationId: { in: [ORG_1, ORG_2] } } });

  for (let i = 1; i <= 4; i++) {
    await prisma.invoice.create({
      data: {
        id: `inv-matam-${i}`,
        organizationId: ORG_1,
        number: `FG-2026-00000${i}`,
        status: "issued",
        documentType: "invoice",
        // Contrainte invoice_tax_invariant_check : totalHt + totalTva = totalTtc.
        totalHt: 127_119n,
        totalTva: 22_881n,
        totalTtc: 150_000n,
        amountDue: 150_000n,
        issuedAt: new Date(),
        previousHash: i === 1 ? "GENESIS" : `HASH_PREV_${i - 1}`,
      },
    });
  }

  for (let i = 5; i <= 6; i++) {
    await prisma.invoice.create({
      data: {
        id: `inv-kaloum-${i}`,
        organizationId: ORG_2,
        number: `FG-2026-00000${i}`,
        status: "issued",
        documentType: "invoice",
        // org-2 est au régime tpu : aucune TVA sur facture (C4, ADR-033).
        totalHt: 300_000n,
        totalTva: 0n,
        totalTtc: 300_000n,
        amountDue: 300_000n,
        issuedAt: new Date(),
        previousHash: i === 5 ? "GENESIS" : `HASH_PREV_${i - 1}`,
      },
    });
  }

  console.log(`  ${ORG_1} : 4 factures — marchand ${MSISDN_1} (user ${u1})`);
  console.log(`  ${ORG_2} : 2 factures — marchand ${MSISDN_2} (user ${u2})`);
  console.log("Fixtures prêtes.");
  await prisma.$disconnect();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
