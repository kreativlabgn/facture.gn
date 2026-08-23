import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "isPublic";

// Security Audit 2026-08-23, finding #16 — marque qu'une route a été
// explicitement pensée (public par conception, ou protégée par son propre
// guard — InternalAuthGuard, vérification de signature HMAC dans le service...).
// Lu par ExplicitAuthGuard (require-explicit-auth.guard.ts). Sans rapport avec
// une vraie authentification (contrairement à son homonyme trust-api/auth/
// public.decorator.ts) : money-api n'a aucun acteur JWT humain, cette route est
// une simple tripwire structurelle.
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
