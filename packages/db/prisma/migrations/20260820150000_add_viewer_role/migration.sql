-- F3, DAT §3.5 — nouveau rôle "viewer" (proche/assistant), invitable depuis la
-- PWA (inviteMember() générique, F14/H1) et depuis *620#
-- (UssdAccountService.inviteViewer()). Lecture seule stricte des factures.

-- AlterEnum
ALTER TYPE "OrganizationRole" ADD VALUE 'viewer';
