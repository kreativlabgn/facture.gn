# Plan : Option 3 USSD — Mes factures

**Statut : plan seul, en attente de validation — aucun code écrit.**

## Contexte facture.gn
- Module : Trust Context (`apps/trust-api/src/ussd/`).
- Persona affecté : marchand authentifié consultant ses factures récentes.

## Investigation préalable

§2.3 Spec USSD : « Statuts affichés : Payée (paid), Non payée (issued), Partiel (partially_paid), Annulée (voided). Les proformas et devis ne sont pas affichés dans ce canal. »

`InvoicesService.findAllByOrganization()` existant ne filtre ni par `documentType` ni par statut (retourne aussi drafts/proformas/devis) — inadapté tel quel. Nouvelle requête dédiée plutôt qu'une modification de cette méthode partagée (utilisée par le dashboard PWA, où proformas/devis doivent au contraire apparaître — modifier son filtre y introduirait une régression).

## Décision d'architecture

**`UssdInvoiceListService`** (`ussd/ussd-invoice-list.service.ts`) : `listRecent(organizationId)` → `Invoice.findMany({organizationId, documentType: "invoice", status: {in: ["issued","partially_paid","paid","voided"]}}, orderBy: issuedAt desc, take: 5)`. `take: 5` — un écran USSD ne peut pas afficher une liste longue, cohérent avec la contrainte de canal texte déjà actée (§6 : "canal texte contraint").

**Câblage** : `completeAuthentication` branche `pendingOption === "3"` vers un affichage direct (lecture seule, un seul écran, `continue: false`) — pas de sous-état supplémentaire nécessaire, contrairement aux options 1/4 qui collectent des entrées.

## Alternatives écartées

**Paginer au-delà de 5** — écartée, aucun signal backlog, et une pagination USSD (page suivante) ajouterait un état supplémentaire pour un besoin non exprimé.

## Découpage en tâches bite-sized
- [ ] Tâche 1 (RED) : `ussd-invoice-list.service.spec.ts` — filtre documentType/status, limite à 5, ordre décroissant
- [ ] Tâche 2 (GREEN) : `UssdInvoiceListService`
- [ ] Tâche 3 (RED) : `ussd-session.service.spec.ts` — option 3 affiche la liste avec labels français ; liste vide → message explicite
- [ ] Tâche 4 (GREEN) : câblage

## Critères de done
- Suite trust-api verte, typecheck/lint verts
- Aucun proforma/devis/draft n'apparaît jamais dans la liste

## Risques identifiés & mitigations
- Aucun — lecture seule, aucune mutation.
