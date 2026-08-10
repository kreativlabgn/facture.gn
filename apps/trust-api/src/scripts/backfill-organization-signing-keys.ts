import { PrismaClient } from "@facture-gn/db";
import { ed25519 } from "@noble/curves/ed25519";
import { bytesToHex } from "@noble/hashes/utils";
import { encryptPrivateKey } from "../certification/envelope-encryption";

// A3, ADR-026 — script one-shot : provisionne une clé racine Ed25519 pour
// toute organisation qui n'en a pas encore (créées avant cette story — les 3
// chemins de création provisionnent désormais une clé directement, voir
// organizations.service.ts). N'affecte JAMAIS une facture déjà signée
// (Invoice.signingKeyId reste null pour toutes les factures existantes, elles
// restent vérifiables via la clé globale légataire, voir certification.module.ts).
// Exécution manuelle unique : npx tsx src/scripts/backfill-organization-signing-keys.ts
async function main() {
  const masterKeyHex = process.env.CERTIFICATION_MASTER_KEY;
  if (!masterKeyHex) {
    throw new Error(
      "CERTIFICATION_MASTER_KEY manquant — voir README pour générer le secret de chiffrement enveloppe",
    );
  }
  const masterKey = Buffer.from(masterKeyHex, "hex");

  const prisma = new PrismaClient();
  try {
    const organizationsWithoutKey = await prisma.organization.findMany({
      where: { signingKey: null },
      select: { id: true, name: true },
    });

    console.log(`${organizationsWithoutKey.length} organisation(s) sans clé racine trouvée(s).`);

    for (const organization of organizationsWithoutKey) {
      const privateKey = ed25519.utils.randomPrivateKey();
      const publicKey = bytesToHex(ed25519.getPublicKey(privateKey));
      const encryptedPrivateKey = encryptPrivateKey(privateKey, masterKey);

      await prisma.organizationSigningKey.create({
        data: { organizationId: organization.id, publicKey, encryptedPrivateKey },
      });
      console.log(`  provisionnée : ${organization.name} (${organization.id})`);
    }

    console.log("Backfill terminé.");
  } finally {
    await prisma.$disconnect();
  }
}

// Garde d'entrée : ce script gère de la génération de clé cryptographique,
// jamais un effet de bord acceptable au simple import (ex. IDE auto-import
// accidentel) — n'exécute main() QUE si ce fichier est lancé directement
// (node dist/scripts/...), jamais depuis un require()/import() indirect.
if (require.main === module) {
  main().catch((error) => {
    console.error("Échec du backfill :", error);
    process.exit(1);
  });
}
