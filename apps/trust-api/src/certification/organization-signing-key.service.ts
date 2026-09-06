import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ed25519 } from "@noble/curves/ed25519";
import { bytesToHex } from "@noble/hashes/utils";
import type { OrganizationSigningKey, Prisma, PrismaClient } from "@facture-gn/db";
import { organizationScopedClient, setOrganizationScope } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { decryptPrivateKey, encryptPrivateKey } from "./envelope-encryption";
import {
  StubEd25519CertificationService,
  type CertifiablePayload,
  type CertificationResult,
} from "./certification.service";

// DAT §Crypto — "rotation 365j". Cible, matérialisée par l'indicateur
// rotationDue de getKeyStatus(). Auto-rotation = fast-follow (voir PLAN E3).
const ROTATION_INTERVAL_DAYS = 365;

export interface SigningKeyStatus {
  /** none = aucune clé courante ; active = clé courante utilisable ;
   *  revoked = clé courante révoquée mais pas encore remplacée (roter). */
  state: "none" | "active" | "revoked";
  active: boolean;
  publicKey: string | null;
  createdAt: Date | null;
  ageInDays: number | null;
  rotationDue: boolean;
  revokedAt: Date | null;
  retiredKeyCount: number;
}

/** Métadonnées publiques d'une clé — jamais encryptedPrivateKey. */
function publicView(key: OrganizationSigningKey): Pick<OrganizationSigningKey, "id" | "organizationId" | "publicKey" | "createdAt" | "retiredAt" | "revokedAt"> {
  return {
    id: key.id,
    organizationId: key.organizationId,
    publicKey: key.publicKey,
    createdAt: key.createdAt,
    retiredAt: key.retiredAt,
    revokedAt: key.revokedAt,
  };
}

// A3, ADR-026 — une clé racine Ed25519 par organisation, jamais en clair au
// repos (chiffrement enveloppe, envelope-encryption.ts).
// E3 (ADR-114) — N clés dans le temps, AU PLUS UNE active (retiredAt IS NULL AND
// revoked_at IS NULL — index unique partiel organization_signing_key_one_active_per_org).
// verifyWithKey() suit Invoice.signingKeyId (la clé EXACTE), jamais "la clé
// courante" : une facture déjà signée n'est jamais re-vérifiée différemment.
// RLS (ADR-111 étape 1) — CARTE DU SERVICE. `organization_signing_key` est sous
// org_isolation (colonne organization_id directe) et contient le secret le plus
// sensible du dépôt : la clé privée d'émission, chiffrée en enveloppe.
//
// Motif récurrent ici : plusieurs méthodes acceptent un `tx` optionnel.
// `client = tx ?? organizationScopedClient(...)` — quand l'appelant fournit sa
// transaction, on hérite de SA décision de scope, jamais on ne la contredit :
//   • InvoicesService.issue() pose déjà setOrganizationScope() sur sa transaction ;
//   • les trois créations d'organisation la laissent délibérément SANS GUC
//     (l'organisation naît dans cette transaction, son id n'existe pas avant).
// Poser un GUC ici écraserait ce choix et ferait échouer les créations.
//
// Reste GLOBAL : verifyWithKey() — voir son commentaire.
@Injectable()
export class OrganizationSigningKeyService {
  private readonly masterKey: Buffer;

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {
    const value = process.env.CERTIFICATION_MASTER_KEY;
    if (!value) {
      throw new Error(
        "CERTIFICATION_MASTER_KEY manquant — voir README pour générer le secret de chiffrement enveloppe",
      );
    }
    this.masterKey = Buffer.from(value, "hex");
  }

