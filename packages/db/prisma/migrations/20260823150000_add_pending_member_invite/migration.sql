-- F10 — invitation d'un collaborateur (organisation ou cabinet) sans compte
-- facture.gn existant, résolution différée à l'inscription.
CREATE TABLE "pending_member_invite" (
    "id" TEXT NOT NULL,
    "msisdn" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "organization_id" TEXT,
    "practice_id" TEXT,
    "invited_by_user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "resolved_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_member_invite_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pending_member_invite_msisdn_idx" ON "pending_member_invite"("msisdn");

ALTER TABLE "pending_member_invite" ADD CONSTRAINT "pending_member_invite_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pending_member_invite" ADD CONSTRAINT "pending_member_invite_practice_id_fkey" FOREIGN KEY ("practice_id") REFERENCES "professional_practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pending_member_invite" ADD CONSTRAINT "pending_member_invite_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pending_member_invite" ADD CONSTRAINT "pending_member_invite_resolved_user_id_fkey" FOREIGN KEY ("resolved_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
