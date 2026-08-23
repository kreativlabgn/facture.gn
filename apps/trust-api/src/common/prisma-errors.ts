export function isUniqueConstraintViolation(error: unknown, field: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "P2002" &&
    Array.isArray((error as { meta?: { target?: unknown } }).meta?.target) &&
    (error as { meta: { target: string[] } }).meta.target.includes(field)
  );
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
