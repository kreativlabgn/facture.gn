import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui";
import { EspaceCard } from "@/components/auth/EspaceCard";
import { LoginMenu } from "@/components/auth/LoginMenu";
import { CertificationLookupForm } from "@/components/CertificationLookupForm";
import { Wordmark } from "@/components/Wordmark";
import { ESPACE_PAR_DEFAUT, ESPACES } from "@/lib/espaces";

export const metadata: Metadata = {
  title: "facture.gn — La preuve numérique de vos factures",
  description:
    "Émettez, partagez et vérifiez vos factures avec un service privé de confiance conçu pour les entreprises guinéennes.",
};

const NAV = [
  { href: "#parcours", label: "Parcours" },
  { href: "#espaces", label: "Espaces" },
  { href: "#verification", label: "Vérification" },
  { href: "#confiance", label: "Confiance" },
];

const ETAPES = [
  {
    numero: "01",
    titre: "Émettez",
    texte: "Créez une facture depuis le web ou le canal USSD. Chaque émission reçoit une preuve propre à votre organisation.",
  },
  {
    numero: "02",
    titre: "Partagez",
    texte: "Transmettez un lien de paiement ou un identifiant de vérification à votre client, sans lui imposer de compte.",
  },
  {
    numero: "03",
    titre: "Suivez",
    texte: "Retrouvez l’état du document, les encaissements et le journal de certification dans votre espace.",
  },
];

const ENGAGEMENTS = [
  {
    titre: "Une preuve par facture",
    texte: "Chaque pièce certifiée conserve un identifiant et une empreinte vérifiables publiquement.",
  },
  {
    titre: "Un accès sans friction",
    texte: "Le client consulte et paie depuis un lien, avec un code SMS, sans créer de compte facture.gn.",
  },
  {
    titre: "Un canal pour tous",
    texte: "Le code USSD *620# permet d’émettre et d’encaisser sans smartphone ni connexion internet.",
  },
];

const GARANTIES = [
  {
    titre: "Chaînage des factures",
    texte: "Chaque facture scelle la précédente. Toute rupture de la chaîne devient détectable.",
  },
  {
    titre: "Signature par organisation",
    texte: "Chaque entreprise signe avec sa propre clé. La plateforme ne peut pas produire un sceau en son nom.",
  },
  {
    titre: "Ancrage périodique",
    texte: "Les sceaux sont regroupés et ancrés par lots pour rendre leur antériorité vérifiable.",
  },
  {
    titre: "Cloisonnement en base",
    texte: "L’isolation entre organisations est appliquée par PostgreSQL sous chaque requête.",
  },
];

