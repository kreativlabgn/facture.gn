# Plan : Lot i18n — infrastructure de traduction + notifications sortantes (Vague 3, F2)

## Contexte projet
- **Module** : Trust Context (notifications, USSD, client-portal, invitations). Nouveau sous-module `apps/trust-api/src/i18n/`.
- **Persona affecté** : tout destinataire d'un SMS/WhatsApp facture.gn — client d'une PME, membre invité, utilisateur USSD. Observable côté utilisateur (le texte reçu change de langue).
- **Données sensibles** : le code OTP transite dans une chaîne traduite (déjà le cas). Aucune nouvelle donnée sensible. `dev-security-reviewer` léger (fuite via catalogue, injection de params).
- **Impact réglementaire** : **ADR-051** (« Canal vocal priorisé sur la traduction USSD texte », 68 % analphabétisme) → ce lot ne touche PAS le texte des menus USSD ni le PDF (document légal, OHADA/français officiel). Il se limite au **texte sortant SMS/WhatsApp**, où un destinataire lettré non francophone existe.

## Clarifications
- **Q : Périmètre ?** → R : **les 5 chaînes SMS/WhatsApp sortantes** — lien de paiement, rappel de facture, code OTP portail client, PIN modifié, invitation membre.
- **Q : Source de la langue ?** → R : `Organization.preferredLanguage` pour le client-facing (lien, rappel, OTP, invite org) ; `User.preferredLanguage` pour « PIN modifié » (destinataire authentifié). `malinke`/`soussou`/absent → fallback `fr`.
- **Q : Contenu pular ?** → R : **stub `pular` + fallback `fr` runtime + gate de validation**. Mécanisme livré, `fr` complet, `pular` = fichier avec chaînes marquées « À VALIDER » (ou absentes) qui retombent sur `fr`. `preferredLanguage` est enfin lu. Un locuteur natif valide avant activation réelle de `pular`.
- **Q (planning) : OTP portail client sans contexte d'organisation ?** → R : `ClientPortalOtpService.request(msisdn)` ne connaît que le msisdn. Heuristique : `customer.findMany({ where: { phone: msisdn } })` → si toutes les orgs rattachées ont la même `preferredLanguage`, l'utiliser ; sinon `fr`. Jamais bloquant.
- **Q (planning) : invitation practice (cabinet) ?** → R : `ProfessionalPractice` n'a pas de `preferredLanguage` → invitation practice reste `fr`. Seules les invitations `organizationId` résolvent une langue.

## Problème (3 lignes)
`PreferredLanguage` (fr/pular/malinke/soussou) est stocké sur `User` **et** `Organization` (défaut `fr`) mais **lu nulle part** — 100 % du texte sortant est du français codé en dur dans 5 services. Aucune infrastructure de traduction n'existe. ADR-051 priorise la voix sur la traduction USSD, mais le SMS/WhatsApp vers un client lettré non francophone reste un angle mort d'inclusion.

## Solution retenue (5 lignes)
Nouveau `apps/trust-api/src/i18n/` — **fonctions pures, pas de module NestJS** (comme `money-format.ts`, `legal-mentions.ts`) : `type Locale = "fr" | "pular"` ; `resolveLocale(preferred)` mappe l'enum Prisma → `Locale` (fallback `fr`) ; `messages.fr.ts` = catalogue typé de fonctions `(params) => string` ; `messages.pular.ts` = `Partial<typeof fr>` (stub) ; `t(key, locale, params)` = `(messages[locale][key] ?? fr[key])(params)`. Les 5 services gagnent un paramètre `locale: Locale`, les call-sites chargent `preferredLanguage` et appellent `resolveLocale`. Le **formatage des nombres/montants n'est PAS localisé** (GNF, séparateur espace, `fr-FR` — la Guinée a le français comme langue officielle) — décision documentée.

## Alternatives écartées
- **Lib i18n (`i18next`, `formatjs`)** : surdimensionné pour 5 clés × 2 langues, aucune lib i18n dans le repo, ICU inutile ici. Le catalogue typé de fonctions donne l'auto-complétion + le check de params par `tsc`.
- **Chaînes ICU + interpolateur maison** : moins sûr que des fonctions typées (params non vérifiés).
- **Traduire aussi le texte USSD** : contredit ADR-051 (voix > texte USSD). Hors périmètre.
- **Traduire le PDF** : document légal, mentions OHADA en français officiel. `legal-mentions.ts` reste `fr`, commentaire ajouté.
- **`i18n.module.ts` avec DI** : inutile — fonctions pures, importées directement.
- **Ajouter `Customer.preferredLanguage`** : plus fin mais = migration + UI de saisie (hors scope web). L'organisation émettrice choisit la langue de ses clients pour ce lot.

## Découpage en tâches

