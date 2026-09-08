import { cookies } from "next/headers";
import { listMyPractices, type PracticeSummary } from "./trust-api";

// Cabinet actif de l'espace professionnel. Pendant exact de
// active-organization.ts, et pour la même raison : le layout se posait sur
// `practices[0]`.
//
// CE `[0]` ÉTAIT UN VRAI DÉFAUT, pas une simplification. Côté trust-api,
// listMine() n'avait aucun tri : Postgres rendait les rattachements dans
// l'ordre qui l'arrangeait. Un collaborateur membre de deux structures — le
// cas courant d'un comptable qui a son cabinet et intervient dans un CGA —
// atterrissait tantôt chez lui, tantôt chez le confrère où il n'est
// qu'invité. Rien à l'écran ne le disait, et cela ressemblait beaucoup à une
// fuite alors que l'accès, lui, était parfaitement légitime.
//
// LE COOKIE N'EST PAS UNE AUTORISATION. Son contenu est confronté à la liste
// réelle des cabinets du porteur du JWT à chaque résolution ; un identifiant
// absent de cette liste est ignoré, jamais utilisé. Le falsifier ne donne
// accès à rien — au pire il reste sans effet. Les 403 de trust-api
// (assertPracticeAdmin, practice-access.ts) restent le seul garde qui compte.
export const ACTIVE_PRACTICE_COOKIE = "fg_active_practice";

export interface ActivePracticeContext {
  practices: PracticeSummary[];
  active: PracticeSummary | null;
}

/** Pure — le cœur de la règle, testable sans cookies() ni fetch. */
export function pickActivePractice(
  practices: readonly PracticeSummary[],
  preferredId: string | null,
): PracticeSummary | null {
  const preferred = preferredId ? practices.find((practice) => practice.id === preferredId) : undefined;
  return preferred ?? practices[0] ?? null;
}

export async function resolveActivePractice(token: string): Promise<ActivePracticeContext> {
  const [practices, store] = await Promise.all([listMyPractices(token), cookies()]);
  const preferredId = store.get(ACTIVE_PRACTICE_COOKIE)?.value ?? null;
  return { practices, active: pickActivePractice(practices, preferredId) };
}
