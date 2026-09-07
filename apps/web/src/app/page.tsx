import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui";
import { CertificationLookupForm } from "@/components/CertificationLookupForm";
import { Wordmark } from "@/components/Wordmark";

// Page d'accueil publique — le hub des trois canaux d'accès, et le point
// d'entrée de la vérification. Écrite entièrement avec les tokens du Design
// System (globals.css) : aucune couleur en dur, sous peine d'échec du
// garde-fou `design-system.guardrails.spec.ts`, qui tourne en CI.
//
// Trois règles de la charte cadrent ce qui suit :
//   R-01  jamais de dégradé, et jamais les couleurs du drapeau guinéen — la
//         marque est « Navy Autorité + Or de Guinée », pas vert/rouge/jaune.
//   R-11  jamais de texte clair sur l'Or (1.8:1). L'Or porte du Navy (9.4:1).
//   AA    l'échelle Navy sous navy-600 est faite pour les bordures, jamais
//         pour du texte.
//
// Aucune ombre non plus : la hiérarchie tient au contraste des surfaces
// (blanc sur --grey), pas à une élévation qui s'évanouit sur un écran d'entrée
// de gamme mal calibré — c'est la raison déjà inscrite dans la primitive Card.

export const metadata: Metadata = {
  title: "facture.gn — Plateforme nationale de certification fiscale",
  description:
    "Sécurisation, immuabilité et télétransmission des factures certifiées pour les PME et cabinets comptables en République de Guinée.",
};

const NAV = [
  { href: "#hub", label: "Écosystème multi-canal" },
  { href: "#verify", label: "Vérification publique" },
  { href: "#security", label: "Garanties cryptographiques" },
];

const GARANTIES = [
  {
    titre: "Chaînage des factures",
    texte:
      "Chaque facture émise scelle le sceau de la précédente. Retirer ou modifier une pièce rompt la chaîne, et la rupture est détectable publiquement.",
  },
  {
    titre: "Signature par organisation",
    texte:
      "Chaque entreprise dispose de sa propre clé de signature. Un sceau ne peut pas être produit au nom d’une autre, même depuis la plateforme.",
  },
  {
    titre: "Ancrage périodique",
    texte:
      "Les sceaux sont regroupés et ancrés par lots. L’antériorité d’une facture devient opposable sans avoir à faire confiance à l’exploitant.",
  },
  {
    titre: "Cloisonnement en base",
    texte:
      "L’isolation entre entreprises est appliquée par PostgreSQL lui-même, sous chaque requête — pas seulement par le code applicatif au-dessus.",
  },
];

