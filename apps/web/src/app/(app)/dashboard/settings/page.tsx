import type { Metadata } from "next";
import Link from "next/link";
import { requireSessionToken } from "@/lib/session";
import { resolveActiveOrganization } from "@/lib/active-organization";
import {
  getOrganization,
  getTrustScore,
  listApiKeys,
  listBranches,
  listOrganizationMembers,
  TrustApiError,
  type ApiKeyItem,
  type BranchItem,
  type OrganizationMemberItem,
} from "@/lib/trust-api";
import { formatDate, formatGnf } from "@/lib/format";
import { formatVerifiedPaymentRatio } from "@/lib/kpi";
import { roleLabel } from "@/lib/permissions";
import {
  PDP_GATEWAY_MIN_TIER,
  passerelleePdpAutorisee,
  quotaAtteint,
  quotaMembres,
  quotaSuccursales,
  tierIndex,
  tierLabel,
  type Tier,
} from "@/lib/plans";
import { SETTINGS_TABS, resolveSettingsTab, type SettingsTab } from "@/lib/settings-tabs";
import { Badge, ButtonLink, Card, CardBody, DataField, EmptyState } from "@/components/ui";
import {
  ApiKeyForm,
  BranchForm,
  InviteMemberForm,
  RevokeApiKeyForm,
  RevokeMemberForm,
} from "./SettingsForms";

export const metadata: Metadata = { title: "Paramètres — facture.gn" };

// Les paramètres marchands en QUATRE onglets : identité légale, succursales,
// équipe, clés API. Les trois derniers ouvrent des modules de trust-api servis
// jusqu'ici sans aucune interface — une organisation pouvait accorder un accès
// sans jamais pouvoir le reprendre, et créer une succursale sans jamais voir
// celles qu'elle avait déjà.
//
// L'onglet vit dans l'URL (`?tab=`), jamais dans un état React : voir
// lib/settings-tabs.ts. Chaque onglet charge SES données et rien d'autre —
// venir corriger son NIF ne doit pas coûter trois requêtes qu'on ne regardera
// pas.
//
// Toute la page est owner/admin : l'entrée de navigation l'est déjà (nav.ts,
// permission organization:read), et GET /organizations/:id rend 403 pour tous
// les autres.

const REGIME_LABELS: Record<string, string> = {
  normal_tva: "Normal TVA",
  tpu: "TPU",
  normal_sans_tva: "Normal sans TVA",
  non_assujetti_association: "Non assujetti (association)",
};

const BRANCH_TYPE_LABELS: Record<string, string> = {
  boutique: "Boutique",
  entrepot: "Entrepôt",
  agence: "Agence",
  en_ligne: "En ligne",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [token, params] = await Promise.all([requireSessionToken(), searchParams]);
  const { active: organization } = await resolveActiveOrganization(token);
  if (!organization) {
    return null;
  }

  const onglet = resolveSettingsTab(params.tab);

  // GET /organizations/:id est chargé pour TOUS les onglets, et pas seulement
  // pour l'identité : c'est lui qui porte le 403 gardant la page, et le palier
  // commercial dont dépendent les quotas des trois autres.
  let detail;
  try {
    detail = await getOrganization(token, organization.id);
  } catch (error) {
    if (error instanceof TrustApiError && error.status === 403) {
      return (
        <EmptyState
          title="Accès réservé"
          description="Seuls les propriétaires et administrateurs de l'organisation peuvent consulter les paramètres."
        />
      );
    }
    throw error;
  }

  const palier = detail.commercialTier as Tier;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold text-navy-950">Paramètres</h1>
        <ButtonLink href="/dashboard/abonnement" variant="secondary">
          Palier {tierLabel(palier)}
        </ButtonLink>
      </div>

      <Onglets actif={onglet} />

      {onglet === "identite" ? (
        <OngletIdentite
          token={token}
          organizationId={organization.id}
          detail={detail}
          palier={palier}
        />
      ) : null}
      {onglet === "succursales" ? (
        <OngletSuccursales token={token} organizationId={organization.id} palier={palier} />
      ) : null}
      {onglet === "equipe" ? (
        <OngletEquipe token={token} organizationId={organization.id} palier={palier} />
      ) : null}
      {onglet === "api" ? (
        <OngletApi token={token} organizationId={organization.id} palier={palier} />
      ) : null}
    </div>
  );
}

