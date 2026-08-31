# Politique de conservation des données à caractère personnel — facture.gn

> **Statut** : rédigée dans `code/` (le corpus `V/` est momentanément gelé). À
> porter dans `V/` (dossier conformité) quand `V/` est propre. Cadre : Loi
> **L/2016/037/AN** (protection des données), **OHADA/SYSCOHADA Article 23** et
> Loi **L/2021/024/AN** (LBC/FT) pour les obligations de conservation, agrément
> **PDP visé Q3 2027**. Livrée avec le Lot J2 (droits des personnes) — le Lot J1
> avait explicitement reporté « la politique de rétention formelle par finalité »
> à ce lot.

## 1. Principe

facture.gn est un **tiers de confiance privé** : il traite des données
personnelles de particuliers qui, le plus souvent, **n'ont pas de compte**
(clients d'une PME utilisatrice). Chaque catégorie de données a une **finalité**,
une **base légale**, une **durée de conservation** et un **traitement à
l'échéance**. Le droit à l'effacement (art. L/2016/037) s'applique **sauf**
lorsqu'une obligation légale impose la conservation — dans ce cas la donnée
strictement nécessaire à cette obligation est conservée jusqu'à son échéance, et
tout le reste est effacé immédiatement (**anonymisation partielle**, voir §4).

## 2. Registre des traitements — conservation par finalité

| # | Catégorie / champs | Finalité | Base légale | Durée de conservation | À l'échéance |
|---|---|---|---|---|---|
| 1 | **Identité client sur facture** — `customer.name`, `customer.nif` quand ≥ 1 facture émise le référence | Établir une facture conforme (mentions obligatoires du vendeur/acheteur) | Obligation légale — OHADA Art. 23, réglementation fiscale | **10 ans** à compter de la dernière facture émise | Anonymisation complète possible (tombstone) |
| 2 | **Contact client** — `customer.phone`, `customer.notification_channel` | Envoyer le lien de paiement / les rappels | Exécution du service demandé par la PME (intérêt légitime) | Tant que la relation client est active ; **effaçable à tout moment sur demande** | `phone → NULL` immédiat |
| 3 | **Données commerciales client** — `customer.credit_limit`, `customer.possible_duplicate_of` | Gestion du poste client par la PME | Intérêt légitime de la PME | Relation active | Effacé immédiatement à l'anonymisation |
| 4 | **Facture émise** — `invoice.*`, `invoice_line.*`, `invoice.hash`, `certification_id` | Preuve comptable, certification cryptographique, vérification publique | Obligation légale — OHADA Art. 23 ; contrat | **10 ans** | Conservé (hors périmètre d'effacement — voir §3) |
| 5 | **Journal d'audit** — `invoice_event` (`actor_id`, `metadata`, `amount`) | Piste d'audit OHADA, détection LBC/FT | Obligation légale — L/2021/024, OHADA | **10 ans** (aligné factures) | Conservé ; `actor_id` reste un UUID pseudonyme (le `User` pointé est anonymisé, §5) |
| 6 | **Ancrage Merkle** — `merkle_anchor_batch` | Engagement cryptographique horodaté, opposable | Intégrité de la preuve (E1) | Indéfinie — ne contient **que des digests** (aucune donnée personnelle) | N/A |
| 7 | **Compte utilisateur PME** — `user.name`, `user_phone.msisdn`, `user.preferred_language` | Authentification, RBAC | Contrat | Durée de vie du compte | Anonymisation `User` = **hors périmètre du Lot J2** (renvoyée au support — touche auth/memberships) |
| 8 | **Secrets d'auth** — `user.password_hash`, `user.pin_hash` | Authentification | Contrat | Durée de vie du compte | Jamais exportés, jamais loggés ; supprimés avec le compte |
| 9 | **Sessions & jetons éphémères** — `ussd_session`, `client_portal_otp`, `revoked_token` | Session USSD / OTP portail client / révocation JWT | Sécurité, exécution du service | 24 h – 7 j (voir `docs/runbooks/retention.md`) | Purgés par le job de rétention (J3) |
| 10 | **Preuve de consentement** — `assisted_session.consent_recorded_at` | Prouver le consentement à l'émission assistée par agent terrain | Obligation légale L/2016/037 (le consentement se prouve) | **10 ans** (aligné sur les factures produites pendant la session) | Conservé — jamais purgé sur `expires_at` seul (J3, finding F-H1) |
| 11 | **Invitations en attente** — `pending_member_invite.msisdn` | Inviter un collaborateur / client non inscrit | Exécution du service | 14–30 j (TTL) puis purge (J3) | Purgé |
| 12 | **Registre des demandes de droits** — `data_rights_request` (`subject_phone_hash`, jamais le n° en clair) | Prouver au régulateur PDP le traitement des demandes | Obligation légale L/2016/037 ; responsabilité (accountability) | **10 ans** ; append-only (trigger) | Conservé |
| 13 | **Comptes acheteur public / DAF** — `public_buyer_account.*`, `public_buyer_account_member` | Portail B2G Niveau 2 | Contrat | Durée de vie du compte | Hors périmètre Lot J2 |
| 14 | **Cabinets / CGA** — `professional_practice.name/phone/email`, `practice_member` | Relation cabinet comptable | Contrat | Durée de vie de la relation | Hors périmètre Lot J2 |

## 3. Ce que le droit à l'effacement N'ATTEINT PAS, et pourquoi

Les tables suivantes sont **append-only en base** (triggers, Lots J1/E1) et
**exclues du périmètre d'effacement** :

| Table | Raison | Contient des données personnelles ? |
|---|---|---|
| `invoice`, `invoice_line` | Preuve comptable OHADA 10 ans ; recalcul de la certification | `customer_id` (FK, pas de PII inline) ; montants ; références B2G |
| `invoice_event` | Piste d'audit OHADA / LBC-FT 10 ans | `actor_id` (UUID `User` pseudonyme) ; `metadata` (aujourd'hui : IDs, enums, montants — **aucune PII directe**, à re-vérifier à chaque nouveau writer) |
| `merkle_anchor_batch` | Engagement cryptographique | **Non** — uniquement des SHA-256 |
| `data_rights_request` | Registre de responsabilité (accountability) | `subject_phone_hash` (SHA-256, non réversible) ; jamais le numéro en clair |

**Conséquence pratique** : anonymiser une personne **ne supprime aucune ligne**
de ces tables. Ce qui la rend non identifiable, c'est l'effacement / le tombstone
des colonnes PII sur les tables mutables (`customer`, plus tard `user`), les
tables append-only ne référençant la personne que par un identifiant technique.

**Après échéance de conservation (10 ans)** : une purge réelle des lignes
devenues sans base légale nécessiterait une procédure ops supervisée
(`DISABLE TRIGGER` encadré) — **non construite** ; elle est signalée ici comme
dette de conformité à traiter avant que les premières factures n'atteignent 10
ans (2036+).

## 4. Anonymisation d'un `Customer` — complète vs partielle

| Situation | `name` | `phone` | `nif` | `credit_limit`, `possible_duplicate_of` | `notification_channel` | `anonymized_at` | `outcome` |
|---|---|---|---|---|---|---|---|
| **Aucune facture conservée** (aucune, ou seulement `draft` / proforma / devis) | → `"Client anonymisé"` | → `NULL` | → `NULL` | → `NULL` | → `sms` (défaut) | posé | `completed` |
| **≥ 1 facture `issued` / `partially_paid` / `paid` / `voided`** | **conservé** | → `NULL` | **conservé** | → `NULL` | → `sms` | posé | `partial` |

En anonymisation partielle, l'échéance après laquelle `name` / `nif` pourront
aussi être effacés (`max(issued_at) + 10 ans`) est enregistrée dans
`data_rights_request.note`.

Une ligne `customer` avec `anonymized_at != NULL` est **gelée** : le
dédoublonnage par téléphone l'ignore (jamais de `possible_duplicate_of` vers
elle, jamais de « réactivation »), et `merge()` / `flagPublicEntity()` /
`proposeCreditLimit()` la refusent.

