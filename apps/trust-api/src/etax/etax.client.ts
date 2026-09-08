import { createHmac } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { ETAX_REQUEST_TIMEOUT_MS } from "./etax.constants";
import type { EtaxDeclarationPayload } from "./etax-declaration";
import type { EtaxInvoicePayload } from "./etax-invoice";

export interface EtaxSubmissionResult {
  /** Référence d'acquittement rendue par eTax — la preuve de dépôt. */
  submissionRef: string;
}

/** Refus DÉFINITIF du guichet : le payload est invalide, le rejouer à
 *  l'identique le sera tout autant. Distinguée d'une panne passagère pour que
 *  l'appelant arrête le backoff au lieu de marteler la DGI pendant deux heures
 *  avec la même facture rejetée. */
export class EtaxRejetDefinitif extends Error {
  constructor(readonly status: number) {
    super(`eTax a rejeté définitivement (${status})`);
    this.name = "EtaxRejetDefinitif";
  }
}

// Chantier 5, étape 3 — appel sortant vers le guichet eTax de la DGI.
//
// CONTRASTE DÉLIBÉRÉ AVEC PaymentLinkClient. Celui-là n'échoue JAMAIS : un lien
// de paiement manquant ne doit pas faire échouer l'émission d'une facture, donc
// il rend null et journalise. Ici c'est l'inverse — ce client DOIT lever. C'est
// l'exception qui fait rejouer le job BullMQ ; l'avaler transformerait chaque
// panne d'eTax en déclaration silencieusement perdue, en marquant le job
// « completed ».
@Injectable()
export class EtaxClient {
  private readonly logger = new Logger(EtaxClient.name);

  async submit(payload: EtaxDeclarationPayload): Promise<EtaxSubmissionResult> {
    const baseUrl = process.env.ETAX_API_URL;
    const apiKey = process.env.ETAX_API_KEY;
    if (!baseUrl || !apiKey) {
      // Lève, jamais un retour null : sans configuration il n'y a pas eu de
      // déclaration, et le job ne doit surtout pas se dire réussi.
      throw new Error("ETAX_API_URL / ETAX_API_KEY non configurés — déclaration non transmise");
    }

    const corps = JSON.stringify(payload);

    // Signature HMAC du corps EXACT transmis, jamais d'une reconstruction : le
    // guichet doit pouvoir vérifier l'octet près. Même posture que le webhook
    // APIP entrant (ADR-082), dans l'autre sens.
    const signature = createHmac("sha256", apiKey).update(corps).digest("hex");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ETAX_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${baseUrl}/declarations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Etax-Signature": signature,
          // Clé d'idempotence côté guichet : un réessai après acquittement perdu
          // porte le même sceau, eTax peut donc reconnaître le doublon plutôt
          // que d'enregistrer deux déclarations pour le même exercice.
          "X-Idempotency-Key": payload.sealHash,
        },
        body: corps,
        signal: controller.signal,
      });

      if (!response.ok) {
        // LE CORPS DE LA RÉPONSE N'EST NI JOURNALISÉ NI REMONTÉ. Un guichet
        // qui rejette une déclaration en renvoie typiquement l'écho — donc le
        // numéro eTax et les montants de la PME. Or `*.nif`, `*.etaxNumber` et
        // `*.bankAccountDetails` sont des chemins RÉDIGÉS (logging.config.ts),
        // et la rédaction pino porte sur des propriétés d'objet : elle ne voit
        // rien de ce qu'on interpole dans une chaîne de message. Recopier le
        // corps ici contournerait donc silencieusement toute la politique.
        //
        // Le statut, l'exercice et l'organisation suffisent à diagnostiquer ;
        // le détail se lit côté eTax, qui a le droit d'en connaître le contenu.
        this.logger.warn(
          `eTax a rejeté (${response.status}) l'exercice ${payload.year} de l'organisation ${payload.organizationId}`,
        );
        throw new Error(`eTax a répondu ${response.status}`);
      }

      const data = (await response.json()) as { submissionRef?: string };
      if (!data.submissionRef) {
        // Un 200 sans référence n'est pas un acquittement exploitable : sans
        // preuve de dépôt, on ne peut pas marquer la clôture comme transmise.
        throw new Error("eTax a acquitté sans référence de dépôt");
      }
      return { submissionRef: data.submissionRef };
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Transmission unitaire (LFI 2025) ──────────────────────────────────────
  //
  // Même guichet, autre point d'entrée. Deux différences assumées avec submit() :
  //
  //   • la clé d'idempotence est le HASH DE CERTIFICATION de la facture, pas le
  //     sceau d'un exercice — deux transmissions de la même facture le portent
  //     forcément à l'identique, et le guichet peut donc reconnaître le doublon ;
  //
  //   • un 4xx lève EtaxRejetDefinitif. Un exercice rejeté vaut la peine d'être
  //     rejoué (le guichet peut être en train de basculer une version) ; une
  //     facture rejetée pour payload invalide le sera toujours, et s'acharner
  //     bloquerait la file derrière des milliers de factures par jour.
  async submitInvoice(payload: EtaxInvoicePayload): Promise<EtaxSubmissionResult> {
    const baseUrl = process.env.ETAX_API_URL;
    const apiKey = process.env.ETAX_API_KEY;
    if (!baseUrl || !apiKey) {
      throw new Error("ETAX_API_URL / ETAX_API_KEY non configurés — facture non transmise");
    }

    const corps = JSON.stringify(payload);
    const signature = createHmac("sha256", apiKey).update(corps).digest("hex");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ETAX_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${baseUrl}/invoices`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Etax-Signature": signature,
          "X-Idempotency-Key": payload.hash,
        },
        body: corps,
        signal: controller.signal,
      });

      if (!response.ok) {
        // NI LE CORPS NI LES IDENTIFIANTS FISCAUX ne sont journalisés — un
        // guichet qui rejette renvoie typiquement l'écho du payload, donc le
        // numéro eTax et les montants. La rédaction pino (logging.config.ts)
        // porte sur des propriétés d'objet : elle ne voit rien de ce qu'on
        // interpole dans une chaîne. L'identifiant interne de la facture suffit
        // à diagnostiquer, et il ne dit rien à qui lit le journal.
        this.logger.warn(
          `eTax a rejeté (${response.status}) la facture ${payload.invoiceId} de l'organisation ${payload.organizationId}`,
        );
        // 4xx = le payload est en cause. 429 excepté : c'est un « revenez plus
        // tard », pas un refus — le rejouer est exactement ce qu'il demande.
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          throw new EtaxRejetDefinitif(response.status);
        }
        throw new Error(`eTax a répondu ${response.status}`);
      }

      const data = (await response.json()) as { receiptNumber?: string; submissionRef?: string };
      // Le guichet nomme « receiptNumber » le reçu unitaire et « submissionRef »
      // l'acquittement d'une déclaration. On accepte les deux plutôt que de
      // parier sur un seul : un acquittement perdu faute d'un nom de champ
      // ferait retransmettre une facture que la DGI a déjà enregistrée.
      const reference = data.receiptNumber ?? data.submissionRef;
      if (!reference) {
        throw new Error("eTax a acquitté sans numéro de reçu");
      }
      return { submissionRef: reference };
    } finally {
      clearTimeout(timer);
    }
  }
}
