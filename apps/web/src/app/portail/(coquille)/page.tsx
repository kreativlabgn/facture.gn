import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { formatDate, formatGnf } from "@/lib/format";
import { chargerPortail, resteARegler } from "@/lib/portal";
import { getPortalToken } from "@/lib/portal-session";
import type { PortalOrganizationSummary } from "@/lib/trust-api";
import { StatusPill } from "@/components/StatusPill";
import { Card } from "@/components/ui";

export const metadata: Metadata = { title: "Portail acheteur — facture.gn" };

// Accueil du portail : ce que l'acheteur doit à qui, et ce qui attend un
// règlement. Rien d'autre.
//
// PAS DE LISTE DE NOTIFICATIONS, contrairement à la maquette
// (`cli-notifications-list`) : le module `notifications` de trust-api n'expose
// AUCUN contrôleur — il envoie des SMS et des messages WhatsApp, il n'en garde
// pas d'historique lisible. Afficher un bloc vide en attendant serait une
// promesse non tenue ; les factures à régler sont le vrai signal, et elles
// existent.
const APERCU = 5;

export default async function PortailAccueilPage() {
  const token = await getPortalToken();
  if (!token) {
    redirect("/portail/auth");
  }

  const { comptes, lignes, totalDu } = await chargerPortail(token);
  const aRegler = resteARegler(lignes);

  return (
    <div className="flex flex-col gap-6">
      {/* Position globale */}
      <Card>
        <div className="p-6">
          <p className="text-xs font-semibold tracking-wide text-navy-600 uppercase">
            Total que vous devez
          </p>
          <p className="mt-1 font-mono text-3xl font-bold tabular-nums text-navy-950">
            {formatGnf(totalDu)}
          </p>
          <p className="mt-2 text-sm text-navy-600">
            {comptes.length === 0
              ? "Aucune entreprise ne vous a encore facturé sur ce numéro."
              : comptes.length === 1
                ? `Chez ${comptes[0].organizationName}.`
                : `Réparti entre ${comptes.length} entreprises.`}
          </p>
        </div>
      </Card>

      {/* Comptes */}
      {comptes.length > 0 ? (
        <section>
          <h2 className="mb-3 font-display text-lg font-semibold text-navy-950">Vos comptes</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {comptes.map((compte) => (
              <CarteCompte key={compte.customerId} compte={compte} />
            ))}
          </div>
        </section>
      ) : null}

      {/* À régler */}
      <section>
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <h2 className="font-display text-lg font-semibold text-navy-950">À régler</h2>
          {aRegler.length > APERCU ? (
            <Link
              href="/portail/factures"
              className="text-sm font-medium text-navy-950 underline underline-offset-2"
            >
              Tout voir
            </Link>
          ) : null}
        </div>
        <Card>
          {aRegler.length === 0 ? (
            <p className="p-8 text-center text-sm text-navy-600">
              Rien à régler. Toutes vos factures sont soldées.
            </p>
          ) : (
            <ul className="divide-y divide-navy-50">
              {aRegler.slice(0, APERCU).map(({ compte, facture }) => (
                <li key={facture.id}>
                  <Link
                    href={`/portail/${encodeURIComponent(facture.id)}`}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4 transition-colors hover:bg-navy-50 focus-visible:bg-navy-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-navy-950"
                  >
                    <span className="flex flex-col gap-0.5">
                      <span className="text-sm text-navy-950">{compte.organizationName}</span>
                      <span className="font-mono text-xs text-navy-600">
                        {facture.number ?? "—"} · {formatDate(facture.createdAt)}
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="font-mono text-sm font-bold tabular-nums text-navy-950">
                        {formatGnf(facture.totalTtc)}
                      </span>
                      <StatusPill status={facture.status} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}

// Le plafond est souvent absent — l'API rend `creditLimit: null` quand
// l'entreprise n'en a fixé aucun. On affiche alors l'encours seul plutôt
// qu'une barre de progression sans dénominateur.
function CarteCompte({ compte }: { compte: PortalOrganizationSummary }) {
  const encours = BigInt(compte.runningBalance);
  const plafond = compte.creditLimit === null ? null : BigInt(compte.creditLimit);
  const pourcentage =
    plafond !== null && plafond > BigInt(0) ? Number((encours * BigInt(100)) / plafond) : null;
  // Au-delà de 85 % du plafond, la prochaine facture peut être refusée : le
  // signal doit changer de nature, pas seulement de longueur.
  const tendu = pourcentage !== null && pourcentage > 85;

  return (
    <Card>
      <div className="flex flex-col gap-3 p-5">
        <p className="truncate font-display text-sm font-semibold text-navy-950">
          {compte.organizationName}
        </p>
        <p className="font-mono text-lg font-bold tabular-nums text-navy-950">
          {formatGnf(compte.runningBalance)}
        </p>

        {pourcentage !== null ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between text-xs text-navy-600">
              <span>Plafond {formatGnf(compte.creditLimit!)}</span>
              <span className="font-mono tabular-nums">{Math.min(pourcentage, 100)} %</span>
            </div>
            <div
              role="progressbar"
              aria-valuenow={Math.min(pourcentage, 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Part du plafond utilisée chez ${compte.organizationName}`}
              className="h-2 w-full overflow-hidden rounded-full bg-navy-50"
            >
              <div
                className={`h-full ${tendu ? "bg-bad" : "bg-or"}`}
                style={{ width: `${Math.min(pourcentage, 100)}%` }}
              />
            </div>
            {tendu ? (
              <p className="text-xs text-bad-text">
                Vous approchez du plafond fixé par cette entreprise.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-navy-600">Aucun plafond fixé pour votre compte.</p>
        )}
      </div>
    </Card>
  );
}
