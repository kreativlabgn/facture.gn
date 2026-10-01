import { z } from "zod";

// Édition d'une fiche produit/service (catalogue, 2026-09-16) — mécanisme et
// convention identiques à updateOrganizationSchema
// (apps/trust-api/src/organizations/dto/update-organization.dto.ts) : `null`
// explicite = effacer le champ, distinct de `undefined`/absent = ne pas y
// toucher. `salePrice: null` fait redevenir un produit "sur devis".
//
// TOUS LES CHAMPS SONT OPTIONNELS mais au moins un est exigé : un PATCH vide
// n'est pas une modification, c'est une requête sans objet.
//
// Ce qui N'EST PAS modifiable ici, à dessein :
//   • costPrice → POST /products/:id/cost-price (setCostPrice), territoire
//     E6/ADR-084 à part, jamais fusionné même si l'écran web présente les
//     deux dans un seul formulaire visuel (deux appels API).
//   • type → ABSENT ICI À DESSEIN. Immuable après création : un produit déjà
//     lié à ProductStock/InvoiceLine.productId ne doit jamais changer de
//     nature. Le mécanisme est structurel, pas un `if` de garde — Zod ignore
//     silencieusement une clé "type" présente dans le corps JSON (comportement
//     par défaut de z.object() sans .strict()), et UpdateProductDto (le type
//     TypeScript inféré) n'a pas de propriété `type` : ProductsService.update()
//     ne peut donc pas la transmettre à Prisma, même par erreur future. Voir
//     docs/plans/2026-09-16-catalogue-produits-services.md §3.
export const updateProductSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).max(500).nullable().optional(),
    salePrice: z.coerce.bigint().nonnegative().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.values(data).some((valeur) => valeur !== undefined), {
    message: "Aucun champ à modifier",
  });

export type UpdateProductDto = z.infer<typeof updateProductSchema>;
