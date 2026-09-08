import type { Metadata } from "next";
import { canManageMandates } from "@/lib/cabinet-nav";
import { resolveActivePractice } from "@/lib/active-practice";
import { requireSessionToken } from "@/lib/session";
import { listPracticeMandates } from "@/lib/trust-api";
import { RequestMandateForm } from "./RequestMandateForm";
import { acceptMandateRequestAction, revokeMandateAction } from "./actions";

export const metadata: Metadata = { title: "Mandats — facture.gn" };

export default async function CabinetMandatesPage() {
  const token = await requireSessionToken();
  const { active: practice } = await resolveActivePractice(token);
  if (!practice) {
    return null;
  }

  const mandates = await listPracticeMandates(token, practice.id);
  // Même source que la navigation du cabinet — une seule recopie du RBAC
  // backend (assertPracticeAdmin), pas une comparaison de chaîne par écran.
  const canManage = canManageMandates(practice.role);

  return (
    <div>
      <h1 className="mb-6 font-display text-2xl font-bold text-navy-950">Mandats</h1>

      <div className="mb-6 rounded-2xl border border-navy-100 bg-white">
        {mandates.length === 0 ? (
          <p className="p-8 text-center text-sm text-navy-600">Aucun mandat pour le moment.</p>
        ) : (
          mandates.map((mandate, index) => (
            <div
              key={mandate.id}
              className={`flex items-center justify-between gap-4 px-5 py-4 ${index === mandates.length - 1 ? "" : "border-b border-navy-50"}`}
            >
              <span className="font-semibold text-navy-950">{mandate.organization.name}</span>
              <div className="flex items-center gap-3">
                <MandateStatusBadge status={mandate.status} />
                {/* Boutons réservés à practice_admin — même garde côté serveur
                    (assertPracticeAdmin dans revoke()/acceptAsPractice()),
                    défense en profondeur. */}
                {canManage && mandate.status === "active" ? (
                  <form action={revokeMandateAction}>
                    <input type="hidden" name="mandateId" value={mandate.id} />
                    <button type="submit" className="text-xs font-medium text-red-text hover:underline">
                      Révoquer
                    </button>
                  </form>
                ) : null}
                {canManage && mandate.status === "pending" && mandate.initiatedBy === "organization" ? (
                  <form action={acceptMandateRequestAction}>
                    <input type="hidden" name="mandateId" value={mandate.id} />
                    <button type="submit" className="text-xs font-medium text-navy-950 hover:underline">
                      Accepter
                    </button>
                  </form>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>

      {canManage ? <RequestMandateForm /> : null}
    </div>
  );
}

function MandateStatusBadge({ status }: { status: string }) {
  if (status === "active") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-bg px-2.5 py-1 font-mono text-[11px] font-bold text-green-text">
        ● Actif
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-navy-50 px-2.5 py-1 font-mono text-[11px] font-bold text-navy-600">
      En attente
    </span>
  );
}
