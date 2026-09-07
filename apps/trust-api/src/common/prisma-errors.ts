/** Vrai pour toute violation d'unicité, sans regarder quelle colonne. */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

// SOUS RLS, PRISMA NE PEUT PAS NOMMER LA COLONNE — et c'est notre cas normal.
//
// Postgres supprime le DETAIL « Key (colonne)=(valeur) already exists » quand le
// rôle courant n'a pas le droit de voir la ligne en conflit : le révéler
// fuiterait une donnée que la politique lui cache. Avec FORCE ROW LEVEL
// SECURITY (ADR-111), facture_app est exactement dans ce cas. Or Prisma dérive
// meta.target de ce DETAIL — privé de lui, il rend target: null.
//
// Vérifié le 2026-09-07 sur facture_gn_dev, la MÊME insertion en double :
//   facture_app (RLS forcée)    → P2002, target = null
//   postgres (superutilisateur) → P2002, target = ["referred_organization_id"]
//
// Exiger un tableau, comme le faisait cette fonction, revenait donc à ne JAMAIS
// reconnaître une collision en production : chaque 409 prévu retombait en 500
// opaque — numérotation de facture, idempotence des paiements et des
// remboursements, NIF déjà pris. Les tests unitaires ne pouvaient pas le voir :
// ils fabriquent l'erreur AVEC son target.
//
// D'où le repli. Colonne nommée, on la compare ; colonne inconnue, on accepte —
// la base ne dira rien de plus, et un 409 vaut mieux qu'un 500. Le prix est
// réel et assumé : sur une table portant PLUSIEURS contraintes uniques,
// l'appelant ne peut plus savoir laquelle a cédé. À lui de lever l'ambiguïté
// par une lecture s'il doit nommer le champ à l'utilisateur — voir
// collisionIdentifiantEtat() dans organizations.service.ts.
export function isUniqueConstraintViolation(error: unknown, field: string): boolean {
  if (!isUniqueViolation(error)) {
    return false;
  }
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  if (Array.isArray(target)) {
    return target.includes(field);
  }
  return true;
}

// Quality Audit 2026-08-23, revue post-fix #1 — P2028 : Prisma abandonne une
// transaction interactive qui dépasse son maxWait/timeout par défaut (2s/5s),
// notamment sous forte contention sur un SELECT...FOR UPDATE (double-clic
// "Émettre" côté caissier). Sans ce garde, l'erreur brute de Prisma remonte en
// 500 générique alors que les autres branches d'erreur de issue() renvoient
// toutes un 409 explicite.
export function isTransactionTimeout(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2028";
}