## 5. Effet sur `User` et `invoice_event.actor_id`

L'anonymisation d'un `User` (compte PME) **n'est pas dans le Lot J2** (elle touche
l'authentification, les `OrganizationMember`, les mandats — chantier distinct). Le
principe retenu quand elle sera construite : `user.name → tombstone`,
`user_phone` supprimés, `password_hash` / `pin_hash` effacés. `invoice_event.actor_id`
**reste** : c'est un UUID qui pointe vers un `User` désormais anonyme — la piste
d'audit conserve « qui a agi » sous forme pseudonyme, sans réidentification
possible. Aucun `DISABLE TRIGGER` sur `invoice_event`.

## 6. Droits couverts par le Lot J2 et état des lieux

| Droit (L/2016/037) | État après Lot J2 |
|---|---|
| **Accès / portabilité** | ✅ `POST /customers/data-rights/export` (PME, scopé) et `POST /internal/data-rights/export` (ops, transverse) — dossier PII structuré en JSON |
| **Effacement / anonymisation** | ✅ `POST /customers/data-rights/:id/anonymize` (PME) et `POST /internal/data-rights/anonymize` (ops, par téléphone, transverse) — complète ou partielle (§4) |
| **Rectification** | ⚠️ **Gap** — il n'existe aujourd'hui **aucun endpoint de modification** d'un `Customer` (le contrôleur n'expose que create / import / get / merge / flag / credit-limit). Une rectification passe par une intervention ops directe. À combler dans un lot ultérieur. |
| **Opposition** | ⚠️ **Partiel** — `customer.notification_channel` permet de choisir le canal mais pas de s'opposer à toute notification. Un opt-out complet (ne plus jamais notifier) n'est pas modélisé. À combler. |

## 7. Contacts et procédure

Le traitement opérationnel d'une demande (délais, pièces, réponse motivée en cas
de refus partiel) est décrit dans `docs/runbooks/data-rights.md`.
