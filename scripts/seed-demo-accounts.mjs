#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// SEED DES COMPTES DE DÉMONSTRATION — facture.gn
//
//   node scripts/seed-demo-accounts.mjs
//
// Crée RÉELLEMENT en base le compte marchand et le compte cabinet annoncés par
// la vitrine, avec leurs organisations, leurs clients, leurs 14 factures et
// leurs 5 mandats. Après passage, `/login` fonctionne avec les identifiants
// affichés sur /demo.
//
// ── POURQUOI CE SCRIPT EXISTE ───────────────────────────────────────────────
// Les écrans `/demo/*` s'ouvrent sans compte, et c'était la seule porte. Mais
// une carte qui affiche un numéro de téléphone invite à se connecter : les
// visiteurs allaient sur /login, essayaient, et repartaient convaincus que la
// plateforme était en panne. Plutôt que de cacher les identifiants, on les rend
// vrais.
//
// ── DEUX PHASES, ET LA FRONTIÈRE EST IMPORTANTE ─────────────────────────────
// 1. HTTP vers trust-api pour tout ce qui se crée : l'émission passe par le
//    vrai chemin, donc les factures sont réellement certifiées, signées et
//    chaînées. Écrire des factures directement en base produirait des pièces
//    sans signature valide, que `GET /verify` dénoncerait — et casserait la
//    chaîne de hachage des suivantes.
// 2. SQL scopé RLS pour les seules colonnes qu'aucune route publique n'écrit
//    (dispute_status, validated_by_administration, etax_status/receipt). Ces
//    quatre colonnes sont HORS du payload signé — FGN-Canon-v1 ne couvre que
//    invoiceId, nif, number, totalTtc, issuedAt et previousHash
//    (certification.service.ts) — donc les poser ne touche à aucune preuve.
//
// ── LE PIÈGE RLS ────────────────────────────────────────────────────────────
// `invoice` est en FORCE ROW LEVEL SECURITY. Un UPDATE sans
// `app.current_org_id` ne lève pas : il met à jour ZÉRO ligne, en silence. La
// phase 2 passe donc par `organizationScopedClient`, et vérifie le nombre de
// lignes touchées.
//
// ── IDEMPOTENT ──────────────────────────────────────────────────────────────
// Relançable sans dégât : un compte déjà inscrit est simplement réutilisé, et
// les factures ne sont pas recréées si l'organisation en porte déjà autant.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, "..");

const API = process.env.TRUST_API_URL ?? "http://localhost:3000";
const JEU = JSON.parse(readFileSync(path.join(ICI, "demo-dataset.json"), "utf8"));
const MOT_DE_PASSE = process.env.DEMO_PASSWORD ?? JEU.password;

// trust-api impose password.min(8) (auth/dto/register.dto.ts). Le refus arrive
// sinon au premier register, après une inscription partielle — autant le dire
// tout de suite, et nommer la contrainte plutôt que de relayer un 400.
if (MOT_DE_PASSE.length < 8) {
  console.error(`Le mot de passe doit faire au moins 8 caractères (trust-api). Reçu : ${MOT_DE_PASSE.length}.`);
  process.exit(1);
}

const CENTIMES_PAR_GNF = 100;

// ── Couche HTTP ─────────────────────────────────────────────────────────────

// ADR-016 : les routes d'écriture d'argent exigent un `Idempotency-Key` en
// UUID v4, sans quoi elles répondent 400. Une clé NEUVE par appel est correcte
// ici — chaque POST de ce script est une opération distincte, jamais un
// réessai. (Rejouer le script ne rejoue pas les mêmes clés, mais il ne rejoue
// pas non plus les mêmes opérations : les gardes d'idempotence sont au-dessus,
// dans les fonctions qui vérifient l'existant avant de créer.)
const attendre = (ms) => new Promise((resoudre) => setTimeout(resoudre, ms));

/** `POST /auth/register` est limité à 5 appels par minute (ThrottlerGuard), et
 *  ce script en fait six d'affilée : le marchand, le cabinet et quatre clients
 *  sous mandat. Le 429 n'est donc pas une anomalie à faire remonter, c'est le
 *  rythme normal de la route — on l'attend et on repasse.
 *
 *  Toute AUTRE erreur remonte immédiatement : un 400 réessayé quatre fois est
 *  un 400 quatre fois plus lent à diagnostiquer. */
const ATTENTE_THROTTLE_MS = 20_000;
const TENTATIVES_MAX = 5;

async function api(chemin, options = {}) {
  for (let tentative = 1; ; tentative += 1) {
    try {
      return await appel(chemin, options);
    } catch (erreur) {
      if (erreur.status !== 429 || tentative >= TENTATIVES_MAX) throw erreur;
      console.log(`  … limite de débit atteinte, reprise dans ${ATTENTE_THROTTLE_MS / 1000} s`);
      await attendre(ATTENTE_THROTTLE_MS);
    }
  }
}

