import { z } from "zod";

// Commande de note vocale (POST /ai/ocr/audio-notes, plan 2026-09-16, OCR
// multicanal). Même patron exact que scanDocumentSchema : ce que la PWA
// envoie APRÈS avoir déposé l'audio dans le stockage objet — jamais les
// octets eux-mêmes.
//
// organizationId est ici LÉGITIMEMENT dans le corps, même raisonnement que
// scanDocumentSchema : c'est une création sans params.id, RolesGuard le
// résout depuis le body et vérifie le membership de l'appelant AVANT le
// handler. Le service, lui, ne lit que la valeur AUTORISÉE
// (@CurrentOrganizationId), jamais dto.organizationId.
export const scanAudioSchema = z.object({
  organizationId: z.string().uuid(),
  // SHA-256 hex minuscule des octets audio, calculé par la PWA. Clé
  // d'idempotence (@@unique([organizationId, audioSha256])) — même statut
  // déclaratif qu'imageSha256 côté scan photo.
  audioSha256: z.string().regex(/^[0-9a-f]{64}$/, "SHA-256 hexadécimal (64 caractères minuscules) attendu"),
  storageKey: z.string().min(1).max(512),
  // Formats attendus d'un enregistrement micro navigateur/PWA — jamais une
  // image ni une vidéo : un mimeType hors liste est refusé ici, avant que le
  // job ne soit enfilé.
  mimeType: z.enum(["audio/ogg", "audio/mpeg", "audio/mp4", "audio/webm"]),
});

export type ScanAudioDto = z.infer<typeof scanAudioSchema>;
