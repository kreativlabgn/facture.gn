import { z } from "zod";

// Commande de scan (POST /ai/ocr/scans). Ce que la PWA envoie APRÈS avoir
// déposé la photo dans le stockage objet : jamais les octets eux-mêmes.
//
// organizationId est ici LÉGITIMEMENT dans le corps : c'est une création sans
// params.id, RolesGuard le résout depuis le body et vérifie le membership de
// l'appelant AVANT le handler (même patron que POST /invoices, POST /branches).
// Le service, lui, ne lit que la valeur AUTORISÉE (@CurrentOrganizationId),
// jamais dto.organizationId.
export const scanDocumentSchema = z.object({
  organizationId: z.string().uuid(),
  // SHA-256 hex minuscule des octets de l'image, calculé par la PWA. Clé
  // d'idempotence du scan (@@unique([organizationId, imageSha256])) — même
  // statut déclaratif que clientUniqueId côté PDP : c'est l'appelant qui la
  // fournit, et la rejoue à l'identique s'il rejoue sa requête.
  imageSha256: z.string().regex(/^[0-9a-f]{64}$/, "SHA-256 hexadécimal (64 caractères minuscules) attendu"),
  storageKey: z.string().min(1).max(512),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
});

export type ScanDocumentDto = z.infer<typeof scanDocumentSchema>;

export const listScansQuerySchema = z.object({
  organizationId: z.string().uuid(),
  status: z.enum(["RECEIVED", "AUTO_INSERTED", "DRAFT_PENDING_MANUAL_REVIEW", "REJECTED"]).optional(),
});

export type ListScansQueryDto = z.infer<typeof listScansQuerySchema>;
