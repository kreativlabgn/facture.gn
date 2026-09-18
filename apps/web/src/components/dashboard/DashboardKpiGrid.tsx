"use client";

import { KpiTile } from "@/components/ui";

export interface KpiData {
  factureTotal: string;
  encaisseTotal: string;
  aRecevoirTotal: string;
  enRetardTotal: string;
}

export interface DashboardKpiGridProps {
  metrics: KpiData;
}

export default function DashboardKpiGrid({ metrics }: DashboardKpiGridProps) {
  return (
    <section className="space-y-4" aria-label="Indicateurs de facturation">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          libelle="Total facturé"
          valeur={`${metrics.factureTotal} GNF`}
          note="Volume des émissions validées"
          mono
        />
        <KpiTile
          libelle="Encaissé"
          valeur={`${metrics.encaisseTotal} GNF`}
          note="Flux encaissé et rapproché"
          mono
        />
        <KpiTile
          libelle="À recevoir"
          valeur={`${metrics.aRecevoirTotal} GNF`}
          note="Factures en attente de règlement"
          mono
        />
        <KpiTile
          libelle="En retard"
          valeur={`${metrics.enRetardTotal} GNF`}
          note="Échéances dépassées à recouvrer"
          mono
          alerte
        />
      </div>
      <p className="text-right font-mono text-[10px] text-navy-600">
        [MONITEUR] Totaux fournis par le service de métriques
      </p>
    </section>
  );
}
