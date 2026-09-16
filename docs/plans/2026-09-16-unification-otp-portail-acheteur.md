# Plan : Unification de l'habillage du tunnel OTP acheteur, récupération après
mauvais numéro, non-préremplissage du téléphone (2026-09-16)

## Contexte

Le parcours acheteur (payeur AVEC compte, authentifié par OTP SMS — distinct
du DAF/acheteur public qui utilise une session standard, hors périmètre) a
trois points d'entrée vers « numéro → code SMS → vérification » :

1. `apps/web/src/app/portail/auth/page.tsx` — entrée autonome. `AuthLayout`
   (`apps/web/src/components/auth/AuthLayout.tsx`, `role="acheteur"`, table
   `AUTH_CONTEXTES` dans `lib/auth-contexte.ts`) + `<OtpTunnel encadre={false} />`.
2. `apps/web/src/app/portail/(coquille)/[invoiceId]/page.tsx` — lien SMS
   direct vers UNE facture, session absente/expirée. Rendue à l'intérieur de
   `portail/(coquille)/layout.tsx` (chrome simple : fond gris, en-tête blanc
   avec mot-symbole + libellé « Portail acheteur », aucune tuile, aucune
   sortie), avec `<OtpTunnel retour=... titre=... intro=... />` (donc
   `encadre={true}`, carte bordée blanche brute).
3. `apps/web/src/app/pay/[invoiceId]/page.tsx` — payeur SANS compte, sans OTP,
   coquille indépendante. Persona différent (C19) ; hors périmètre de
   l'unification demandée, sauf vérification ponctuelle du bouton de
   démonstration (point 4 ci-dessous).

`apps/web/src/app/portail/OtpTunnel.tsx` est déjà LE composant unique partagé
pour la mécanique OTP — bon principe, ne pas le dupliquer. Le problème est la
coquille autour du point d'entrée 2, pas la logique.

Deux manques fonctionnels dans `OtpTunnel.tsx` (lignes 67-86) :
- aucune récupération après un mauvais numéro une fois `envoye` posé (code
  envoyé) : seul le formulaire de saisie du code s'affiche, aucun lien pour
  revenir en arrière ;
- ré-saisie complète du numéro sur le lien SMS direct (point d'entrée 2), sans
  préremplissage — voir décision RGPD ci-dessous, assumée et non corrigée par
  un préremplissage via l'URL.

Le dépôt contient déjà des changements non commités sans rapport avec ce
chantier (`route-protection.ts`/spec — durcissement anti-open-redirect —,
fichiers `cabinet/*`, un chantier USSD sur `trust-api`). Ce plan n'y touche
pas.

## Problème détaillé

### A. Habillage divergent entre les points d'entrée 1 et 2

Point 1 : écran scindé (`AuthLayout`) — colonne Navy avec tuiles d'étapes
numérotées, tuile « vos données restent à vous », lien FAQ, sorties
« Changer de profil » / « Retour à l'accueil » disponibles à toute taille
d'écran. Point 2 : simple fond gris + en-tête blanc minimal (mot-symbole +
« Portail acheteur »), aucune tuile, aucune sortie — quelqu'un qui a suivi un
lien SMS erroné ou n'est pas le bon destinataire n'a **aucune** échappatoire
sinon le bouton retour du navigateur.

### B. Aucune récupération après un mauvais numéro (`OtpTunnel.tsx`)

