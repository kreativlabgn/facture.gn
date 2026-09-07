import { z } from "zod";

// Modification de l'identité légale d'une organisation.
//
// PREMIÈRE ROUTE @Patch DU SERVICE — jusqu'ici tout était @Get/@Post, le @Post
// servant des transitions d'état nommées (/verify-dgi, /commercial-tier). Une
// fiche d'identité n'est pas une transition : ses champs se corrigent, d'où le
// verbe.
//
// TOUS LES CHAMPS SONT OPTIONNELS mais au moins un est exigé : un PATCH vide
// n'est pas une modification, c'est une requête sans objet — et il traverserait
// silencieusement toute la validation.
//
// Ce qui N'EST PAS modifiable ici, à dessein :
//   • commercialTier   → POST /organizations/:id/commercial-tier
//   • dgiVerificationStatus → jamais par l'organisation elle-même (B2, elle ne
//     peut pas s'auto-certifier vérifiée)
//   • accountCode, registrationSource → posés à la création, jamais corrigés
export const updateOrganizationSchema = z
  .object({
    name: z.string().min(1).optional(),
    regimeFiscal: z.enum(["normal_tva", "tpu", "normal_sans_tva", "non_assujetti_association"]).optional(),
    legalForm: z.enum(["commercial", "association"]).optional(),
    // `null` explicite = effacer le champ, distinct de `undefined` = ne pas y
    // toucher. Sans cette distinction, on ne pourrait jamais retirer un NIF
    // saisi par erreur.
    nif: z.string().min(1).nullable().optional(),
    etaxNumber: z.string().min(1).nullable().optional(),
    rccm: z.string().min(1).nullable().optional(),
  })
  .refine((data) => Object.values(data).some((valeur) => valeur !== undefined), {
    message: "Aucun champ à modifier",
  })
  // ADR-035 — NIF et eTax vont par paire. On ne contrôle la règle que si l'un
  // des deux est touché : un PATCH qui ne concerne que le nom n'a pas à
  // connaître l'état fiscal courant.
  .refine(
    (data) =>
      (data.nif === undefined && data.etaxNumber === undefined) ||
      (data.nif !== undefined && data.etaxNumber !== undefined),
    {
      message: "NIF et eTax se modifient ensemble (ADR-035) — les deux ou aucun des deux",
      path: ["nif"],
    },
  );

export type UpdateOrganizationDto = z.infer<typeof updateOrganizationSchema>;
