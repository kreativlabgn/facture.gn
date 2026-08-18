import { randomBytes } from "node:crypto";

const SECRET_RANDOM_BYTES = 24;

// F15, ADR-097 — préfixe reflète l'environnement (comme Stripe/Djomy) pour
// qu'un secret collé dans le mauvais système soit immédiatement identifiable.
// keySuffix (4 derniers caractères) permet de reconnaître une clé dans la
// liste sans jamais ré-exposer le secret complet après sa création.
export function generateApiKeySecret(environment: "production" | "sandbox"): { secret: string; keySuffix: string } {
  const envTag = environment === "production" ? "live" : "test";
  const randomPart = randomBytes(SECRET_RANDOM_BYTES).toString("hex");
  const secret = `fg_${envTag}_${randomPart}`;
  return { secret, keySuffix: randomPart.slice(-4) };
}
