// Les quatre onglets des paramètres marchands.
//
// L'onglet courant vit dans l'URL, JAMAIS dans un état React — même décision
// que resolveCabinetTab() (cabinet-nav.ts, 2026-09-08) et pour les mêmes
// raisons : sans JavaScript un onglet piloté par useState ne s'ouvre pas, un
// lien s'envoie et se met en favori, et le bouton Retour du navigateur refait
// le chemin inverse. Chaque onglet charge en plus SES données et rien d'autre
// (l'équipe, les succursales et les clés API sont trois appels distincts) : les
// charger tous les quatre à chaque affichage ferait payer à un commerçant venu
// corriger son NIF trois requêtes qu'il ne regardera pas.
//
// La résolution est ici, et non dans page.tsx, parce que c'est de la logique
// pure : elle se teste sans rendu.

export const SETTINGS_TABS = [
  { cle: "identite", label: "Identité & fiscalité" },
  { cle: "succursales", label: "Succursales" },
  { cle: "equipe", label: "Équipe & rôles" },
  { cle: "api", label: "Clés API" },
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number]["cle"];

export function resolveSettingsTab(valeur: string | string[] | undefined): SettingsTab {
  const brut = Array.isArray(valeur) ? valeur[0] : valeur;
  const trouve = SETTINGS_TABS.find((onglet) => onglet.cle === brut);
  return trouve ? trouve.cle : "identite";
}
