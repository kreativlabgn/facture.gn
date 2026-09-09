import { z } from "zod";
import { msisdnSchema } from "../../auth/dto/register.dto";

// ADR-106 — vente au comptoir : le commerçant n'a que le numéro de son client.
//
// `phone` réutilise msisdnSchema (et non un regex recopié) : le format accepté
// par cette route doit être EXACTEMENT celui que Customer.phone accepte
// ailleurs, sans quoi un numéro passerait ici et serait refusé à la création
// d'un client complet. La normalisation du 9-chiffres guinéen (622000000 →
// +224622000000) appartient à l'appelant — la couper en deux, avec un serveur
// tolérant et un client normalisateur, laisserait entrer deux écritures
// différentes du même numéro et ruinerait le dédoublonnage.
export const resolveCustomerByPhoneSchema = z.object({
  organizationId: z.string().uuid(),
  phone: msisdnSchema,
});

export type ResolveCustomerByPhoneDto = z.infer<typeof resolveCustomerByPhoneSchema>;
