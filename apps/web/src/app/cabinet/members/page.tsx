import type { Metadata } from "next";
import { resolveActivePractice } from "@/lib/active-practice";
import { canInviteMembers, canManagePractice } from "@/lib/cabinet-nav";
import { requireSessionToken } from "@/lib/session";
import { listPracticeMembers } from "@/lib/trust-api";
import { Card } from "@/components/ui";
import { InviteMemberForm } from "./InviteMemberForm";
import { RevokeMemberForm } from "./RevokeMemberForm";

export const metadata: Metadata = { title: "Collaborateurs — facture.gn" };

const ROLE_LABELS: Record<string, string> = {
  practice_admin: "Administrateur du cabinet",
  accountant_external: "Comptable externe",
  business_manager: "Gestionnaire",
};

export default async function CabinetMembersPage() {
  const token = await requireSessionToken();
  const { active: practice } = await resolveActivePractice(token);
  if (!practice) {
    return null;
  }

  const members = await listPracticeMembers(token, practice.id);
  const administre = canManagePractice(practice.role);

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-prose text-sm text-navy-600">
        Les mandats sont accordés au <strong className="text-navy-950">cabinet</strong>, jamais à une
        personne. Retirer un collaborateur coupe donc d&apos;un seul coup tous ses accès aux
        entreprises que vous suivez — il n&apos;y a aucun accès résiduel à aller chercher.
      </p>

      <Card>
        {members.length === 0 ? (
          <p className="p-8 text-center text-sm text-navy-600">Aucun collaborateur pour le moment.</p>
        ) : (
          <ul className="divide-y divide-navy-50">
            {members.map((member) => (
              <li
                key={member.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-navy-950">{member.user.name}</p>
                  <p className="mt-0.5 text-xs text-navy-600">
                    {ROLE_LABELS[member.role] ?? member.role}
                  </p>
                </div>
                {/* Réservé à practice_admin — même garde côté serveur
                    (assertPracticeAdmin), défense en profondeur et non une
                    confiance au rendu conditionnel. Le serveur refuse en outre
                    de retirer le DERNIER administrateur : un cabinet sans
                    administrateur ne peut plus ni inviter, ni mandater. */}
                {administre ? (
                  <RevokeMemberForm memberUserId={member.user.id} nom={member.user.name} />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {canInviteMembers(practice.role) ? <InviteMemberForm /> : null}
    </div>
  );
}
