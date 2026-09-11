import { randomBytes } from "node:crypto";

const SECRET_RANDOM_BYTES = 24;

const KEY_SUFFIX_LENGTH = 4;

// F15, ADR-097 — préfixe reflète l'environnement (comme Stripe/Djomy) pour
// qu'un secret collé dans le mauvais système soit immédiatement identifiable.
// keySuffix (4 derniers caractères) permet de reconnaître une clé dans la
// liste sans jamais ré-exposer le secret complet après sa création.
export function generateApiKeySecret(environment: "production" | "sandbox"): { secret: string; keySuffix: string } {
  const envTag = environment === "production" ? "live" : "test";
  const randomPart = randomBytes(SECRET_RANDOM_BYTES).toString("hex");
  const secret = `fg_${envTag}_${randomPart}`;
  return { secret, keySuffix: randomPart.slice(-KEY_SUFFIX_LENGTH) };
}

// Forme exacte de ce que produit generateApiKeySecret() ci-dessus, DÉRIVÉE de
// SECRET_RANDOM_BYTES et non recopiée : une longueur écrite en dur ici cesserait
// silencieusement de reconnaître les clés le jour où le secret s'allongerait.
const API_KEY_SECRET_PATTERN = new RegExp(`^fg_(?:live|test)_[0-9a-f]{${SECRET_RANDOM_BYTES * 2}}$`);

/**
 * Suffixe indexable d'un secret présenté par un appelant, ou `null` si le secret
 * n'a pas la forme d'une clé facture.gn.
 *
 * ADR-107 — vit ICI, avec le générateur, pour que la vérification (passerelle
 * PDP) et la génération ne puissent jamais diverger. argon2 étant volontairement
 * non réversible, aucun `WHERE key_hash = ...` n'est possible : ce suffixe est
 * le SEUL moyen de réduire l'ensemble des clés à vérifier une par une. Un
 * secret mal formé est écarté avant même la lecture en base — inutile de payer
 * une requête pour une chaîne qui ne peut pas être une de nos clés.
 */
export function apiKeySuffixOf(secret: string): string | null {
  return API_KEY_SECRET_PATTERN.test(secret) ? secret.slice(-KEY_SUFFIX_LENGTH) : null;
}
