import type { Metadata } from "next";
import Link from "next/link";
import { formatDate, formatGnf } from "@/lib/format";
import { chargerPortail, type LigneFacture } from "@/lib/portal";
import { getPortalToken } from "@/lib/portal-session";
import { TrustApiError, type PortalOrganizationSummary } from "@/lib/trust-api";
import { StatusPill } from "@/components/StatusPill";
import { ButtonLink, Card } from "@/components/ui";
import { OtpTunnel } from "@/app/portail/OtpTunnel";

export const metadata: Metadata = { title: "Votre facture — facture.gn" };

// Portail acheteur (F13, ADR-096). L'URL désigne UNE facture — c'est le lien
// qu'on reçoit par SMS — mais l'API, elle, est centrée sur la PERSONNE : l'OTP
// s'adresse à un numéro et ouvre l'accès à toutes les factures que ce numéro a
// reçues. Aucune route ne rend une facture seule.
//
// Cette page fait donc la jonction : elle authentifie le numéro, liste les
// comptes de l'acheteur, puis retrouve la facture demandée dans sa liste. Une
// facture absente de cette liste n'est pas adressée à ce numéro — et le message
// le dit sans jamais confirmer qu'elle existe ailleurs.
//
// À ne pas confondre avec /pay/[invoiceId], qui sert le payeur SANS COMPTE
// arrivé par un lien de paiement : celui-là passe par money-api, affiche les
// frais de passerelle et redirige vers l'opérateur. Les deux coexistent.

export default async function PortailFacturePage({
  params,
}: {
  params: Promise<{ invoiceId: string }>;
}) {
  const { invoiceId } = await params;
  const token = await getPortalToken();

  if (!token) {
    // Pas de redirection vers /portail/auth : on garde l'URL de la facture,
    // pour y revenir dès le code validé. C'est le lien reçu par SMS, il ne
    // doit pas se perdre en chemin.
    return (
      <OtpTunnel
        retour={`/portail/${encodeURIComponent(invoiceId)}`}
        titre="Consulter cette facture"
        intro="Nous vous envoyons un code par SMS pour confirmer que cette facture vous est bien adressée."
      />
    );
  }

  return <VueFacture token={token} invoiceId={invoiceId} />;
}