// Des LIENS, jamais des boutons : changer d'onglet est une navigation, elle
// s'annonce comme telle au lecteur d'écran et s'ouvre dans un onglet du
// navigateur si on le demande. L'état actif est porté par trois signaux — le
// poids, le rail sous l'entrée, et aria-current — jamais par la seule couleur
// (WCAG 1.4.1). Même grammaire que la barre du cabinet, à dessein.
//
// Défilement horizontal plutôt que passage à la ligne : quatre onglets ne
// tiennent pas sur 320 px, et une barre sur deux lignes cesse de se lire comme
// une barre.
function Onglets({ actif }: { actif: SettingsTab }) {
  return (
    <nav
      aria-label="Sections des paramètres"
      className="-mx-4 overflow-x-auto border-b border-navy-100 px-4 sm:mx-0 sm:px-0"
    >
      <ul className="-mb-px flex gap-1">
        {SETTINGS_TABS.map((onglet) => {
          const estActif = onglet.cle === actif;
          return (
            <li key={onglet.cle}>
              <Link
                href={`/dashboard/settings?tab=${onglet.cle}`}
                aria-current={estActif ? "page" : undefined}
                className={[
                  "inline-flex min-h-[44px] items-center border-b-2 px-4 font-display text-sm font-semibold whitespace-nowrap transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-950",
                  estActif
                    ? "border-navy-950 text-navy-950"
                    : "border-transparent text-navy-600 hover:text-navy-950",
                ].join(" ")}
              >
                {onglet.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ── Onglet A — Identité légale & fiscalité ──────────────────────────────────

async function OngletIdentite({
  token,
  organizationId,
  detail,
  palier,
}: {
  token: string;
  organizationId: string;
  detail: Awaited<ReturnType<typeof getOrganization>>;
  palier: Tier;
}) {
  // Une tuile de plus ne justifie pas de faire tomber l'onglet : sans elle, la
  // page reste exacte, simplement plus courte.
  const trustScore = await getTrustScore(token, organizationId).catch((error: unknown) => {
    if (error instanceof TrustApiError) return null;
    throw error;
  });

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardBody>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-base font-semibold text-navy-950">
              Identité légale et fiscalité
            </h2>
            <ButtonLink href="/dashboard/settings/organisation" variant="secondary">
              Modifier la fiche
            </ButtonLink>
          </div>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <DataField label="Nom">{detail.name}</DataField>
            <DataField label="Forme juridique">{detail.legalForm}</DataField>
            <DataField label="Régime fiscal">
              {REGIME_LABELS[detail.regimeFiscal] ?? detail.regimeFiscal}
            </DataField>
            {/* NIF, RCCM et clé e-TVA sont des identifiants légaux : chasse
                fixe, comme les identifiants de certification — c'est ce qui
                lève l'ambiguïté 0/O et 1/l quand on les recopie sur un
                formulaire administratif. */}
            <DataField label="NIF">
              <span className="font-mono">{detail.nif ?? "Non renseigné"}</span>
            </DataField>
            <DataField label="RCCM">
              <span className="font-mono">{detail.rccm ?? "Non renseigné"}</span>
            </DataField>
            <DataField label="Clé e-TVA (SAFIG 2)">
              <span className="font-mono">{detail.etaxNumber ?? "Non renseignée"}</span>
            </DataField>
            <DataField label="Vérification DGI">
              {detail.dgiVerificationStatus === "verified" ? "Vérifiée" : "Non vérifiée"}
            </DataField>
          </dl>
        </CardBody>
      </Card>

      {trustScore ? (
        <Card>
          <CardBody>
            <p className="mb-2 font-display text-sm font-semibold text-navy-950">
              Paiements vérifiés
            </p>
            {trustScore.ratio === null ? (
              <p className="text-sm text-navy-600">Pas encore de paiement enregistré.</p>
            ) : (
              <>
                {/* Le chiffre est une donnée, pas un titre — même famille que
                    les montants et la tuile équivalente de l'accueil. */}
                <p className="font-mono text-2xl font-bold text-navy-950">
                  {formatVerifiedPaymentRatio(trustScore.ratio)}
                </p>
                <p className="mt-1 text-sm text-navy-600">
                  {formatGnf(trustScore.verifiedAmount)} vérifiés sur{" "}
                  {formatGnf(trustScore.totalAmount)} encaissés
                </p>
              </>
            )}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardBody>
          <p className="mb-2 font-display text-sm font-semibold text-navy-950">Export FEC</p>
          <p className="mb-4 text-sm text-navy-600">
            Fichier des écritures comptables (OHADA/SYSCOHADA).
          </p>
          <ButtonLink href="/dashboard/settings/fec">Télécharger le FEC</ButtonLink>
        </CardBody>
      </Card>

      <FonctionnalitesAvancees palier={palier} />
    </div>
  );
}

// Ce que les paliers supérieurs annoncent.
//
// ANNONCE, jamais barrière — et la nuance est ce qui rend ce bloc honnête :
// MarginController et RecurringTemplatesController n'imposent AUCUN palier
// commercial côté trust-api, et plan-features-grid.ts le dit noir sur blanc.
// Les griser en laissant croire que le serveur les refuse afficherait une règle
// qui n'existe pas. Elles n'ont surtout pas encore d'écran : la pastille dit ce
// qui vient, elle ne masque pas un bouton qu'on aurait retiré.
function FonctionnalitesAvancees({ palier }: { palier: Tier }) {
  const avancees = [
    {
      titre: "Analytics de marge",
      description: "Marge par produit et par succursale, prix de revient au fil des achats.",
      minimum: "pro" as Tier,
    },
    {
      titre: "Facturation récurrente",
      description: "Abonnements et échéanciers émis automatiquement, sans ressaisie.",
      minimum: "pro" as Tier,
    },
    {
      titre: "Tableaux de bord Metabase",
      description:
        "Instance mutualisée, cloisonnée par organisation. Pas encore raccordée à cette version.",
      minimum: "enterprise" as Tier,
    },
  ];

  return (
    <Card>
      <CardBody>
        <p className="mb-1 font-display text-sm font-semibold text-navy-950">
          Fonctionnalités des paliers supérieurs
        </p>
        <p className="mb-4 text-sm text-navy-600">
          Annoncées, pas encore disponibles dans cette version.
        </p>
        <ul className="flex flex-col gap-3">
          {avancees.map((avancee) => {
            const inclus = tierIndex(palier) >= tierIndex(avancee.minimum);
            return (
              <li key={avancee.titre} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span
                  className={`font-display text-sm font-semibold ${inclus ? "text-navy-950" : "text-navy-600"}`}
                >
                  {avancee.titre}
                </span>
                <Badge tone={inclus ? "green" : "navy"}>
                  {inclus ? "Inclus" : tierLabel(avancee.minimum)}
                </Badge>
                <span className="w-full text-sm text-navy-600">{avancee.description}</span>
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}

// ── Onglet B — Succursales ──────────────────────────────────────────────────

async function OngletSuccursales({
  token,
  organizationId,
  palier,
}: {
  token: string;
  organizationId: string;
  palier: Tier;
}) {
  const succursales: BranchItem[] = await listBranches(token, organizationId);
  const quota = quotaSuccursales(palier);
  const atteint = quotaAtteint(succursales.length, quota);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardBody>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-base font-semibold text-navy-950">Vos succursales</h2>
            {/* Le compteur est affiché AVANT le formulaire : savoir « 1 sur 1 »
                explique le blocage mieux qu'un refus après la saisie. */}
            <p className="font-mono text-xs text-navy-600">
              {succursales.length} / {quota === null ? "illimité" : quota}
            </p>
          </div>

          {succursales.length === 0 ? (
            <p className="py-4 text-sm text-navy-600">
              Aucune succursale enregistrée. Votre activité est rattachée à
              l&apos;établissement principal.
            </p>
          ) : (
            <ul className="divide-y divide-navy-50">
              {succursales.map((succursale) => (
                <li
                  key={succursale.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3"
                >
                  <span className="text-sm font-semibold text-navy-950">{succursale.name}</span>
                  <span className="text-xs text-navy-600">
                    {BRANCH_TYPE_LABELS[succursale.type] ?? succursale.type} · créée le{" "}
                    {formatDate(succursale.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <p className="mb-3 font-display text-sm font-semibold text-navy-950">
            Ouvrir une succursale
          </p>
          <BranchForm bloque={atteint} quota={quota} />
        </CardBody>
      </Card>
    </div>
  );
}

// ── Onglet C — Équipe & rôles ───────────────────────────────────────────────

async function OngletEquipe({
  token,
  organizationId,
  palier,
}: {
  token: string;
  organizationId: string;
  palier: Tier;
}) {
  const membres: OrganizationMemberItem[] = await listOrganizationMembers(token, organizationId);
  // Le quota porte sur les membres ACTIFS : une ligne révoquée n'en consomme
  // rien (inviteMember() compte `revokedAt: null`). Compter les révoqués
  // bloquerait une organisation qui a simplement connu du passage.
  const actifs = membres.filter((membre) => membre.revokedAt === null);
  const quota = quotaMembres(palier);
  const atteint = quotaAtteint(actifs.length, quota);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardBody>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-base font-semibold text-navy-950">Votre équipe</h2>
            <p className="font-mono text-xs text-navy-600">
              {actifs.length} / {quota === null ? "illimité" : quota}
            </p>
          </div>

          {membres.length === 0 ? (
            <p className="py-4 text-sm text-navy-600">Aucun collaborateur pour l&apos;instant.</p>
          ) : (
            <ul className="divide-y divide-navy-50">
              {membres.map((membre) => {
                const revoque = membre.revokedAt !== null;
                return (
                  <li
                    key={membre.id}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3"
                  >
                    <div>
                      <p className={`text-sm ${revoque ? "text-navy-600" : "text-navy-950"}`}>
                        {membre.user.name}
                      </p>
                      <p className="text-xs text-navy-600">
                        {roleLabel(membre.role)}
                        {/* Les membres révoqués RESTENT affichés : c'est ce qui
                            répond à « qui avait accès l'an dernier », et la
                            contrainte unique (organizationId, userId) fait
                            toujours barrage à une réinvitation du même compte.
                            Les masquer laisserait croire qu'ils n'ont jamais
                            existé. */}
                        {revoque
                          ? ` · accès retiré le ${formatDate(membre.revokedAt as string)}`
                          : ""}
                      </p>
                    </div>
                    {revoque ? (
                      <Badge tone="navy">Accès retiré</Badge>
                    ) : (
                      <RevokeMemberForm memberId={membre.id} nom={membre.user.name} />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <p className="mb-1 font-display text-sm font-semibold text-navy-950">
            Ajouter un collaborateur
          </p>
          <p className="mb-3 text-sm text-navy-600">
            Seul le propriétaire peut accorder — ou reprendre — les rôles Administrateur et
            Approbateur.
          </p>
          <InviteMemberForm palier={palier} bloque={atteint} quota={quota} />
        </CardBody>
      </Card>
    </div>
  );
}

// ── Onglet D — Clés API ─────────────────────────────────────────────────────

async function OngletApi({
  token,
  organizationId,
  palier,
}: {
  token: string;
  organizationId: string;
  palier: Tier;
}) {
  const cles: ApiKeyItem[] = await listApiKeys(token, organizationId);
  const pdpOuvert = passerelleePdpAutorisee(palier);

  return (
    <div className="flex flex-col gap-6">
      {/* Le seuil de palier est annoncé À SA VRAIE PLACE : trust-api n'impose
          aucun palier pour CRÉER une clé (api-keys.service.ts) — il l'impose à
          l'USAGE de la passerelle PDP (PdpApiKeyAuthGuard). Bloquer la
          génération ici afficherait une barrière que le serveur n'applique pas ;
          ne rien dire laisserait un éditeur découvrir le refus au premier
          dépôt. */}
      {!pdpOuvert ? (
        <div className="rounded-2xl border border-amber bg-amber-bg p-5">
          <p className="font-display text-sm font-bold text-navy-950">
            Passerelle PDP réservée au palier {tierLabel(PDP_GATEWAY_MIN_TIER)}
          </p>
          <p className="mt-1 text-sm text-navy-700">
            Vos clés fonctionnent pour vos propres scripts. Le dépôt de documents fiscaux par un
            éditeur externe (en-tête <span className="font-mono">X-PDP-API-Key</span>) est refusé
            tant que votre palier n&apos;est pas {tierLabel(PDP_GATEWAY_MIN_TIER)}.
          </p>
        </div>
      ) : null}

      <Card>
        <CardBody>
          <h2 className="mb-3 font-display text-base font-semibold text-navy-950">Clés actives</h2>
          {cles.length === 0 ? (
            <p className="py-4 text-sm text-navy-600">Aucune clé active.</p>
          ) : (
            <ul className="divide-y divide-navy-50">
              {cles.map((cle) => (
                <li
                  key={cle.id}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3"
                >
                  <div>
                    {/* Le label est déjà masqué côté serveur : le secret n'est
                        jamais relu, il n'a existé en clair qu'à la création. */}
                    <p className="font-mono text-sm font-bold text-navy-950">{cle.label}</p>
                    <p className="text-xs text-navy-600">
                      {cle.environment === "production" ? "Production" : "Test"} · créée le{" "}
                      {formatDate(cle.createdAt)} ·{" "}
                      {cle.lastUsedAt
                        ? `dernier appel le ${formatDate(cle.lastUsedAt)}`
                        : "jamais utilisée"}
                    </p>
                  </div>
                  <RevokeApiKeyForm apiKeyId={cle.id} label={cle.label} />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <p className="mb-1 font-display text-sm font-semibold text-navy-950">Générer une clé</p>
          <p className="mb-3 text-sm text-navy-600">
            Le secret ne s&apos;affiche qu&apos;une seule fois, à la génération. Il est ensuite
            haché et ne peut plus être relu.
          </p>
          <ApiKeyForm />
        </CardBody>
      </Card>

      {/* Les webhooks SORTANTS n'existent pas encore côté trust-api : aucun
          modèle, aucune route, aucune souscription (PaymentWebhook est le sens
          INVERSE — ce que la passerelle nous envoie). Un champ « URL de
          rappel » serait un formulaire qui n'appelle personne. */}
      <Card>
        <CardBody>
          <p className="mb-1 font-display text-sm font-semibold text-navy-950">Webhooks sortants</p>
          <p className="text-sm text-navy-600">
            Pas encore disponibles. Vos clés servent aujourd&apos;hui à interroger l&apos;API ; il
            n&apos;y a pas encore de notification poussée vers vos propres serveurs.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
