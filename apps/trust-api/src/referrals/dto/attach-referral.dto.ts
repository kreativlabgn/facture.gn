import { z } from "zod";

// Rattachement d'un filleul à un parrain. Le code est en Base32 (A-Z2-7),
// six caractères — normalisé en majuscules à la saisie : personne ne tape un
// code dicté au téléphone en respectant la casse.
export const attachReferralSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z2-7]{6}$/, "code de parrainage attendu : 6 caractères (A-Z, 2-7)"),
});

export type AttachReferralDto = z.infer<typeof attachReferralSchema>;