Une fois `envoye` posé, seul le formulaire de code s'affiche. Se tromper de
numéro (ou ne rien recevoir) oblige à recharger la page entière pour
recommencer — perte du contexte `retour`/`titre`/`intro` propre à la page
appelante le temps du rechargement (pas une perte de données, mais une
rupture d'expérience et un aller-retour serveur inutile).

### C. Ré-saisie du numéro sur lien SMS direct (point d'entrée 2)

`(coquille)/[invoiceId]/page.tsx` est atteint par un lien envoyé PAR SMS à un
numéro précis, mais l'utilisateur retape son numéro complet avant de recevoir
un code — alors que le lien est par construction déjà adressé à ce numéro.

### D. Bouton de paiement factice signalé par un audit précédent

À vérifier : `apps/web/src/app/pay/[invoiceId]/page.tsx`,
`CheckoutDemonstration`/`BoutonOperateur`.

## Solution retenue

### 1. Unification de l'habillage (points d'entrée 1 et 2 uniquement)

**Décision : le point d'entrée 2 passe aussi par `AuthLayout role="acheteur"`
lorsqu'aucun token n'est présent — mais seulement sur cette branche, et via un
changement complémentaire dans `(coquille)/layout.tsx` pour éviter un double
en-tête.** Ce n'était pas évident a priori (la question posée — une colonne
marketing « ce que vous allez trouver » a-t-elle sa place quand on arrive pour
régler UNE facture précise ? — est légitime) ; le raisonnement retenu :

- **DOM mobile-first d'`AuthLayout` déjà pensé pour ce cas** : le formulaire
  (colonne d'ACTION) est TOUJOURS premier dans le DOM, la zone d'information
  (tuiles, FAQ, sorties) après — sur le téléphone d'où ce lien s'ouvre presque
  toujours (`PortalTabs.tsx` : « ce portail s'ouvre presque toujours depuis un
  SMS »), l'écran affiché sans défiler reste le formulaire de numéro/code tel
  qu'aujourd'hui. La zone d'information n'est pas un obstacle, elle est une
  ressource disponible plus bas.
- **La réassurance a plus de valeur ici, pas moins** : ce point d'entrée
  demande à quelqu'un de saisir son numéro de téléphone en réponse à un SMS
  reçu — exactement le schéma d'un hameçonnage. « Vos données restent à
  vous », l'explication en trois étapes et un lien FAQ vérifiable
  répondent à la méfiance légitime d'un destinataire, plus qu'ils ne
  desservent quelqu'un déjà convaincu (point d'entrée 1, arrivée volontaire).
