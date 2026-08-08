export function isUniqueConstraintViolation(error: unknown, field: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "P2002" &&
    Array.isArray((error as { meta?: { target?: unknown } }).meta?.target) &&
    (error as { meta: { target: string[] } }).meta.target.includes(field)
  );
}
