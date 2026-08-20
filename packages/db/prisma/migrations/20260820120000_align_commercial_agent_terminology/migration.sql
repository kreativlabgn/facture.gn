-- ADR-107 — aligne le schema sur la terminologie corrigée (Agent commercial
-- terrain, distinct du role RBAC field_agent). Corrige aussi un bug fonctionnel :
-- RegistrationSource n'avait jamais recu la valeur agent_terrain, donc
-- OrganizationsService.createAssisted() retombait silencieusement sur "organic".

-- AlterEnum
ALTER TYPE "RegistrationSource" ADD VALUE 'agent_terrain';

-- RenameColumn
ALTER TABLE "user" RENAME COLUMN "is_field_agent" TO "is_commercial_agent";
ALTER TABLE "assisted_session" RENAME COLUMN "field_agent_user_id" TO "commercial_agent_user_id";

-- RenameForeignKey
ALTER TABLE "assisted_session" RENAME CONSTRAINT "assisted_session_field_agent_user_id_fkey" TO "assisted_session_commercial_agent_user_id_fkey";
