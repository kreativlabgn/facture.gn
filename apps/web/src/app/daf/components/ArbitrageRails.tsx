import { Badge } from "@/components/ui";
import { formatDate, formatGnf } from "@/lib/format";
import { isSecondaryFinancingLocked, netVerseALaPme, railOf } from "@/lib/daf";
import type { PublicBuyerInvoice } from "@/lib/trust-api";

// ─────────────────────────────────────────────────────────────────────────────
// VOLET D'ARBITRAGE DES RAILS DE FINANCEMENT — ADR-088/089, K4/K5.
//
// Ce composant est en LECTURE SEULE, et c'est une décision, pas un raccourci.
//
// Le choix du rail appartient à l'owner/admin de la PME : c'est sa créance
// qu'elle cède. Côté trust-api, POST /invoices/:id/financing porte
// @Roles("owner","admin") avec la résolution d'organisation par défaut — un DAF
// n'étant OrganizationMember d'AUCUNE PME, RolesGuard le rejetterait
// systématiquement. Le plan du 19/08 le dit sans ambiguïté : « décide du rail —
// jamais le DAF, qui a déjà joué son rôle via validateLiquidation(), J1 ».
// Un formulaire d'affectation de partenaire rendu ici serait donc soit un
// bouton qui échoue à chaque clic, soit un affaiblissement de l'autorisation
// d'un endpoint qui engage un montant réel. Ni l'un ni l'autre n'est acceptable.
//
// Ce que le DAF a besoin de savoir, en revanche, est réel et lui manque
// aujourd'hui : À QUI devra-t-il régler. Une créance cédée se règle au
// partenaire, plus au fournisseur — c'est l'information que ce volet porte.
// ─────────────────────────────────────────────────────────────────────────────

// Le service ne renvoie que l'identifiant du partenaire : aucune relation
// `financedByPartner` n'est incluse, et le DAF n'a aucune route pour résoudre
// un nom de partenaire. On rend donc la référence brute en mono plutôt qu'un
// nom d'établissement — afficher « Ecobank » sans l'avoir lu quelque part
// serait une invention sur un écran comptable.
function ReferencePartenaire({ partnerId }: { partnerId: string }) {
  return (
    <div className="mt-3">
      <p className="text-xs font-semibold text-navy-600">Référence du cessionnaire</p>
      <p className="mt-1 font-mono text-[13px] font-bold break-all text-navy-950">{partnerId}</p>
    </div>
  );
}

export function ArbitrageRails({ invoice }: { invoice: PublicBuyerInvoice }) {
  const rail = railOf(invoice);
  const verrouille = isSecondaryFinancingLocked(invoice);

  return (
    <section aria-label="Arbitrage du rail de règlement" className="mt-4 border-t border-navy-100 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-sm font-bold text-navy-950">Rail de règlement</h3>
        {/* K5 — le verrou est ANNONCÉ, jamais seulement appliqué : un DAF qui
            ne voit pas pourquoi une action manque la cherche ailleurs. */}
        {verrouille ? <Badge tone="blue">◆ Cession enregistrée</Badge> : <Badge tone="navy">○ Aucune cession</Badge>}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {/* ── RAIL A ─────────────────────────────────────────────────────── */}
        <div
          className={`rounded-xl border p-3 ${
            rail === "A" ? "border-blue bg-blue-bg" : "border-navy-100 bg-white"
          }`}
        >
          <p className="font-display text-xs font-bold text-navy-950">Rail A — Avance partenaire</p>
          <p className="mt-1.5 text-xs text-navy-600">
            La créance a été cédée à un établissement financier, qui a payé le fournisseur par avance.
            Le règlement de l&apos;administration lui revient désormais.
          </p>

          {rail === "A" ? (
            <>
              <div className="mt-3">
                <p className="text-xs font-semibold text-navy-600">Net versé au fournisseur</p>
                {/* ADR-089 — les frais de décaissement sont portés par
                    l'établissement financier, jamais déduits du montant
                    certifié. Le net est donc le total TTC, à l'unité près. */}
                <p className="mt-1 font-mono text-base font-bold text-navy-950">
                  {formatGnf(netVerseALaPme(invoice))}
                </p>
                <p className="mt-1.5 text-xs text-navy-600">
                  Intégralité du montant certifié. Les frais de décaissement sont à la charge de
                  l&apos;établissement financier — jamais déduits de ce que reçoit le fournisseur.
                </p>
              </div>
              {invoice.financedAt ? (
                <p className="mt-2 text-xs text-navy-600">
                  Cession enregistrée le{" "}
                  <span className="font-mono font-bold text-navy-950">{formatDate(invoice.financedAt)}</span>
                </p>
              ) : null}
              {invoice.financedByPartnerId ? (
                <ReferencePartenaire partnerId={invoice.financedByPartnerId} />
              ) : null}
            </>
          ) : (
            <p className="mt-3 text-xs text-navy-600">
              Rail non emprunté. Le choix appartient au fournisseur, depuis son propre espace.
            </p>
          )}
        </div>

        {/* ── RAIL B ─────────────────────────────────────────────────────── */}
        <div
          className={`rounded-xl border p-3 ${
            rail === "B" ? "border-navy-200 bg-navy-50" : "border-navy-100 bg-white"
          }`}
        >
          <p className="font-display text-xs font-bold text-navy-950">Rail B — Règlement direct</p>
          <p className="mt-1.5 text-xs text-navy-600">
            Aucun financement. Le fournisseur attend le règlement de l&apos;administration à
            l&apos;échéance convenue, sans commission.
          </p>
          {rail === "B" ? (
            <div className="mt-3">
              <p className="text-xs font-semibold text-navy-600">Reste à régler</p>
              <p className="mt-1 font-mono text-base font-bold text-navy-950">{formatGnf(invoice.amountDue)}</p>
              <p className="mt-1.5 text-xs text-navy-600">
                Commission : <span className="font-mono font-bold text-navy-950">0 %</span>
              </p>
            </div>
          ) : (
            <p className="mt-3 text-xs text-navy-600">Rail non emprunté — la créance a été cédée.</p>
          )}
        </div>
      </div>

      {/* K5, ADR-089 — LE VERROU ANTI-DOUBLE-NANTISSEMENT.
          Aucun bouton de rachat secondaire n'est rendu ici, ni actif ni désactivé :
          l'action n'existe pas dans cet arbre. Ce bloc explique l'absence, il ne
          la remplace pas par un contrôle inerte. */}
      {verrouille ? (
        <p
          role="note"
          className="mt-3 rounded-xl border border-blue bg-blue-bg px-3 py-2 text-xs text-blue-text"
        >
          Créance déjà cédée : aucun second financement n&apos;est possible sur cette facture. Le
          règlement doit être adressé au cessionnaire ci-dessus, jamais au fournisseur.
        </p>
      ) : null}
    </section>
  );
}
