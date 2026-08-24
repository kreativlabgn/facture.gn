import { z } from "zod";

// Format Guinée E.164 : +224 suivi de 8 ou 9 chiffres (ADR-087, USER_PHONE).
// Exporté — réutilisé par tout DTO qui accepte un msisdn (ex. request-recovery.dto.ts, B3).
export const msisdnSchema = z.string().regex(/^\+224\d{8,9}$/, "msisdn attendu au format +224XXXXXXXXX");

// Cross-Story Audit 2026-08-24, finding #2 — optionnel au niveau du schéma :
// requis seulement quand msisdn correspond à un compte fantôme F13
// (User.passwordHash null) déjà existant, une condition que le DTO seul ne
// peut pas connaître (dépend d'une lecture DB). AuthService.register() exige
// et vérifie explicitement ce champ dans ce cas précis (voir son commentaire),
// via ClientPortalOtpService (même mécanisme que ClientPortalAuthService.verifyOtp()).
// Format validé ici (4 chiffres, ADR-108) quand le champ est présent.
export const registerSchema = z.object({
  name: z.string().min(1),
  msisdn: msisdnSchema,
  password: z.string().min(8),
  otpCode: z.string().regex(/^\d{4}$/, "otpCode attendu au format 4 chiffres").optional(),
});

export type RegisterDto = z.infer<typeof registerSchema>;