- **Manque réel comblé** : le point 2 n'offre aujourd'hui AUCUNE sortie
  (« Changer de profil », « Retour à l'accueil ») — un destinataire qui n'est
  pas le bon (SMS mal adressé, lien transféré par erreur) est actuellement
  bloqué sur cet écran. `AuthLayout` les fournit gratuitement.
- **Obstacle technique identifié et résolu, pas ignoré** :
  `(coquille)/[invoiceId]/page.tsx` est rendue à l'intérieur de
  `(coquille)/layout.tsx`, qui pose déjà SON PROPRE en-tête (mot-symbole +
  « Portail acheteur »). Empiler `AuthLayout` (qui pose aussi mot-symbole +
  en-tête) par-dessus doublerait le chrome. Vérification faite : TOUTES les
  autres routes de `(coquille)` (`page.tsx`, `factures/page.tsx`,
  `profil/page.tsx`) font `redirect("/portail/auth")` dès que le token est
  absent — le rendu du layout n'atteint donc JAMAIS l'utilisateur non
  authentifié sur ces routes (`redirect()` interrompt le rendu avant que le
  parent ne s'affiche). SEULE `[invoiceId]/page.tsx` rend du contenu sans
  token. `(coquille)/layout.tsx` peut donc, sans rien casser pour les autres
  routes, court-circuiter son propre chrome quand `!token` : `return
  <>{children}</>;` — la page enfant (qui posera alors `AuthLayout`, chrome
  complet) devient seule responsable de l'habillage dans ce cas précis. Le
  cas « token présent mais expiré/révoqué », capturé plus profondément dans
  `VueFacture` (try/catch sur `chargerPortail`), N'EST PAS concerné : à ce
  stade le layout a déjà, légitimement, rendu son chrome authentifié complet
  (onglets compris) parce que le cookie existe — ce cas continue de retomber
  sur `<OtpTunnel retour=... />` nu (comportement actuel inchangé), ce qui est
  cohérent : l'utilisateur était déjà dans le portail, pas en train d'y
  entrer.

Concrètement :
- `(coquille)/layout.tsx` : ajoute `if (!token) return <>{children}</>;` avant
  son chrome habituel, avec commentaire explicatif (pourquoi c'est sûr pour
  les 3 autres routes du groupe).
- `(coquille)/[invoiceId]/page.tsx` : la branche `if (!token)` enveloppe
  désormais son `<OtpTunnel .../>` (titre/intro/retour inchangés, propres à
  la facture) dans `<AuthLayout role="acheteur">...</AuthLayout>`, avec
  `encadre={false}` (même convention que le point d'entrée 1 : la colonne
  d'action EST la carte).
- Le catch d'expiration dans `VueFacture` n'est PAS touché.

`/pay/[invoiceId]` (persona sans compte, sans OTP) n'est pas touché : aucun
sens visuel évident à le faire rejoindre `AuthLayout`, qui suppose un choix de
profil/tunnel d'authentification — `/pay` n'en a pas.

### 2. Récupération après un mauvais numéro (`OtpTunnel.tsx`)

Ajout d'un état local `corriger` (booléen, indépendant de `useActionState`,
qui n'expose pas de setter) : tant qu'il est `true`, l'écran affiche le
formulaire NUMÉRO même si un envoi précédent a réussi. Un
`<button type="button">` visible sur l'écran de code (« Ce n'est pas le bon
numéro ? Modifier ») le pose à `true`. Il repasse à `false` dès qu'un NOUVEL
envoi réussit (`"envoye" in etatDemande`) — sans quoi un renvoi réussi
resterait bloqué sur l'écran numéro — via l'ajustement PENDANT LE RENDU
(pattern React « adjusting state when a prop changes », comparaison avec un
état `etatDemandeTraite` qui mémorise le dernier `etatDemande` vu), pas un
`useEffect` : `react-hooks/set-state-in-effect` (activé dans ce dépôt,
constaté au lint) interdit d'appeler `setState` de façon synchrone dans un
effet pour ce type de synchronisation. Le champ `msisdn` déjà saisi (état
local `useState`, jamais dans l'URL) reste pré-rempli pour permettre une
correction plutôt qu'une ressaisie complète.

### 3. Non-préremplissage du numéro sur le point d'entrée 2 — décision assumée

**Décision : ne PAS préremplir le numéro, ni via un paramètre d'URL, ni par
un autre canal.** Un numéro de téléphone dans une URL fuit par l'historique
du navigateur, les en-têtes Referer et les captures d'écran partagées — la
même discipline que le masquage `620***233` déjà pratiqué ailleurs dans ce
dépôt pour ce type de donnée. Alternative écartée : afficher un indice masqué
du numéro attendu — impossible sans que le lien SMS transporte lui-même le
numéro (ou un identifiant qui le révélerait), ce qui recrée exactement le
problème RGPD qu'on évite ; `trust-api` ne connaît le numéro qu'APRÈS la
demande d'OTP, pas avant, il n'y a donc pas de donnée à afficher sans la
demander d'abord. Le texte d'intro déjà en place sur ce point d'entrée
(« Nous vous envoyons un code par SMS pour confirmer que cette facture vous
est bien adressée. ») explique déjà le POURQUOI de la ressaisie ; il n'est
pas modifié — reformuler n'apporterait rien de plus tant que le motif exact
(confirmer que CE numéro précis est bien le destinataire) est déjà énoncé.

### 4. Bouton de paiement factice (audit précédent) — vérification, pas correctif

Lecture de `apps/web/src/app/pay/[invoiceId]/page.tsx`
(`CheckoutDemonstration`/`BoutonOperateur`, lignes ~92-206) : badge
« Démonstration » explicite, texte « Aucun débit n'est possible depuis cet
écran », `aria-disabled="true"` (pas `disabled`, donc restant dans l'ordre de
tabulation — commentaire du fichier l'explique explicitement), aucun
gestionnaire de clic, aucune URL de paiement câblée. Le vrai guichet
(`CheckoutSummary`/`Reglement`/`MobileMoneyForm.tsx`) est lui bien câblé sur
`initiateMobileMoneyPaymentAction`, une Server Action réelle qui pousse un
débit et affiche un état `pending` honnête (jamais « payé », le webhook
seul confirme). Recherche complémentaire des boutons `type="button"` du
dépôt (`Grep`) : les 14 autres occurrences sont des menus, filtres,
formulaires à confirmation ou simulateurs USSD, tous porteurs d'une action
réelle câblée ou d'un état explicite — rien d'apparenté à un CTA de paiement
inerte non labellisé. `CertifyLiquidationForm.tsx` (DAF, cité par la
consigne) est un vrai formulaire avec Server Action
(`validateLiquidationAction`), pas un bouton factice.
**Conclusion : ce n'est plus (ou n'a jamais été, dans l'état actuel du code)
un problème.** Aucun correctif nécessaire ; rapporté tel quel dans le rendu
final plutôt que forcé.

## Alternatives écartées

- **Rediriger `[invoiceId]/page.tsx` (branche non authentifiée) vers
  `/portail/auth?retour=...`** au lieu de rendre `AuthLayout` en place :
  écarté. Cela aurait fait perdre le titre/l'intro spécifiques à la facture
  (« Consulter cette facture » / « confirme que cette facture vous est bien
  adressée ») au profit du texte générique de `/portail/auth`, pour un gain
  nul (le rendu en place, une fois `AuthLayout` utilisé, obtient déjà le même
  habillage sans perdre ce contexte). Aurait aussi ajouté un aller-retour
  réseau.
- **Dupliquer les sorties (« Changer de profil »/« Retour à l'accueil ») en
  dehors d'`AuthLayout`**, directement dans `(coquille)/layout.tsx` : écarté
  — recréerait un second habillage plutôt que de réutiliser l'infrastructure
  déjà là, contrairement à la consigne. La solution retenue (court-circuiter
  le chrome du layout et laisser la page poser `AuthLayout` en entier) évite
  cette duplication.
- **Remonter le composant via une `key` pour réinitialiser tout l'état local
  (`msisdn` compris) au clic sur « Modifier »** : écarté — perdrait le numéro
  déjà saisi, obligeant une ressaisie complète, alors que l'objectif de ce
  bouton est justement de permettre une CORRECTION.
- **Masquer le numéro déjà attendu sur le point d'entrée 2 pour rassurer sans
  demander de ressaisie complète** : écarté, voir §3 — aucune donnée
  disponible côté serveur avant la demande d'OTP elle-même.

## Fichiers et tâches

1. `apps/web/src/app/portail/OtpTunnel.tsx` — état `corriger` +
   `useEffect` de réinitialisation + bouton « Ce n'est pas le bon numéro ?
   Modifier » sur l'écran de code.
2. `apps/web/src/app/portail/OtpTunnel.spec.tsx` (NOUVEAU) — couverture
   statique (voir « Tests avant code »).
3. `apps/web/src/app/portail/(coquille)/[invoiceId]/page.tsx` — branche
   `!token` enveloppée dans `<AuthLayout role="acheteur">`, `encadre={false}`ajouté
   sur `OtpTunnel` ; import `AuthLayout`. Branche de session expirée
   (`VueFacture`) inchangée.
4. `apps/web/src/app/portail/(coquille)/layout.tsx` — court-circuit
   `if (!token) return <>{children}</>;` avant le chrome habituel, avec
   commentaire expliquant pourquoi c'est sûr (seule `[invoiceId]` atteint ce
   code sans token, toutes les autres routes du groupe redirigent avant).

Fichiers explicitement NON touchés : tout `apps/web/src/app/cabinet/**`,
`apps/web/src/lib/route-protection.ts` (et son spec), tout `apps/trust-api/src/ussd/**`,
`apps/web/src/app/pay/[invoiceId]/page.tsx` (vérifié, pas corrigé),
`apps/web/src/app/daf/**` (hors périmètre, persona distinct).

## Tests avant code

`renderToStaticMarkup` est le seul harnais disponible pour les composants
`.tsx` dans ce dépôt (pas de jsdom/`@testing-library` dans
`apps/web/vitest.config.ts` — `environment: "node"` — précédent constaté sur
`AuthLayout.spec.tsx`, `OcrReviewAlert.spec.tsx`, etc.) : un rendu statique ne
peut PAS déclencher `useActionState`/`useEffect` (pas d'événements, pas de
transitions React). La couverture automatique du scénario « clic sur Modifier
→ retour à l'étape numéro » est donc limitée à ce qui est vérifiable sans
interaction ; le reste est vérifié manuellement (voir « Vérification
manuelle » sous Critères de done) — limite documentée plutôt que passée sous
silence.

`apps/web/src/app/portail/OtpTunnel.spec.tsx` (nouveau, RED d'abord) :
- rendu par défaut (aucun envoi) : formulaire numéro présent
  (`name="portail-msisdn"` via le label), AUCUNE occurrence du texte
  « Modifier » (le bouton ne doit apparaître qu'une fois un code envoyé, donc
  jamais visible sur un rendu initial) ;
- `encadre` (déjà en place, non testé jusqu'ici) : `encadre={false}` ne pose
  pas `rounded-2xl border`, `encadre={true}` (par défaut) le pose ;
  régression utile puisque ce fichier est modifié ;
- `titre`/`intro` par défaut vs personnalisés (`retour`, `titre`, `intro`
  fournis) apparaissent bien dans le HTML rendu.

## Critères de done

- Points d'entrée 1 et 2 partagent le même habillage (`AuthLayout`,
  `role="acheteur"`) sans double en-tête ni double mot-symbole.
- Le catch de session expirée dans `VueFacture` continue de fonctionner sans
  changement visuel.
- `OtpTunnel.tsx` propose un retour à l'étape numéro sans recharger la page,
  sans perdre `retour`/`titre`/`intro`.
- Aucun préremplissage du numéro de téléphone par l'URL — vérifié par lecture
  (aucun `searchParams` lu pour `msisdn` dans `[invoiceId]/page.tsx` ni
  `OtpTunnel.tsx`).
- `/pay/[invoiceId]` non modifié ; conclusion de vérification du point 4
  rapportée.
- `pnpm --filter web lint`, `typecheck`, `test`, `build` passent.
- Aucun commit — working tree laissé pour relecture.

### Vérification manuelle (limite du harnais de test)

`pnpm --filter web dev` (port dédié, ex. `PORT=3002`) puis, faute d'outil de
navigateur dans cette session, vérification par `curl` du HTML servi par SSR
sur `/portail/auth` et sur une facture de démonstration
`/portail/<invoiceId>` sans cookie de session — confirme l'absence d'erreur
de rendu serveur et la présence du chrome `AuthLayout` attendu sur les deux
routes. Le comportement CLIENT du bouton « Modifier » (clic → retour à
l'étape numéro sans rechargement) n'est, lui, pas vérifiable sans navigateur
réel dans cet environnement — limite assumée et signalée plutôt que déclarée
« testée » à tort.

## Risques et limites

- `(coquille)/layout.tsx` est partagé par 4 routes ; le court-circuit
  `if (!token)` doit être vérifié comme n'affectant QUE `[invoiceId]` (les
  3 autres redirigent avant tout rendu quand le token est absent — revérifié
  par lecture de chacune avant modification).
- Le scénario d'interaction (clic sur « Modifier ») n'est pas couvert par un
  test automatisé dans ce dépôt (absence de jsdom) — relecture humaine et
  vérification manuelle demandées explicitement en conséquence.
- Aucune modification des fichiers déjà en cours de modification sur cette
  branche (`cabinet/*`, `route-protection.*`) ni du chantier USSD parallèle
  (`apps/trust-api/src/ussd/**`).