  async provisionRootKey(organizationId: string, tx?: Prisma.TransactionClient) {
    const privateKey = ed25519.utils.randomPrivateKey();
    const publicKey = bytesToHex(ed25519.getPublicKey(privateKey));
    const encryptedPrivateKey = encryptPrivateKey(privateKey, this.masterKey);

    // Sans transaction fournie, on scope ; avec, on hérite du scope (ou de son
    // absence délibérée) décidé par l'appelant — voir la carte en tête de classe.
    const client = tx ?? organizationScopedClient(this.prisma, organizationId);
    return client.organizationSigningKey.create({
      data: { organizationId, publicKey, encryptedPrivateKey },
    });
  }

  // E3 — rotation de la clé racine : retire la clé courante (retiredAt: null),
  // en provisionne une neuve. Transaction : retrait + création atomiques.
  // Le retrait est INCONDITIONNEL — une clé qu'on remplace est retirée, qu'elle
  // soit révoquée ou non ; poser retiredAt n'efface pas revokedAt (état
  // forensique (retiredAt, revokedAt) préservé). Garantit qu'il reste au plus
  // UNE ligne retiredAt: null par organisation → revoke()/getKeyStatus() sont
  // déterministes. Course concurrente → P2002 sur l'index partiel → 409.
  async rotate(organizationId: string): Promise<ReturnType<typeof publicView>> {
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        // GUC en première ligne : il couvre la lecture de la clé courante, son
        // retrait et la création de la neuve — provisionRootKey() reçoit ce même
        // tx et hérite donc du scope.
        await setOrganizationScope(tx, organizationId);

        const current = await tx.organizationSigningKey.findFirst({
          where: { organizationId, retiredAt: null },
          orderBy: { createdAt: "desc" },
        });
        if (current) {
          await tx.organizationSigningKey.update({
            where: { id: current.id },
            data: { retiredAt: new Date() },
          });
        }
        return this.provisionRootKey(organizationId, tx);
      });
      return publicView(created);
    } catch (error) {
      // P2002 ici ne peut venir que de l'index partiel "une seule active" :
      // la PK est un uuid, publicKey/encryptedPrivateKey ne sont pas uniques,
      // et rotate() n'écrit que dans cette table. Pas le helper
      // isUniqueConstraintViolation (il exige meta.target en tableau, non fourni
      // par Prisma pour un index partiel nommé hors schéma).
      if ((error as { code?: string }).code === "P2002") {
        throw new ConflictException(
          `Une rotation de la clé de signature de l'organisation ${organizationId} est déjà en cours`,
        );
      }
      throw error;
    }
  }

  async certifyForOrganization(
    organizationId: string,
    payload: CertifiablePayload,
    tx?: Prisma.TransactionClient,
  ): Promise<CertificationResult & { signingKeyId: string }> {
    // Lecture de la CLÉ PRIVÉE : le scope compte doublement ici. Même règle que
    // provisionRootKey() sur le `tx` fourni (voir la carte en tête de classe).
    const client = tx ?? organizationScopedClient(this.prisma, organizationId);
    // rotate() garantit ≤ 1 ligne retiredAt: null par org ; orderBy = filet.
    const key = await client.organizationSigningKey.findFirst({
      where: { organizationId, retiredAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (!key) {
      throw new ConflictException(
        `L'organisation ${organizationId} n'a aucune clé de signature active — une rotation est requise avant d'émettre`,
      );
    }
    // A4, ADR-025 — garde additive, jamais rétroactive : bloque uniquement de
    // NOUVELLES signatures, ne touche jamais verifyWithKey().
    if (key.revokedAt) {
      throw new ConflictException(
        `La clé de signature de l'organisation ${organizationId} a été révoquée le ${key.revokedAt.toISOString()} — aucune nouvelle facture ne peut être émise`,
      );
    }
    const service = this.buildServiceFromEncryptedKey(key.encryptedPrivateKey);

    return { ...service.certify(payload), signingKeyId: key.id };
  }

  // A4, ADR-025 — self-service owner/admin. Révoque la clé COURANTE (retiredAt: null,
  // déterministe car rotate() retire toujours la sortante). Cas courant : "ma
  // clé courante a fuité". Idempotent : ne réécrit jamais revokedAt.
  // Métadonnées publiques uniquement — jamais encryptedPrivateKey dans la réponse.
  async revoke(organizationId: string): Promise<ReturnType<typeof publicView>> {
    const scoped = organizationScopedClient(this.prisma, organizationId);
    const key = await scoped.organizationSigningKey.findFirst({
      where: { organizationId, retiredAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (!key) {
      throw new NotFoundException(
        `L'organisation ${organizationId} n'a aucune clé de signature courante à révoquer`,
      );
    }
    if (key.revokedAt) {
      return publicView(key);
    }

    // `update` exige un `where` unique et ne peut pas porter la colonne de
    // scope : la lecture scopée ci-dessus est la barrière.
    const updated = await scoped.organizationSigningKey.update({
      where: { id: key.id },
      data: { revokedAt: new Date() },
    });
    return publicView(updated);
  }

  // A4, ADR-025 — revokedAt inclus dans le résultat (jamais un second lookup) :
  // verifyWithKey() a déjà la ligne OrganizationSigningKey en main.
  //
  // RLS — RESTE GLOBAL, à dessein. Cette méthode sert le point d'entrée PUBLIC de
  // vérification (VerificationService) : n'importe qui peut vérifier une facture
  // certifiée sans appartenir à l'organisation émettrice, c'est tout l'objet du
  // dispositif. La scoper la rendrait inutilisable pour un tiers vérificateur.
  // Pas d'oracle non plus malgré le *OrThrow : `signingKeyId` n'est jamais fourni
  // par l'appelant — il vient de `Invoice.signingKeyId` (clé étrangère d'une
  // facture déjà lue), et le cas null est traité par la branche « clé légataire »
  // du service appelant.
  async verifyWithKey(
    signingKeyId: string,
    payload: CertifiablePayload,
  ): Promise<CertificationResult & { revokedAt: Date | null }> {
    const key = await this.prisma.organizationSigningKey.findUniqueOrThrow({ where: { id: signingKeyId } });
    const service = this.buildServiceFromEncryptedKey(key.encryptedPrivateKey);

    return { ...service.certify(payload), revokedAt: key.revokedAt };
  }

  // E3 — état de la clé courante pour l'UI (indicateur "rotation due").
  async getKeyStatus(organizationId: string): Promise<SigningKeyStatus> {
    const scoped = organizationScopedClient(this.prisma, organizationId);
    const [current, retiredKeyCount] = await Promise.all([
      scoped.organizationSigningKey.findFirst({
        where: { organizationId, retiredAt: null },
        orderBy: { createdAt: "desc" },
      }),
      scoped.organizationSigningKey.count({ where: { organizationId, retiredAt: { not: null } } }),
    ]);

    if (!current) {
      return {
        state: "none",
        active: false,
        publicKey: null,
        createdAt: null,
        ageInDays: null,
        rotationDue: false,
        revokedAt: null,
        retiredKeyCount,
      };
    }

    const ageInDays = Math.floor((Date.now() - current.createdAt.getTime()) / (24 * 3600_000));
    const revoked = current.revokedAt !== null;
    return {
      state: revoked ? "revoked" : "active",
      active: !revoked,
      publicKey: current.publicKey,
      createdAt: current.createdAt,
      ageInDays,
      // Une clé courante révoquée DOIT être remplacée → rotationDue vrai quel que
      // soit son âge, pour que l'UI pilote son CTA dessus.
      rotationDue: revoked || ageInDays >= ROTATION_INTERVAL_DAYS,
      revokedAt: current.revokedAt,
      retiredKeyCount,
    };
  }

  private buildServiceFromEncryptedKey(encryptedPrivateKey: string): StubEd25519CertificationService {
    const privateKey = decryptPrivateKey(encryptedPrivateKey, this.masterKey);
    return new StubEd25519CertificationService(privateKey);
  }
}
