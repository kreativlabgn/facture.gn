import type { Metadata } from "next";
import { Card, CardBody } from "@/components/ui";
import DashboardKpiGrid from "@/components/dashboard/DashboardKpiGrid";
import SovereignLedgerTable from "@/components/dashboard/SovereignLedgerTable";

export const metadata: Metadata = { title: "Infrastructure — facture.gn" };

const DEMO_METRICS = {
  factureTotal: "1 450 000 000",
  encaisseTotal: "980 500 000",
  aRecevoirTotal: "419 500 000",
  enRetardTotal: "50 000 000",
};

const DEMO_INVOICES = [
  {
    id: "demo-fac-1",
    referenceMarche: "MPA-2026-00417",
    clientName: "Ministère de l'Énergie et de l'Hydraulique",
    totalTtc: "450 000 000",
    disputeStatus: "none" as const,
    validatedByAdministration: true,
  },
  {
    id: "demo-fac-2",
    referenceMarche: "MPA-2026-00892",
    clientName: "Établissements Diallo et Frères",
    totalTtc: "50 000 000",
    disputeStatus: "disputed" as const,
    validatedByAdministration: false,
  },
  {
    id: "demo-fac-3",
    referenceMarche: "MPA-2026-01104",
    clientName: "Société Guinéenne d'Électricité",
    totalTtc: "950 000 000",
    disputeStatus: "none" as const,
    validatedByAdministration: false,
  },
];

export default function AdminInfrastructurePage() {
  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <p className="text-xs font-semibold tracking-wide text-navy-600 uppercase">Administration plateforme</p>
        <h1 className="font-display text-2xl font-bold text-navy-950">Console Infrastructure</h1>
        <p className="text-sm text-navy-600">
          Aperçu des services, des engagements publics et des flux de trésorerie PME.
        </p>
      </header>

      <p className="rounded-md border border-amber-200 bg-amber-bg px-4 py-3 text-xs text-amber-text" role="note">
        Données de démonstration : les métriques infrastructure et le registre seront branchés sur leurs services dédiés dans un chantier ultérieur.
      </p>

      <DashboardKpiGrid metrics={DEMO_METRICS} />

      <section className="space-y-2">
        <h2 className="pl-1 text-xs font-semibold tracking-wide text-navy-600 uppercase">
          Créances liées aux marchés publics
        </h2>
        <SovereignLedgerTable invoices={DEMO_INVOICES} />
      </section>

      <Card>
        <CardBody className="flex items-center justify-between gap-4 bg-navy-50 p-4 font-mono text-[10px] text-navy-600">
          <span>[SYS] PostgreSQL 16 · RLS · certificats Ed25519</span>
          <span className="font-bold text-green-text">État à confirmer par les métriques</span>
        </CardBody>
      </Card>
    </main>
  );
}
