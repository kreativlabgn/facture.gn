-- Console infrastructure — autorisation plateforme vérifiée à chaque requête.
ALTER TABLE "user"
  ADD COLUMN "is_platform_admin" BOOLEAN NOT NULL DEFAULT false;