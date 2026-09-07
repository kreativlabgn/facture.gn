import { z } from "zod";

// Enrôlement présenté par le TERMINAL lui-même. Aucune session : le jeton est
// l'unique identité de l'appelant.
export const enrollDeviceSchema = z.object({
  enrollmentToken: z.string().min(1, "jeton requis"),
  // IMEI (15 chiffres) ou numéro de série constructeur — format volontairement
  // large, les deux coexistent selon le matériel.
  imeiOrSerial: z.string().trim().min(6, "numéro de série trop court").max(64),
  // Clé PUBLIQUE de l'enclave, en hexadécimal. La clé privée ne quitte jamais
  // le terminal : la recevoir ici serait une faute de conception.
  publicKey: z.string().regex(/^[0-9a-f]{64,}$/i, "clé publique attendue en hexadécimal"),
});

export type EnrollDeviceDto = z.infer<typeof enrollDeviceSchema>;