export default function LandingPage() {
  return (
    <div className="flex min-h-full flex-col bg-grey text-navy-950">
      {/* ─── En-tête ─────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-navy-100 bg-white">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            {/* Le logotype passe par Wordmark : bas de casse exclusif (R-03) et
                dot Or entre « facture » et « gn » (R-02) — le dot EST la
                ponctuation, jamais un point littéral ni une autre couleur. */}
            <Wordmark href="/" ariaLabel="facture.gn — Accueil" />
            <span className="hidden rounded-full bg-navy-50 px-2.5 py-1 font-mono text-[11px] font-bold text-navy-600 sm:inline">
              v1.0
            </span>
          </div>

          <nav aria-label="Sections" className="hidden items-center gap-8 text-sm font-semibold text-navy-600 lg:flex">
            {NAV.map((item) => (
              <a key={item.href} href={item.href} className="transition-colors hover:text-navy-950">
                {item.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <Link href="/login" className="hidden text-sm font-semibold text-navy-950 hover:underline sm:inline">
              Se connecter
            </Link>
            {/* `primary` et non `accent` : l'unique accent Or de la page est le
                CTA du hero. Deux Or côte à côte et l'accent ne signale plus
                rien — c'est la règle « un par écran au plus » de la primitive. */}
            <ButtonLink href="/inscription" variant="primary">
              Créer un espace
            </ButtonLink>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* ─── Hero ──────────────────────────────────────────────────────── */}
        <section className="border-b border-navy-100 bg-white py-16 lg:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl">
              <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-navy-100 bg-grey px-3 py-1 text-xs font-semibold text-navy-600">
                <span aria-hidden="true" className="h-2 w-2 rounded-full bg-or" />
                Conforme aux directives DGI et interopérable avec le guichet unique APIP
              </p>
              <h1 className="mb-6 font-display text-4xl leading-tight font-bold tracking-tight text-navy-950 sm:text-5xl lg:text-6xl">
                L’infrastructure de confiance de la facturation en Guinée.
              </h1>
              <p className="mb-8 text-lg leading-relaxed text-navy-600 sm:text-xl">
                Sécurisez vos opérations commerciales, automatisez vos déclarations de TVA et protégez
                votre entreprise grâce au registre d’immuabilité national et au cloisonnement de
                données RLS.
              </p>
              <div className="flex flex-col gap-4 sm:flex-row">
                <ButtonLink href="/inscription" variant="accent" size="lg">
                  Immatriculer ma PME
                </ButtonLink>
                <ButtonLink href="#verify" variant="secondary" size="lg">
                  Vérifier l’authenticité d’un reçu
                </ButtonLink>
              </div>
            </div>
          </div>
        </section>

        {/* ─── Hub tri-partite ───────────────────────────────────────────── */}
        <section id="hub" className="scroll-mt-24 border-b border-navy-100 py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mx-auto mb-16 max-w-3xl text-center">
              <h2 className="mb-4 font-display text-3xl font-bold tracking-tight text-navy-950">
                Un seul service. Trois modes d’accès.
              </h2>
              <p className="leading-relaxed text-navy-600">
                Dirigeant connecté, expert-comptable au bureau ou marchand sur le terrain sans
                internet : facture.gn garantit la même étanchéité de vos données financières.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
              {/* Canal 1 — PME */}
              <article className="flex flex-col justify-between rounded-2xl border border-navy-100 bg-white p-8">
                <div>
                  <span
                    aria-hidden="true"
                    className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl border border-navy-100 bg-grey text-navy-950"
                  >
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
                      />
                    </svg>
                  </span>
                  <h3 className="mb-3 font-display text-xl font-semibold text-navy-950">
                    Espace PME &amp; marchands
                  </h3>
                  <p className="mb-6 text-sm leading-relaxed text-navy-600">
                    Pilotez votre entreprise en ligne. Émettez des factures conformes, gérez vos
                    catalogues de produits et suivez l’état de vos stocks depuis une interface pensée
                    d’abord pour le mobile.
                  </p>
                </div>
                <ButtonLink href="/login" variant="secondary" className="w-full">
                  Accéder à l’espace marchand
                </ButtonLink>
              </article>

              {/* Canal 2 — Cabinet */}
              <article className="flex flex-col justify-between rounded-2xl border border-navy-100 bg-white p-8">
                <div>
                  <span
                    aria-hidden="true"
                    className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl border border-navy-100 bg-grey text-navy-950"
                  >
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                      />
                    </svg>
                  </span>
                  <h3 className="mb-3 font-display text-xl font-semibold text-navy-950">
                    Espace cabinet &amp; experts
                  </h3>
                  <p className="mb-6 text-sm leading-relaxed text-navy-600">
                    Le tableau de bord des professionnels du chiffre. Gérez les mandats actifs de vos
                    clients, suivez la trésorerie et supervisez les clôtures d’exercice de vos PME
                    rattachées.
                  </p>
                </div>
                <ButtonLink href="/cabinet/mandates" variant="secondary" className="w-full">
                  Ouvrir l’espace cabinet
                </ButtonLink>
              </article>

              {/* Canal 3 — USSD. Seule carte en Navy plein : c'est le canal qui
                  n'a pas d'équivalent chez les autres, et le contraste de
                  surface suffit à le distinguer sans ombre ni dégradé. */}
              <article className="flex flex-col justify-between rounded-2xl border border-navy-800 bg-navy-950 p-8 text-white">
                <div>
                  <p className="mb-4 inline-block rounded-full bg-or px-2.5 py-1 font-mono text-[11px] font-bold text-navy-950">
                    INCLUSION TOTALE
                  </p>
                  <h3 className="mb-3 font-display text-xl font-semibold">Canal hors-ligne USSD</h3>
                  <p className="mb-6 text-sm leading-relaxed text-white/75">
                    Zéro connexion internet, zéro smartphone. Certifiez et encaissez vos ventes depuis
                    n’importe quel téléphone basique, via le code court sécurisé national.
                  </p>
                  {/* Chasse fixe : c'est un code à composer chiffre par chiffre,
                      exactement le cas où la charte réclame le mono pour lever
                      l'ambiguïté 0/O et 1/l. */}
                  <div className="mb-6 rounded-xl border border-navy-800 bg-white/5 p-4 text-center">
                    <span className="mb-1 block font-mono text-2xl font-bold tracking-widest text-white">
                      *620#
                    </span>
                    <span className="block text-xs text-white/75">
                      Composez ce code sur votre téléphone (Orange / MTN)
                    </span>
                  </div>
                </div>
                <p className="text-center text-xs text-white/75">
                  Conçu pour l’économie informelle et les zones rurales.
                </p>
              </article>
            </div>
          </div>
        </section>

        {/* ─── Vérification publique ─────────────────────────────────────── */}
        {/* La section que le brouillon laissait ouverte. Elle réutilise
            CertificationLookupForm — le formulaire déjà en service, qui pousse
            vers /[certificationId] — plutôt qu'un champ décoratif de plus. */}
        <section id="verify" className="scroll-mt-24 bg-navy-950 py-20 text-white">
          <div className="mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
            <h2 className="mb-4 font-display text-3xl font-bold tracking-tight">
              Vérification instantanée du registre national
            </h2>
            <p className="mx-auto mb-10 max-w-2xl text-white/75">
              Toute facture certifiée porte un identifiant de vérification. Saisissez-le pour
              confirmer son authenticité, son émetteur et son montant — sans compte, et sans accès à
              un espace privé.
            </p>

            {/* Le formulaire est bâti pour un fond clair (bordures et libellés
                Navy) : on le pose sur une carte blanche plutôt que de le
                réécrire en variante sombre. */}
            <div className="mx-auto max-w-2xl rounded-2xl border border-navy-800 bg-white p-6 text-left text-navy-950 sm:p-8">
              <CertificationLookupForm />
            </div>

            <p className="mx-auto mt-6 max-w-2xl text-sm text-white/75">
              Un reçu introuvable dans le registre n’a pas été certifié par facture.gn.
            </p>
          </div>
        </section>

        {/* ─── Garanties cryptographiques ────────────────────────────────── */}
        {/* Cible du lien de navigation #security, absente du brouillon : sans
            elle l'ancre était morte. Contenu volontairement factuel — chaque
            point correspond à un mécanisme réellement implémenté côté
            trust-api, pas à une promesse. */}
        <section id="security" className="scroll-mt-24 border-b border-navy-100 py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mx-auto mb-16 max-w-3xl text-center">
              <h2 className="mb-4 font-display text-3xl font-bold tracking-tight text-navy-950">
                Ce qui rend une facture infalsifiable
              </h2>
              <p className="leading-relaxed text-navy-600">
                Quatre mécanismes indépendants, dont aucun ne repose sur la bonne foi de l’émetteur.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {GARANTIES.map((garantie) => (
                <article key={garantie.titre} className="rounded-2xl border border-navy-100 bg-white p-6">
                  <h3 className="mb-2 font-display text-base font-semibold text-navy-950">{garantie.titre}</h3>
                  <p className="text-sm leading-relaxed text-navy-600">{garantie.texte}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* ─── Pied de page ────────────────────────────────────────────────── */}
      <footer className="border-t border-navy-100 bg-white py-10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-4 sm:px-6 md:flex-row lg:px-8">
          <Wordmark href="/" ariaLabel="facture.gn — Accueil" />
          <nav
            aria-label="Pied de page"
            className="flex flex-wrap items-center justify-center gap-6 text-sm text-navy-600"
          >
            {NAV.map((item) => (
              <a key={item.href} href={item.href} className="transition-colors hover:text-navy-950">
                {item.label}
              </a>
            ))}
            <Link href="/login" className="transition-colors hover:text-navy-950">
              Se connecter
            </Link>
          </nav>
          <p className="text-sm text-navy-600">République de Guinée</p>
        </div>
      </footer>
    </div>
  );
}