function SectionTitle({ eyebrow, title, texte }: { eyebrow: string; title: string; texte: string }) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <p className="font-mono text-xs font-bold uppercase tracking-[0.14em] text-navy-600">{eyebrow}</p>
      <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-navy-950 sm:text-4xl">{title}</h2>
      <p className="mt-4 text-base leading-relaxed text-navy-600">{texte}</p>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="flex min-h-full flex-col bg-grey text-navy-950">
      <a
        href="#contenu"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:font-semibold focus:outline-2 focus:outline-offset-2 focus:outline-navy-950"
      >
        Aller au contenu
      </a>

      <header className="sticky top-0 z-50 border-b border-navy-100 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-4 py-4 sm:px-6 lg:px-8">
          <Wordmark href="/" ariaLabel="facture.gn — Accueil" />
          <nav aria-label="Sections" className="hidden items-center gap-7 text-sm font-semibold text-navy-600 lg:flex">
            {NAV.map((item) => (
              <a key={item.href} href={item.href} className="transition-colors hover:text-navy-950">
                {item.label}
              </a>
            ))}
          </nav>
          {/* Deux entrées, deux intentions. « Se connecter » ouvre un menu de
              profil (marchand / cabinet / acheteur) parce que les trois n'entrent
              pas par la même porte. « Créer mon espace » va DROIT au formulaire
              marchand — le profil majoritaire — et non au hub /inscription : un
              récapitulatif entre l'intention et le formulaire est un clic de
              perdu, et c'était surtout le départ d'une boucle vers /login (voir
              lib/espaces.ts). Le cabinet et l'acheteur ont leur porte dans
              la section Espaces et dans le menu. */}
          <div className="flex items-center gap-2 sm:gap-3">
            <LoginMenu />
            <ButtonLink href={ESPACE_PAR_DEFAUT.creation!.href} variant="primary" className="whitespace-nowrap">
              <span className="sm:hidden">S’inscrire</span>
              <span className="hidden sm:inline">Créer mon espace</span>
            </ButtonLink>
          </div>
        </div>
      </header>

      <main id="contenu" className="flex-1">
        <section className="overflow-hidden border-b border-navy-100 bg-white">
          <div className="mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8 lg:py-24 lg:px-8">
            <div className="flex flex-col justify-center">
              <p className="inline-flex w-fit items-center gap-2 rounded-full border border-navy-100 bg-grey px-3 py-1.5 text-xs font-semibold text-navy-600">
                <span aria-hidden="true" className="h-2 w-2 rounded-full bg-or" />
                Service privé de confiance en Guinée
              </p>
              <h1 className="mt-6 font-display text-4xl font-bold leading-[1.08] tracking-tight text-navy-950 sm:text-5xl lg:text-6xl">
                Vos factures gardent leur preuve, de l’émission au règlement.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-relaxed text-navy-600 sm:text-xl">
                facture.gn aide les entreprises à émettre, partager et suivre des factures certifiées. Vos clients
                peuvent les vérifier et les régler simplement, même sans compte.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <ButtonLink href={ESPACE_PAR_DEFAUT.creation!.href} variant="accent" size="lg">
                  Créer mon espace marchand
                </ButtonLink>
                <ButtonLink href="#verification" variant="secondary" size="lg">
                  Vérifier une facture
                </ButtonLink>
              </div>
              <p className="mt-5 text-sm text-navy-600">
                Sans engagement visible sur cette page. Le NIF et le numéro eTax restent optionnels à la création.
              </p>
            </div>

            <div className="flex items-center">
              <div className="w-full rounded-2xl border border-navy-100 bg-grey p-5 sm:p-7">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-navy-600">
                      Aperçu de vérification
                    </p>
                    <p className="mt-2 font-display text-lg font-bold text-navy-950">Facture certifiée</p>
                  </div>
                  <span className="rounded-full bg-good-bg px-2.5 py-1 text-xs font-bold text-good-text">Vérifiable</span>
                </div>
                <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-navy-100 bg-white p-4">
                    <p className="text-xs text-navy-600">Émetteur</p>
                    <p className="mt-1 text-sm font-semibold text-navy-950">Votre organisation</p>
                  </div>
                  <div className="rounded-xl border border-navy-100 bg-white p-4">
                    <p className="text-xs text-navy-600">Identifiant</p>
                    <p className="mt-1 break-all font-mono text-xs font-bold text-navy-950">GN-XXXXXX-2026-XXXXXX</p>
                  </div>
                  <div className="rounded-xl border border-navy-100 bg-white p-4">
                    <p className="text-xs text-navy-600">Intégrité</p>
                    <p className="mt-1 text-sm font-semibold text-navy-950">Contrôle public disponible</p>
                  </div>
                  <div className="rounded-xl border border-navy-100 bg-white p-4">
                    <p className="text-xs text-navy-600">Accès client</p>
                    <p className="mt-1 text-sm font-semibold text-navy-950">Lien et code SMS</p>
                  </div>
                </div>
                <p className="mt-5 text-xs leading-relaxed text-navy-600">
                  Chaque organisation dispose d’une preuve qui lui est propre. La vérification publique ne révèle pas
                  votre espace de gestion.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="parcours" className="border-b border-navy-100 bg-white py-20 scroll-mt-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <SectionTitle
              eyebrow="Un parcours lisible"
              title="Trois étapes, une seule preuve"
              texte="Le parcours est volontairement direct : produire une pièce utile, la transmettre au bon interlocuteur, puis garder une trace exploitable."
            />
            <div className="mt-12 grid gap-4 lg:grid-cols-3">
              {ETAPES.map((etape, index) => (
                <article key={etape.numero} className="relative rounded-2xl border border-navy-100 bg-grey p-7">
                  <p className="font-mono text-sm font-bold text-navy-600">{etape.numero}</p>
                  <h3 className="mt-5 font-display text-xl font-bold text-navy-950">{etape.titre}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-navy-600">{etape.texte}</p>
                  {index < ETAPES.length - 1 ? (
                    <span aria-hidden="true" className="mt-6 block h-px bg-navy-100 lg:hidden" />
                  ) : null}
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="espaces" className="border-b border-navy-100 py-20 scroll-mt-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <SectionTitle
              eyebrow="Chaque métier a son entrée"
              title="Un accès adapté à votre rôle"
              texte="Les espaces sont séparés pour éviter les confusions entre une entreprise, son cabinet et ses clients."
            />
            <div className="mt-12 grid gap-5 lg:grid-cols-3">
              {ESPACES.map((espace) => (
                <EspaceCard key={espace.id} espace={espace} />
              ))}
            </div>
          </div>
        </section>

        <section id="verification" className="bg-navy-950 py-20 text-white scroll-mt-20">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-3xl text-center">
              <p className="font-mono text-xs font-bold uppercase tracking-[0.14em] text-white/75">Contrôle public</p>
              <h2 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl">
                N’attendez pas un litige pour vérifier une facture.
              </h2>
              <p className="mt-4 text-base leading-relaxed text-white/75">
                Saisissez l’identifiant de vérification imprimé ou transmis avec le reçu. Le résultat confirme
                l’intégrité, l’émetteur et le montant sans donner accès à un espace privé.
              </p>
            </div>
            <div className="mx-auto mt-10 max-w-2xl rounded-2xl border border-navy-800 bg-white p-5 text-navy-950 sm:p-7">
              <CertificationLookupForm />
              <p className="mt-4 text-xs leading-relaxed text-navy-600">
                Un identifiant introuvable n’a pas été certifié par facture.gn. Vérifiez-le caractère par caractère.
              </p>
            </div>
          </div>
        </section>

        <section id="confiance" className="border-b border-navy-100 bg-white py-20 scroll-mt-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <SectionTitle
              eyebrow="Conçu pour être contrôlé"
              title="La confiance se vérifie"
              texte="Les promesses de la page correspondent à des mécanismes implémentés, pas à des labels ajoutés après coup."
            />
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {GARANTIES.map((garantie) => (
                <article key={garantie.titre} className="rounded-2xl border border-navy-100 bg-grey p-6">
                  <h3 className="font-display text-base font-bold text-navy-950">{garantie.titre}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-navy-600">{garantie.texte}</p>
                </article>
              ))}
            </div>

            <div className="mt-12 grid gap-4 lg:grid-cols-3">
              {ENGAGEMENTS.map((engagement) => (
                <article key={engagement.titre} className="rounded-2xl bg-navy-50 p-6">
                  <h3 className="font-display text-base font-bold text-navy-950">{engagement.titre}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-navy-600">{engagement.texte}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-grey py-20">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
            <div className="rounded-2xl border border-navy-100 bg-white px-6 py-12 text-center sm:px-10">
              <h2 className="font-display text-3xl font-bold tracking-tight text-navy-950 sm:text-4xl">
                Commencez par une facture que vous pouvez prouver.
              </h2>
              <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-navy-600">
                Créez votre espace marchand, émettez votre première facture et partagez une preuve que votre client
                pourra contrôler.
              </p>
              <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
                <ButtonLink href={ESPACE_PAR_DEFAUT.creation!.href} variant="accent" size="lg">
                  Créer mon espace marchand
                </ButtonLink>
                <ButtonLink href={ESPACE_PAR_DEFAUT.connexion.href} variant="secondary" size="lg">
                  J’ai déjà un compte
                </ButtonLink>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-navy-100 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-10 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <Wordmark href="/" ariaLabel="facture.gn — Accueil" />
          <nav aria-label="Pied de page" className="flex flex-wrap gap-x-6 gap-y-3 text-sm font-medium text-navy-600">
            {NAV.map((item) => (
              <a key={item.href} href={item.href} className="transition-colors hover:text-navy-950">
                {item.label}
              </a>
            ))}
            <Link href="/login" className="transition-colors hover:text-navy-950">
              Se connecter
            </Link>
          </nav>
          <p className="text-sm text-navy-600">Conçu pour les entreprises guinéennes</p>
        </div>
      </footer>
    </div>
  );
}