async function VueFacture({ token, invoiceId }: { token: string; invoiceId: string }) {
  let comptes: PortalOrganizationSummary[];
  let lignes: LigneFacture[];
  try {
    ({ comptes, lignes } = await chargerPortail(token));
  } catch (error) {
    // Token expiré ou révoqué : on retombe sur le tunnel plutôt que d'afficher
    // une erreur technique à un acheteur qui n'y peut rien.
    if (error instanceof TrustApiError && (error.status === 401 || error.status === 403)) {
      return <OtpTunnel retour={`/portail/${encodeURIComponent(invoiceId)}`} />;
    }
    throw error;
  }

  // Un même numéro peut être client de plusieurs entreprises : la facture est
  // cherchée dans l'ensemble, et le compte qui la porte donne l'encours.
  const trouvee = lignes.find((ligne) => ligne.facture.id === invoiceId);

  if (!trouvee) {
    return <Introuvable comptes={comptes} lignes={lignes} />;
  }

  const { compte, facture } = trouvee;
  const reglee = facture.status === "paid";

  return (
    <div className="flex flex-col gap-6">
      {/* Émetteur */}
      <Card>
        <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-wide text-navy-600 uppercase">Émise par</p>
            <h1 className="font-display text-xl font-bold text-navy-950">{compte.organizationName}</h1>
          </div>
          <div className="sm:text-right">
            <p className="text-xs font-semibold tracking-wide text-navy-600 uppercase">Facture</p>
            <p className="font-mono text-lg font-bold text-navy-950">{facture.number ?? "—"}</p>
            <p className="mt-1 text-xs text-navy-600">Émise le {formatDate(facture.createdAt)}</p>
          </div>
        </div>
      </Card>

      {/* Montant et règlement */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card>
          <div className="flex h-full flex-col justify-between gap-4 p-6">
            <div>
              <p className="text-xs font-semibold tracking-wide text-navy-600 uppercase">Montant</p>
              <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-navy-950">
                {formatGnf(facture.totalTtc)}
              </p>
            </div>
            <div>
              <StatusPill status={facture.status} />
            </div>
          </div>
        </Card>

        <Card>
          <div className="flex h-full flex-col justify-between gap-4 p-6">
            <div>
              <p className="font-display text-sm font-semibold text-navy-950">Régler cette facture</p>
              <p className="mt-1 text-sm text-navy-600">
                {reglee
                  ? "Cette facture est soldée. Rien ne reste à payer."
                  : "Le montant et les frais vous sont montrés avant tout paiement."}
              </p>
            </div>
            {reglee ? null : (
              <ButtonLink href={`/pay/${encodeURIComponent(facture.id)}`} variant="accent">
                Payer maintenant
              </ButtonLink>
            )}
          </div>
        </Card>
      </div>

      {/* Encours chez cette entreprise */}
      <Encours compte={compte} />

      {/* Certification */}
      {facture.certificationId ? (
        <Card>
          <div className="p-6">
            <p className="text-xs font-semibold tracking-wide text-navy-600 uppercase">
              Identifiant de vérification
            </p>
            <p className="mt-1 font-mono text-sm break-all text-navy-950">{facture.certificationId}</p>
            <Link
              href={`/${encodeURIComponent(facture.certificationId)}`}
              className="mt-3 inline-block text-sm font-medium text-navy-950 underline underline-offset-2"
            >
              Vérifier l&apos;authenticité de cette facture
            </Link>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

// L'encours vient du compte (GET /client-portal/organizations), pas de la
// facture : c'est une position globale chez cette entreprise, pas une propriété
// du document. Le plafond est souvent absent — l'API rend `creditLimit: null`
// quand l'entreprise n'en a posé aucun. On affiche alors l'encours seul plutôt
// qu'une barre de progression sans dénominateur.
function Encours({ compte }: { compte: PortalOrganizationSummary }) {
  // BigInt(0) / BigInt(100) et non 0n / 100n : le tsconfig du web cible sous
  // ES2020, où les littéraux BigInt ne compilent pas. Même écriture que
  // formatGnf, pour la même raison.
  const encours = BigInt(compte.runningBalance);
  const plafond = compte.creditLimit === null ? null : BigInt(compte.creditLimit);
  const pourcentage =
    plafond !== null && plafond > BigInt(0)
      ? Number((encours * BigInt(100)) / plafond)
      : null;

  return (
    <Card>
      <div className="p-6">
        <p className="text-xs font-semibold tracking-wide text-navy-600 uppercase">
          Votre encours chez {compte.organizationName}
        </p>
        <p className="mt-1 font-mono text-lg font-bold tabular-nums text-navy-950">
          {formatGnf(compte.runningBalance)}
          {plafond !== null ? (
            <span className="text-sm font-normal text-navy-600"> sur {formatGnf(compte.creditLimit!)}</span>
          ) : null}
        </p>

        {pourcentage !== null ? (
          <div
            role="progressbar"
            aria-valuenow={Math.min(pourcentage, 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Part du plafond utilisée"
            className="mt-3 h-2 w-full overflow-hidden rounded-full bg-navy-50"
          >
            <div className="h-full bg-or" style={{ width: `${Math.min(pourcentage, 100)}%` }} />
          </div>
        ) : (
          <p className="mt-2 text-xs text-navy-600">
            Cette entreprise n&apos;a pas fixé de plafond pour votre compte.
          </p>
        )}

        <p className="mt-3 text-xs text-navy-600">
          Total de vos factures encore dues chez cet émetteur, toutes factures confondues.
        </p>
      </div>
    </Card>
  );
}

// Message unique, qu'il s'agisse d'une facture inexistante ou d'une facture
// adressée à quelqu'un d'autre : trust-api applique déjà cette opacité sur ses
// 404, et distinguer les deux ici la reprendrait d'une main ce qu'elle donne de
// l'autre — on confirmerait à un curieux qu'un identifiant existe bien.
function Introuvable({
  comptes,
  lignes,
}: {
  comptes: PortalOrganizationSummary[];
  lignes: LigneFacture[];
}) {

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <div className="p-6">
          <h1 className="font-display text-xl font-bold text-navy-950">Facture introuvable</h1>
          <p className="mt-2 text-sm text-navy-600">
            Cette facture n&apos;est pas adressée au numéro que vous avez confirmé. Si vous en
            utilisez plusieurs, réessayez avec celui que le commerçant a enregistré.
          </p>
        </div>
      </Card>

      {lignes.length > 0 ? (
        <Card>
          <div className="border-b border-navy-50 px-6 py-4">
            <h2 className="font-display text-base font-semibold text-navy-950">
              Vos factures {comptes.length > 1 ? `(${comptes.length} émetteurs)` : ""}
            </h2>
          </div>
          <ul className="divide-y divide-navy-50">
            {lignes.map(({ compte, facture }) => (
              <li key={facture.id} className="px-6 py-3">
                <Link
                  href={`/portail/${encodeURIComponent(facture.id)}`}
                  className="flex flex-wrap items-center justify-between gap-3"
                >
                  <span className="flex flex-col">
                    <span className="font-mono text-xs text-navy-600">{facture.number ?? "—"}</span>
                    <span className="text-xs text-navy-600">{compte.organizationName}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="font-mono text-sm font-bold text-navy-950">
                      {formatGnf(facture.totalTtc)}
                    </span>
                    <StatusPill status={facture.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
