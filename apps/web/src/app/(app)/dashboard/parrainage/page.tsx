import type { Metadata } from "next";
import { resolveActiveOrganization } from "@/lib/active-organization";
import { formatDate, formatGnf } from "@/lib/format";
import { requireSessionToken } from "@/lib/session";
import { getReferralSummary, TrustApiError, type ReferralItem } from "@/lib/trust-api";
import { Badge, Card, EmptyState } from "@/components/ui";
import { ActivationForm, CodeAPartager, RattachementForm } from "./ParrainageForms";

export const metadata: Metadata = { title: "Parrainage — facture.gn" };

// Parrainage entre marchands.
//
// Miroir de referrals.constants.ts, pour l'affichage uniquement : les montants
// qui font foi sont ceux versés côté serveur et figés sur chaque ligne au
// moment du versement (referrerBonusCentimes). Si la grille change, l'historique
// affiché reste celui des primes réellement touchées.
const PRIME_PARRAIN_CENTIMES = "5000000";
const PRIME_FILLEUL_CENTIMES = "1500000";

export default async function ParrainagePage() {
  const token = await requireSessionToken();
  const { active: organization } = await resolveActiveOrganization(token);
  if (!organization) {
    return null;
  }

  let parrainage;
  try {
    parrainage = await getReferralSummary(token, organization.id);
  } catch (error) {
    if (error instanceof TrustApiError && error.status === 403) {
      return (
        <EmptyState
          title="Accès réservé"
          description="Seuls les propriétaires et administrateurs peuvent gérer le parrainage : le code engage l'organisation et la prime tombe dans son portefeuille."
        />
      );
    }
    throw error;
  }

  const convertis = parrainage.referrals.filter((f) => f.status === "converted").length;
  const enAttente = parrainage.referrals.length - convertis;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-navy-950">Parrainage</h1>
        <p className="mt-1 max-w-prose text-sm text-navy-600">
          Faites découvrir facture.gn à un autre commerçant. Quand il prend son premier abonnement
          payant, vous recevez {formatGnf(PRIME_PARRAIN_CENTIMES)} de crédits et lui{" "}
          {formatGnf(PRIME_FILLEUL_CENTIMES)}.
        </p>
      </div>

      <Card>
        <div className="flex flex-col gap-4 p-6">
          <div>
            <h2 className="font-display text-base font-semibold text-navy-950">Votre code</h2>
            <p className="mt-1 max-w-prose text-sm text-navy-600">
              {parrainage.isActive
                ? "Donnez-le au commerçant que vous parrainez : il le saisira depuis son propre tableau de bord."
                : "Activez le programme pour obtenir un code à partager."}
            </p>
          </div>

          {parrainage.referralCode ? (
            <>
              <CodeAPartager code={parrainage.referralCode} />
              <p className="max-w-prose text-xs text-navy-600">
                Ce code ne change plus : le renouveler invaliderait tous les partages déjà faits.
              </p>
            </>
          ) : (
            <ActivationForm />
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Chiffre libelle="Gains versés" valeur={formatGnf(parrainage.totalGainsCentimes)} mono />
        <Chiffre libelle="Filleuls abonnés" valeur={String(convertis)} />
        <Chiffre libelle="En attente d'abonnement" valeur={String(enAttente)} />
      </div>

      <section>
        <h2 className="mb-1 font-display text-lg font-semibold text-navy-950">Vos filleuls</h2>
        <p className="mb-3 max-w-prose text-sm text-navy-600">
          La prime est versée une seule fois, au premier abonnement payant du filleul. Passer
          ensuite à un palier supérieur ne la reverse pas.
        </p>
        <Card>
          {parrainage.referrals.length === 0 ? (
            <p className="p-8 text-center text-sm text-navy-600">
              Personne ne vous a encore rejoint avec votre code.
            </p>
          ) : (
            <ul className="divide-y divide-navy-50">
              {parrainage.referrals.map((filleul) => (
                <LigneFilleul key={filleul.id} filleul={filleul} />
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section>
        <h2 className="mb-1 font-display text-lg font-semibold text-navy-950">
          Vous avez reçu un code ?
        </h2>
        <p className="mb-3 max-w-prose text-sm text-navy-600">
          Saisissez-le <strong>avant</strong> de prendre votre abonnement : c&apos;est votre premier
          palier payant qui déclenche les deux primes. Une organisation ne peut être rattachée
          qu&apos;à un seul parrain, et le rattachement est définitif.
        </p>
        <Card>
          <div className="p-6">
            <RattachementForm />
          </div>
        </Card>
      </section>

      <p className="max-w-prose text-xs leading-relaxed text-navy-600">
        Les primes sont versées en crédits, pas en espèces : ils financent vos relances par SMS et
        WhatsApp, et apparaissent dans votre relevé de crédits.
      </p>
    </div>
  );
}

function Chiffre({ libelle, valeur, mono }: { libelle: string; valeur: string; mono?: boolean }) {
  return (
    <Card>
      <div className="p-5">
        <p className="text-xs font-semibold tracking-wide text-navy-600 uppercase">{libelle}</p>
        <p
          className={`mt-1 text-xl font-bold text-navy-950 ${mono ? "font-mono tabular-nums" : "font-display"}`}
        >
          {valeur}
        </p>
      </div>
    </Card>
  );
}

function LigneFilleul({ filleul }: { filleul: ReferralItem }) {
  const converti = filleul.status === "converted";

  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 py-4">
      <div className="flex flex-col gap-1">
        {/* Nom recopié au rattachement : sous RLS, cette organisation-ci ne peut
            pas lire celle du filleul. Un changement de raison sociale chez lui
            ne se reflète donc pas ici — et c'est le prix de l'isolation. */}
        <span className="text-sm text-navy-950">{filleul.referredName}</span>
        <span className="flex flex-wrap items-center gap-2">
          <Badge tone={converti ? "good" : "navy"}>
            {converti ? "Abonné" : "En attente d'abonnement"}
          </Badge>
          <span className="text-xs text-navy-600">
            Rejoint le {formatDate(filleul.createdAt)}
            {converti && filleul.convertedAt ? ` · abonné le ${formatDate(filleul.convertedAt)}` : ""}
          </span>
        </span>
      </div>
      <div className="text-right">
        {filleul.referrerBonusCentimes ? (
          <p className="font-mono text-sm font-bold tabular-nums text-good-text">
            +{formatGnf(filleul.referrerBonusCentimes)}
          </p>
        ) : (
          <p className="text-xs text-navy-600">Prime à venir</p>
        )}
      </div>
    </li>
  );
}
