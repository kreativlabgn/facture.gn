import { z } from "zod";
import { msisdnSchema } from "./register.dto";

// password (re-confirmation, revue sécurité B6) : un JWT valide seul ne prouve
// qu'une session active, pas une intention fraîche pour une action qui modifie
// durablement les moyens d'accès au compte — un JWT volé sans le mot de passe ne
// doit jamais suffire à planter un numéro persistant sur le compte de la victime.
export const addPhoneSchema = z.object({
  msisdn: msisdnSchema,
  password: z.string().min(1),
});

export type AddPhoneDto = z.infer<typeof addPhoneSchema>;