async function appel(chemin, { method = "GET", body, token } = {}) {
  const reponse = await fetch(`${API}${chemin}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(method === "POST" ? { "Idempotency-Key": crypto.randomUUID() } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const texte = await reponse.text();
  const donnees = texte ? JSON.parse(texte) : null;

  if (!reponse.ok) {
    const erreur = new Error(`${method} ${chemin} → ${reponse.status} ${texte.slice(0, 300)}`);
    erreur.status = reponse.status;
    erreur.body = donnees;
    throw erreur;
  }
  return donnees;
}

/** Inscrit le compte s'il n'existe pas, et rend son jeton dans tous les cas.
 *
 *  trust-api répond volontairement un message générique sur un numéro déjà
 *  connu (anti-énumération, auth.service.ts) : on ne cherche donc pas à lire
 *  la raison de l'échec, on tente simplement la connexion derrière. Si elle
 *  passe, le compte existait avec ce mot de passe et tout va bien ; sinon
 *  l'erreur de login est la vraie information. */
async function inscrireOuConnecter(msisdn, name) {
  try {
    await api("/auth/register", { method: "POST", body: { name, msisdn, password: MOT_DE_PASSE } });
    console.log(`  + compte créé   ${msisdn}  (${name})`);
  } catch (erreur) {
    if (erreur.status !== 400 && erreur.status !== 409) throw erreur;
    console.log(`  = compte déjà là ${msisdn}`);
  }

  const { accessToken } = await api("/auth/login", {
    method: "POST",
    body: { msisdn, password: MOT_DE_PASSE },
  });
  return accessToken;
}

/** L'organisation du porteur du jeton, créée au besoin. Le créateur devient
 *  `owner` — c'est trust-api qui pose ce rôle, jamais ce script. */
async function organisationDe(token, description) {
  const existantes = await api("/organizations", { token });
  const deja = existantes.find((o) => o.name === description.name);
  if (deja) {
    console.log(`  = organisation   ${description.name}`);
    return deja.id;
  }
  const creee = await api("/organizations", { method: "POST", body: description, token });
  console.log(`  + organisation   ${description.name}`);
  return creee.id;
}

// ── Phase 1 — le marchand, ses clients, ses 14 factures ─────────────────────

async function semerLeMarchand() {
  console.log("\n▸ Compte marchand");
  const token = await inscrireOuConnecter(JEU.merchant.msisdn, JEU.merchant.userName);
  const organizationId = await organisationDe(token, JEU.merchant.organization);

  const montants = JEU.invoices.map((f) => f.montantGnf);
  if (new Set(montants).size !== montants.length) {
    throw new Error(
      "Deux factures du jeu partagent le même montant : le rapprochement par total TTC ne peut plus distinguer une facture déjà émise d'une nouvelle.",
    );
  }

  const liste = await api(`/invoices?organizationId=${organizationId}&take=100`, { token });
  const dejaEmises = Array.isArray(liste) ? liste : (liste?.invoices ?? []);
  // Une facture ANNULÉE n'est pas une facture émise : la reprendre comme
  // « déjà là » laisserait un trou dans le carnet, et le portefeuille ne
  // totaliserait plus 45 000 000 GNF. Les brouillons sont exclus pour la
  // raison symétrique — ils ne sont pas encore des pièces.
  const parMontant = new Map(
    dejaEmises
      .filter((f) => f.status !== "voided" && f.status !== "draft")
      .map((f) => [String(f.totalTtc), { id: f.id, status: f.status }]),
  );
  if (parMontant.size > 0) {
    console.log(`  = ${parMontant.size} factures déjà émises — seules les manquantes seront créées`);
  }

  // Un client par nom distinct. Les doublons de la liste (Pharmacie Bhoye
  // apparaît deux fois) doivent pointer LA MÊME fiche : c'est tout l'intérêt
  // d'un client enregistré, et un doublon fausserait l'encours par client.
  const parNom = new Map();
  const existants = await api(`/customers?organizationId=${organizationId}&take=200`, { token });
  for (const client of existants.customers ?? existants) {
    parNom.set(client.name, client.id);
  }

  let crees = 0;
  for (const nom of new Set(JEU.invoices.map((f) => f.client))) {
    if (parNom.has(nom)) continue;
    const client = await api("/customers", {
      method: "POST",
      body: { organizationId, name: nom },
      token,
    });
    parNom.set(nom, client.id);
    crees += 1;
  }
  console.log(`  + ${crees} clients créés, ${parNom.size} au total`);

  // Émission de la plus ancienne à la plus récente : la chaîne de hachage
  // suit l'ordre d'émission, et un carnet dont les dates remontent le temps
  // se lit mal dans tous les écrans qui trient par date.
  const chronologique = [...JEU.invoices].reverse();
  const factures = [];

  for (const source of chronologique) {
    const centimes = String(source.montantGnf * CENTIMES_PAR_GNF);
    const existante = parMontant.get(centimes);
    if (existante) {
      factures.push({ ...source, id: existante.id });
      if (source.encaissee && existante.status !== "paid") {
        await encaisser(existante.id, source, token);
      }
      continue;
    }

    const brouillon = await api("/invoices", {
      method: "POST",
      body: {
        organizationId,
        customerId: parNom.get(source.client),
        lines: [
          {
            description: `Fourniture et livraison — réf. ${source.numero}`,
            quantity: 1,
            unitPrice: String(source.montantGnf * CENTIMES_PAR_GNF),
          },
        ],
      },
      token,
    });

    const emise = await api(`/invoices/${brouillon.id}/issue`, { method: "POST", token });
    factures.push({ ...source, id: brouillon.id, number: emise.number ?? brouillon.number });

    if (source.encaissee) {
      await encaisser(brouillon.id, source, token);
    }
  }

  const total = factures.reduce((somme, f) => somme + f.montantGnf, 0);
  console.log(`  → ${factures.length} factures au portefeuille, ${total.toLocaleString("fr-FR")} GNF`);

  // Le chiffre que la page d'accueil, /demo/marchand et ce compte doivent tous
  // les trois afficher. S'il ne tombe pas, c'est que trust-api a ajouté de la
  // TVA au-dessus des lignes (régime fiscal de l'organisation) — et le compte
  // réel raconterait alors une autre histoire que la vitrine qui y renvoie.
  if (total !== 45_000_000) {
    console.warn(`  ! attendu 45 000 000 GNF — obtenu ${total.toLocaleString("fr-FR")}`);
  }

  const controle = await api(`/invoices?organizationId=${organizationId}&take=100`, { token });
  const vivantes = (Array.isArray(controle) ? controle : (controle?.invoices ?? [])).filter(
    (f) => f.status !== "voided" && f.status !== "draft",
  );
  const payees = vivantes.filter((f) => f.status === "paid").length;
  const attendues = JEU.invoices.filter((f) => f.encaissee).length;
  console.log(`  → ${payees}/${attendues} encaissées, ${vivantes.length} factures vivantes`);
  if (payees !== attendues || vivantes.length !== JEU.invoices.length) {
    console.warn("  ! le portefeuille ne correspond pas au jeu de démonstration");
  }
  return { token, organizationId, factures };
}

/** `method: "cash"` est le seul mode que cette route accepte, et au-delà du
 *  seuil de preuve (1 000 000 GNF) elle exige les TROIS éléments — photo, GPS
 *  ET signature — pas un seul d'entre eux (payments.service.ts →
 *  isCashProofRequirementMet). Les coordonnées sont celles du marché de
 *  Madina, l'adresse du scénario. */
async function encaisser(invoiceId, source, token) {
  await api(`/invoices/${invoiceId}/payments`, {
    method: "POST",
    body: {
      amount: String(source.montantGnf * CENTIMES_PAR_GNF),
      method: "cash",
      proofPhotoUrl: "https://demo.facture.gn/preuves/recu-demonstration.jpg",
      proofGpsLat: 9.5359,
      proofGpsLng: -13.6773,
      proofSignature: "Règlement de démonstration",
    },
    token,
  });
}

// ── Phase 1bis — le cabinet et ses cinq mandats ─────────────────────────────

async function semerLeCabinet(organisationDuMarchand) {
  console.log("\n▸ Compte cabinet");
  const token = await inscrireOuConnecter(JEU.practice.msisdn, JEU.practice.userName);

  const cabinets = await api("/practices/mine", { token });
  let practiceId = cabinets.find((p) => p.name === JEU.practice.name)?.id;
  if (!practiceId) {
    const cree = await api("/practices", {
      method: "POST",
      body: {
        name: JEU.practice.name,
        type: JEU.practice.type,
        registrationNumber: JEU.practice.registrationNumber,
        phone: JEU.practice.msisdn,
      },
      token,
    });
    practiceId = cree.id;
    console.log(`  + cabinet        ${JEU.practice.name}`);
  } else {
    console.log(`  = cabinet        ${JEU.practice.name}`);
  }

  // Les quatre organisations clientes, plus celle du marchand.
  const aMandater = [{ organizationId: organisationDuMarchand, token: null }];
  for (const client of JEU.mandatedOrganizations) {
    const jetonClient = await inscrireOuConnecter(client.msisdn, client.userName);
    const organizationId = await organisationDe(jetonClient, {
      name: client.name,
      regimeFiscal: client.regimeFiscal,
      legalForm: client.legalForm,
    });
    aMandater.push({ organizationId, token: jetonClient });
  }
  return { token, practiceId, aMandater };
}

/** Le cabinet DEMANDE, l'organisation ACCEPTE. Jamais l'inverse : un mandat
 *  que le cabinet s'accorderait lui-même serait exactement ce que la landing
 *  promet impossible (« un mandat accordé par le client, révocable par lui »). */
async function accorderLesMandats({ token, practiceId, aMandater }, jetonMarchand) {
  // La route rend des MANDATS, pas des organisations : `id` y est celui du
  // mandat. Prendre `id` faisait un Set d'identifiants qui ne correspondaient
  // à rien, la garde ne reconnaissait jamais l'existant, et seul le refus de
  // l'API empêchait les doublons — un filet qu'on ne doit pas laisser porter
  // seul la logique d'idempotence.
  const deja = new Set(
    (await api(`/practices/${practiceId}/organizations`, { token })).map((m) => m.organizationId),
  );

  let accordes = 0;
  let conserves = 0;
  for (const { organizationId, token: jetonClient } of aMandater) {
    if (deja.has(organizationId)) {
      conserves += 1;
      continue;
    }
    let mandateId;
    try {
      const demande = await api(`/practices/${practiceId}/mandates`, {
        method: "POST",
        body: { organizationId, grantedRole: "accountant_external" },
        token,
      });
      mandateId = demande.id;
    } catch (erreur) {
      if (erreur.status !== 400 && erreur.status !== 409) throw erreur;
      continue; // mandat déjà demandé ou déjà actif
    }

    await api(`/organizations/${organizationId}/mandates/${mandateId}/accept`, {
      method: "POST",
      token: jetonClient ?? jetonMarchand,
    });
    accordes += 1;
  }
  console.log(`  + ${accordes} mandats accordés, ${conserves} déjà en place`);
}

// ── Phase 2 — les colonnes de statut, hors payload signé ────────────────────

async function poserLesStatuts(organizationId, factures) {
  if (factures.length === 0) {
    console.log("\n▸ Statuts : rien à poser (factures déjà en place)");
    return;
  }

  console.log("\n▸ Statuts du parcours légal");
  // pathToFileURL, jamais un chemin brut : sous Windows, `import()` lit
  // « C:\… » comme un protocole nommé « c », et refuse.
  const { getPrismaClient, organizationScopedClient } = await import(
    pathToFileURL(path.join(RACINE, "packages", "db", "dist", "index.js")).href
  );
  const scope = organizationScopedClient(getPrismaClient(), organizationId);

  const idsDe = (predicat) => factures.filter(predicat).map((f) => f.id);

  // Déposée — toutes. Le REÇU est la preuve, pas le statut : un `transmitted`
  // sans numéro ne prouverait rien (voir lib/invoice-lifecycle.ts).
  const deposees = await scope.invoice.updateMany({
    where: { id: { in: factures.map((f) => f.id) } },
    data: { etaxStatus: "transmitted" },
  });
  for (const facture of factures) {
    await scope.invoice.update({
      where: { id: facture.id },
      data: { etaxReceiptNumber: `ETX-2026-${facture.numero.slice(-4)}` },
    });
  }

  const approuvees = await scope.invoice.updateMany({
    where: { id: { in: idsDe((f) => f.approuvee) } },
    data: { validatedByAdministration: true },
  });

  const litiges = await scope.invoice.updateMany({
    where: { id: { in: idsDe((f) => f.litige) } },
    data: { disputeStatus: "disputed" },
  });

  console.log(`  + déposées ${deposees.count} · approuvées ${approuvees.count} · litiges ${litiges.count}`);

  // Le silence est le mode d'échec de RLS : zéro ligne touchée ne lève pas.
  if (deposees.count !== factures.length) {
    throw new Error(
      `RLS : ${deposees.count} lignes mises à jour pour ${factures.length} factures — le scope n'a pas pris.`,
    );
  }
}

// ── Orchestration ───────────────────────────────────────────────────────────

async function main() {
  console.log(`Seed des comptes de démonstration → ${API}`);

  const marchand = await semerLeMarchand();
  const cabinet = await semerLeCabinet(marchand.organizationId);
  await accorderLesMandats(cabinet, marchand.token);
  await poserLesStatuts(marchand.organizationId, marchand.factures);

  console.log(`
─────────────────────────────────────────────
Comptes prêts. Mot de passe commun : ${MOT_DE_PASSE}

  Marchand  ${JEU.merchant.msisdn}   ${JEU.merchant.organization.name}
  Cabinet   ${JEU.practice.msisdn}   ${JEU.practice.name}
─────────────────────────────────────────────`);
}

main().then(
  () => process.exit(0),
  (erreur) => {
    console.error(`\nÉCHEC : ${erreur.message}`);
    process.exit(1);
  },
);