### Groupe 1 — infrastructure i18n (livrable seul, inerte)
- [ ] 1.1 `apps/trust-api/src/i18n/locale.ts` — `export type Locale = "fr" | "pular"` ; `SUPPORTED_LOCALES` ; `resolveLocale(preferred: PreferredLanguage | null | undefined): Locale` (`pular` → `pular` ; `fr`/`malinke`/`soussou`/`null`/`undefined` → `fr`). En-tête : pourquoi seulement fr+pular actifs (roadmap F2 + ADR-051).
- [ ] 1.2 `apps/trust-api/src/i18n/messages.ts` — `MessageKey` union + `type MessageCatalog = Record<MessageKey, (params: never) => string>` avec params typés par clé (`MessagesParams` map). 5 clés : `notification.paymentLinkReady`, `notification.paymentReminder`, `notification.clientPortalOtp`, `notification.pinChanged`, `notification.memberInvite`.
- [ ] 1.3 `apps/trust-api/src/i18n/messages.fr.ts` — les 5 chaînes actuelles, **mot pour mot** (aucune régression de wording), en fonctions typées.
- [ ] 1.4 `apps/trust-api/src/i18n/messages.pular.ts` — `export const pular: Partial<MessageCatalog>` **vide** au départ + en-tête : « chaînes à valider par un locuteur natif pular (Fulfulde) avant activation. Toute clé absente ici → `t()` retombe sur `fr`. Ne pas activer `pular` en prod tant que ce fichier n'est pas complet et relu. »
- [ ] 1.5 `apps/trust-api/src/i18n/translate.ts` — `t<K extends MessageKey>(key: K, locale: Locale, params: MessagesParams[K]): string`.
- [ ] 1.6 `apps/trust-api/src/i18n/index.ts` — ré-exports.

> **✅ GROUPE 1 + GROUPE 2 LIVRÉS.** `apps/trust-api/src/i18n/` (locale, messages, translate) + 5 services câblés + call-sites. Suite trust-api **1249 passed / 3 skipped**, couverture 92.8/93.9/82.9/92.8 (> seuils). money-api 112, db, audit-ci OK. tsc + eslint clean (0 nouveau warning). `pular` = stub vide → fallback fr runtime partout.
>
> **Revues code + sécurité (sous-agents) → APPROUVÉ, 0 bloquant.** Correctifs appliqués :
> - `t()` : `CATALOGS[locale] ?? fr` (durcissement défensif si locale hors typage).
> - clé `notification.memberInvite` : param `inviterName` → `orgName` (c'est un nom d'organisation, pas de personne).
> - `SUPPORTED_LOCALES` (export mort) retiré.
> - `client-portal-otp.service` : `Logger` ajouté, `logger.debug` sur le catch de résolution de langue ; commentaire sur `take: 10`.
> - Tests call-site avec org `pular` ajoutés (`invoices.service` : `notify` + `sendReminder`).
>
> **Backlog (dettes PRÉ-EXISTANTES mises en lumière, hors périmètre)** :
> - **M1 smishing** : `organization.name` (contrôlé par un owner/admin) interpolé sans filtrage de caractères de contrôle en tête d'un SMS émis par le sender de confiance facture.gn, vers un `msisdn` librement choisi. Sanitiser `organization.name` (retrait `\n`/`\r`/contrôles) avant tout usage en notification.
> - **F-LOG** : `SmsStubProvider.send()` logue le corps complet du SMS (dont le code OTP) en INFO. Le provider SMS réel Guinée ET le stub ne doivent jamais logger le body — a fortiori pour `clientPortalOtp`.

### Groupe 2 — câblage des 5 services (dépend du Groupe 1)
- [ ] 2.1 `payment-link-notification.service.ts` — `notify(customer, url, totalGnf, locale: Locale = "fr")` → `t("notification.paymentLinkReady", locale, { amountGnf, url })`. Call-site `invoices.service.ts` (bloc notify après émission) : `resolveLocale(organization.preferredLanguage)` (`organization` déjà en scope, `transactionResult`).
- [ ] 2.2 `payment-reminder.service.ts` — `send(customer, invoiceNumber, amountDueGnf, locale)` → `t("notification.paymentReminder", …)`. Call-site `InvoicesService.sendReminder` : ajouter `organization: { select: { preferredLanguage: true } }` à l'`include` de la requête `invoice`, `resolveLocale(invoice.organization.preferredLanguage)`.
- [ ] 2.3 `client-portal-otp.service.ts` — `request(msisdn)` : après création de l'OTP, `customer.findMany({ where: { phone: msisdn }, select: { organization: { select: { preferredLanguage: true } } } })` → si `new Set(langues).size === 1` → cette langue, sinon `fr` ; `t("notification.clientPortalOtp", locale, { code })`.
- [ ] 2.4 `ussd-account.service.ts::changePin` — charger `user` (ou `userPhone` avec `user: { select: { preferredLanguage } }`), `resolveLocale(user.preferredLanguage)`, `t("notification.pinChanged", locale, {})`.
- [ ] 2.5 `pending-member-invite.service.ts::notifyInvitee` — passer `locale` depuis l'appelant (`invite()`) : si `organizationId` → charger `organization.preferredLanguage` ; si `practiceId` → `fr`. `t("notification.memberInvite", locale, { inviterName })`.
- [ ] 2.6 `rendering/legal-mentions.ts` — commentaire d'en-tête : « reste en français — document légal, langue officielle OHADA/Guinée. La traduction ne concerne que le texte SMS/WhatsApp (lot i18n, ADR-051). »

