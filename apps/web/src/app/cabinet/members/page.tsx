import type { Metadata } from "next";
import { requireSessionToken } from "@/lib/session";
import { listMyPractices, listPracticeMembers } from "@/lib/trust-api";
import { InviteMemberForm } from "./InviteMemberForm";

export const metadata: Metadata = { title: "Collaborateurs — facture.gn" };

const ROLE_LABELS: Record<string, string> = {
  practice_admin: "Administrateur du cabinet",
  accountant_external: "Comptable externe",
  business_manager: "Gestionnaire",
};

export default async function CabinetMembersPage() {
  const token = await requireSessionToken();
  const practices = await listMyPractices(token);
  const practice = practices[0];
  if (!practice) {
    return null;
  }

  const members = await listPracticeMembers(token, practice.id);

  return (
    <div>
      <h1 className="mb-6 font-display text-2xl font-bold text-navy-950">Collaborateurs</h1>

      <div className="mb-6 rounded-2xl border border-navy-100 bg-white">
        {members.length === 0 ? (
          <p className="p-8 text-center text-sm text-navy-600">Aucun collaborateur pour le moment.</p>
        ) : (
          members.map((member, index) => (
            <div
              key={member.id}
              className={`flex items-center justify-between gap-4 px-5 py-4 ${index === members.length - 1 ? "" : "border-b border-navy-50"}`}
            >
              <span className="font-semibold text-navy-950">{member.user.name}</span>
              <span className="text-xs text-navy-600">{ROLE_LABELS[member.role] ?? member.role}</span>
            </div>
          ))
        )}
      </div>

      {/* Invitation réservée à practice_admin — même garde côté serveur
          (PracticesService.inviteMember), défense en profondeur, pas une
          confiance aveugle au rendu conditionnel ici. */}
      {practice.role === "practice_admin" ? <InviteMemberForm /> : null}
    </div>
  );
}
