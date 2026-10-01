import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TRUST_API_SECRETS } from "./secrets";

// Cohérence INVENTAIRE ↔ OUTILLAGE des secrets inter-services (plan
// 2026-10-01-startup-secrets-and-redis-health).
//
// POURQUOI CE TEST EXISTE. Chaque clé `*_INTERNAL_KEY` a un garde
// (`*InternalAuthGuard`) dont le constructeur lève si la variable manque :
// fail-fast voulu, trust-api ne démarre pas. Une clé déclarée dans secrets.ts
// mais absente de l'outillage de démarrage fait donc planter un premier
// déploiement sans qu'aucun fichier ne l'annonce. C'est arrivé avec
// CREDITS_INTERNAL_KEY : présente dans l'inventaire et son garde, absente de
// .env.example, du script de secrets de staging, du fly.toml et du runbook —
// alors que les cinq autres y figuraient. Ce test rend l'oubli impossible à
// reproduire en silence : il nomme la clé ET le fichier manquants.
//
// Les chemins sont relatifs à la racine du dépôt (src/common → 4 niveaux).
const RACINE = join(__dirname, "..", "..", "..", "..");

const CLES_INTERNES = TRUST_API_SECRETS.map((s) => s.name).filter((nom) => nom.endsWith("_INTERNAL_KEY"));

const OUTILLAGE: Array<[string, string]> = [
  ["apps/trust-api/.env.example (modèle copié par chaque développeur)", "apps/trust-api/.env.example"],
  ["scripts/setup-staging-secrets.ps1 (génère les secrets de staging)", "scripts/setup-staging-secrets.ps1"],
  ["apps/trust-api/fly.toml (liste des secrets à poser avant le premier déploiement)", "apps/trust-api/fly.toml"],
  ["docs/runbooks/secrets-management.md (inventaire opérationnel)", "docs/runbooks/secrets-management.md"],
];

describe("Secrets inter-services — inventaire et outillage de démarrage", () => {
  it("l'inventaire déclare bien des clés internes (le test n'est pas vacueux)", () => {
    expect(CLES_INTERNES.length).toBeGreaterThanOrEqual(6);
  });

  it.each(OUTILLAGE)("%s mentionne toutes les clés *_INTERNAL_KEY de secrets.ts", (_libelle, chemin) => {
    const contenu = readFileSync(join(RACINE, chemin), "utf-8");
    const manquantes = CLES_INTERNES.filter((cle) => !contenu.includes(cle));

    expect(manquantes, `${chemin} ne mentionne pas : ${manquantes.join(", ")}`).toEqual([]);
  });
});