### Groupe 3 — clôture
- [ ] 3.1 revalidation : `pnpm exec tsc` + `eslint` + `vitest --coverage` (trust-api), `vitest` (money-api, db), `audit-ci`.
- [ ] 3.2 `.env.example` / runbook : rien à ajouter (pas de nouvelle variable — `preferredLanguage` est en base). Documenter dans `docs/runbooks/` ? → non, trop léger ; une note dans `messages.pular.ts` suffit.
- [ ] 3.3 proposer une note dans `V/` (Backlog F2 / ADR) : « i18n texte = SMS/WhatsApp uniquement ; USSD et PDF restent FR (ADR-051 + document légal) ; pular livré en stub, activation après relecture native ». À rédiger après validation.

## Tests à écrire AVANT le code

### Groupe 1
- [ ] `locale.spec.ts` : `resolveLocale("pular")` → `"pular"` ; `resolveLocale("malinke")` / `"soussou"` / `null` / `undefined` → `"fr"`.
- [ ] `translate.spec.ts` : `t("notification.paymentReminder", "fr", {...})` → chaîne FR exacte ; `t(key, "pular", ...)` avec `pular` stub vide → **retombe sur la chaîne FR** ; après ajout d'une entrée `pular` factice en test (mock du module) → renvoie la chaîne pular. Params interpolés correctement (montant, url, code, numéro, nom).
- [ ] `messages.fr.spec.ts` : chaque clé produit exactement la chaîne historique (garde anti-régression de wording — copier les chaînes actuelles dans le test).

### Groupe 2 (par service)
- [ ] `payment-link-notification.service.spec.ts` : `notify(..., "fr")` → `provider.send` reçoit la chaîne FR historique (non-régression) ; `notify(..., "pular")` avec stub vide → chaîne FR (fallback) ; signature à 4 args ne casse pas les appels existants (mettre à jour les `toHaveBeenCalledWith`).
- [ ] idem `payment-reminder.service.spec.ts`, `client-portal-otp.service.spec.ts` (+ heuristique multi-org : 2 orgs même langue → cette langue ; 2 langues différentes → `fr`), `ussd-account.service.spec.ts` (PIN changed lit `user.preferredLanguage`), `pending-member-invite.service.spec.ts` (org → langue ; practice → `fr`).
- [ ] `invoices.service.spec.ts` : le call-site `notify` passe `resolveLocale(organization.preferredLanguage)` — vérifier avec un mock d'org en `pular`.

## Critères de done
- Aucun `[NEEDS CLARIFICATION]`.
- **Zéro régression de wording FR** — chaque chaîne FR identique au caractère près (tests de garde).
- `pular` non activable par erreur : fichier stub + en-tête explicite ; aucune variable d'env n'active `pular` (c'est `Organization.preferredLanguage` en base, mis par une story future).
- Tests verts, couverture ≥ seuils, `tsc` + `eslint` + `audit-ci` clean.
- Aucune donnée sensible loggée (le code OTP ne doit jamais atterrir dans un log — vérifier que `t()` ne logue rien).
- `dev-code-reviewer` OK ; `dev-security-reviewer` OK (OTP dans une chaîne traduite, params non échappés).

## Risques & mitigations
- **R1 — régression de wording FR** (une story facture peut dépendre du texte exact d'un SMS). → chaînes copiées mot pour mot dans `messages.fr.ts` + tests de garde par clé.
- **R2 — signature de service élargie casse ~10 `toHaveBeenCalledWith`** (piège Lot D). → `locale` en dernier paramètre, défaut `"fr"` ; mettre à jour les specs concernées.
- **R3 — `pular` activé en prod avec des chaînes non relues** → stub vide + en-tête gate ; `resolveLocale` ne renvoie `pular` que si `Organization.preferredLanguage === "pular"`, valeur qu'aucune story ne pose encore.
- **R4 — OTP : heuristique multi-org renvoie une mauvaise langue** → par défaut `fr` dès qu'il y a ambiguïté ; jamais bloquant ; le code OTP est de toute façon le même.
- **R5 — fuite du code OTP via un log de traduction** → `t()` est une fonction pure sans logging ; test dédié.

## Séquence
1. Groupe 1 (infra) — livrable seul, inerte.
2. Groupe 2 (câblage) — dépend du 1, un service à la fois.
3. Groupe 3 — clôture + note `V/`.
