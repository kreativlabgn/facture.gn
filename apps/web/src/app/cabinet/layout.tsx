import { CabinetShell } from "@/components/shell/CabinetShell";
import { Wordmark } from "@/components/Wordmark";
import { ButtonLink } from "@/components/ui";
import { resolveActivePractice } from "@/lib/active-practice";
import { requireSessionToken } from "@/lib/session";
import { listMyOrganizations } from "@/lib/trust-api";

// Route de premier niveau distincte de /dashboard — un membre de cabinet n'a
// pas nécessairement sa propre organisation PME (PracticeMember est un concept
// d'appartenance entièrement séparé d'OrganizationMember, voir schema.prisma).
//
// LE CABINET AFFICHÉ N'EST PLUS `practices[0]`. Ce raccourci a fait croire à une
// faille : côté trust-api, listMine() n'avait aucun tri, donc Postgres rendait
// les rattachements dans l'ordre qui l'arrangeait. Un comptable membre de deux
// structures — la sienne, plus un CGA où il intervient — atterrissait tantôt
// chez lui, tantôt chez le confrère, sans rien avoir demandé et sans que
// l'écran le dise. L'accès était légitime dans les deux cas, mais l'effet était
// celui d'une fuite. resolveActivePractice rend le choix explicite, persistant,
// et affiché en permanence (bloc « Espace actif »).
//
// Le cookie qu'il lit n'autorise RIEN : il est reconfronté à la liste réelle du
// porteur du JWT à chaque résolution, et trust-api refuse de toute façon tout
// non-membre en 403 (assertPracticeAdmin, practice-access.ts).
export default async function CabinetLayout({ children }: { children: React.ReactNode }) {
  const token = await requireSessionToken();
  const [{ practices, active }, organizations] = await Promise.all([
    resolveActivePractice(token),
    // Sert uniquement à décider si « Retour à mon commerce » a un sens. Un
    // échec ne doit pas faire tomber tout l'espace cabinet pour un lien
    // secondaire : on retombe sur « aucune organisation », le lien disparaît.
    listMyOrganizations(token).catch(() => []),
  ]);

  // Sans cabinet, il n'y a rien à naviguer : on rend l'explication seule plutôt
  // qu'une coquille dont chaque entrée mènerait à une page vide.
  //
  // Avec une SORTIE. Cet écran était une impasse : il constatait l'absence de
  // cabinet sans jamais dire comment en créer un, alors que POST /practices
  // existe depuis F8. Le lien pointe hors de /cabinet — ce layout-ci
  // intercepterait une route /cabinet/nouveau et lui servirait ce même écran.
  if (!active) {
    return (
      <div className="flex min-h-full flex-col bg-navy-50">
        <header className="border-b border-navy-100 bg-white">
          <div className="mx-auto flex max-w-6xl items-center px-4 py-4 sm:px-6">
            <Wordmark href="/cabinet" ariaLabel="facture.gn — Accueil cabinet" />
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
          <div className="rounded-2xl border border-navy-100 bg-white p-8 text-center">
            <p className="font-display text-lg font-bold text-navy-950">Aucun cabinet</p>
            <p className="mx-auto mt-3 max-w-sm text-sm text-navy-600">
              Votre compte n&apos;est rattaché à aucun cabinet comptable, gestionnaire, fiduciaire ou CGA.
            </p>
            <div className="mt-6 flex flex-col items-center gap-3">
              <ButtonLink href="/nouveau-cabinet" variant="accent">
                Créer mon cabinet
              </ButtonLink>
              <p className="mx-auto max-w-sm text-xs text-navy-600">
                Si un collègue a déjà créé le cabinet, demandez-lui de vous inviter : c&apos;est lui
                qui vous y rattache, depuis l&apos;onglet Collaborateurs.
              </p>
              {organizations.length > 0 ? (
                <ButtonLink href="/dashboard" variant="ghost">
                  Retour à mon commerce
                </ButtonLink>
              ) : null}
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <CabinetShell
      practices={practices.map((practice) => ({
        id: practice.id,
        name: practice.name,
        type: practice.type,
        role: practice.role,
      }))}
      active={{ id: active.id, name: active.name, type: active.type, role: active.role }}
      aUneOrganisation={organizations.length > 0}
    >
      {children}
    </CabinetShell>
  );
}
