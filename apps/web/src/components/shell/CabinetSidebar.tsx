"use client";

import { logoutAction } from "@/app/(app)/actions";
import { switchPracticeAction } from "@/app/cabinet/actions";
import { Wordmark } from "@/components/Wordmark";
import { PRACTICE_TYPE_LABELS, practiceRoleLabel } from "@/lib/cabinet-nav";
import { CabinetNav } from "./CabinetNav";
import { LogoutIcon, SwitchIcon } from "./cabinet-icons";

// La barre latérale de l'espace cabinet — sortie de CabinetShell, qui portait à
// la fois la mise en page, le tiroir mobile et le contenu du rail.
//
// ELLE N'A AUCUNE SORTIE VERS L'ESPACE MARCHAND, et c'est le point de cette
// extraction. Le lien « Retour à mon commerce » vivait ici : un compte qui
// possède le même numéro pour son commerce et pour son cabinet passait d'un
// univers à l'autre en un clic. L'ENTRÉE était déjà tenue par un seuil explicite
// (/dashboard/espace-cabinet, cabinet-seuil.guardrails) ; la SORTIE ne l'était
// pas — et une porte à sens unique n'étanche rien.
//
// Quitter le cabinet, c'est désormais fermer sa session : le cookie est détruit,
// on repasse par le hub d'aiguillage. C'est un geste de plus, et c'est voulu —
// deux entités juridiques distinctes, deux comptabilités, deux obligations
// fiscales ; on n'a jamais de raison de basculer de l'une à l'autre en visant
// mal un lien.

export interface PracticeOption {
  id: string;
  name: string;
  type: string;
  role: string;
  /** Vérification par l'Ordre (OCAECG). Vient de la base, JAMAIS d'un badge
   *  posé en dur : sur une plateforme de certification fiscale, afficher
   *  « vérifié par l'Ordre » à un cabinet qui ne l'est pas est une fausse
   *  déclaration — et c'est précisément ce qu'un client regarde avant de
   *  confier sa comptabilité. */
  ordreVerified: boolean;
}

export function CabinetSidebar({
  practices,
  active,
  variante = "laterale",
  onNaviguer,
}: {
  practices: readonly PracticeOption[];
  active: PracticeOption;
  /** `tiroir` = rendu replié sous le seuil md. La seule différence est le
   *  wordmark, déjà présent dans l'en-tête mobile : le répéter donnerait deux
   *  fois le même repère à trois centimètres d'écart. */
  variante?: "laterale" | "tiroir";
  /** Referme le tiroir après un clic. Absent sur le rail permanent, qui ne se
   *  referme jamais. */
  onNaviguer?: () => void;
}) {
  const tiroir = variante === "tiroir";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {tiroir ? null : (
        <div className="px-5 pt-5 pb-4">
          <Wordmark href="/cabinet" ariaLabel="facture.gn — Accueil cabinet" tone="dark" />
        </div>
      )}

      {/* Identité du cabinet : ce qu'il est, et ce que J'Y suis. Le rôle en
          premier — c'est lui qui explique pourquoi telle entrée manque. */}
      <div className="mx-2 mb-4 border-b border-white/10 px-3 pb-4">
        <div className="flex flex-wrap gap-1.5">
          <span className="rounded bg-or/15 px-2 py-0.5 text-[10px] font-bold tracking-wider text-or uppercase">
            {practiceRoleLabel(active.role)}
          </span>
          <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-bold tracking-wider text-white/70 uppercase">
            {PRACTICE_TYPE_LABELS[active.type] ?? active.type}
          </span>
        </div>
        <p className="mt-2 truncate font-display text-base font-bold text-white">{active.name}</p>
        {/* AFFICHÉ SEULEMENT S'IL EST VRAI. Un badge de confiance posé en dur
            serait une fausse déclaration ; son absence, elle, ne dit rien de
            négatif — elle ne dit simplement rien. */}
        {active.ordreVerified ? (
          <p className="mt-2 inline-flex items-center gap-1 rounded border border-good/40 bg-good/10 px-2 py-0.5 text-[10px] font-bold text-good">
            <span aria-hidden>✓</span> Vérifié par l&apos;Ordre
          </p>
        ) : null}
      </div>

      <nav
        aria-label={tiroir ? "Navigation du cabinet (tiroir)" : "Navigation du cabinet"}
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-4"
      >
        <CabinetNav role={active.role} onNaviguer={onNaviguer} />
      </nav>

      {/* ESPACE ACTIF — le bloc qui répond en permanence à « où suis-je ? ».
          C'est la contrepartie du rattachement multiple : on ne peut pas se
          tromper de cabinet sans le voir. */}
      <div className="border-t border-white/10 px-2 py-3">
        {practices.length > 1 ? (
          <details>
            <summary className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-white/5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-or">
              <Initiale nom={active.name} />
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate text-sm font-semibold text-white">{active.name}</span>
                <span className="block text-xs text-or">Espace actif</span>
              </span>
              <span className="shrink-0 text-white/45">
                <SwitchIcon />
              </span>
            </summary>
            <ul className="mt-1 flex flex-col gap-0.5">
              {practices.map((practice) => (
                <li key={practice.id}>
                  <form action={switchPracticeAction}>
                    <input type="hidden" name="practiceId" value={practice.id} />
                    <button
                      type="submit"
                      aria-current={practice.id === active.id ? "true" : undefined}
                      className={[
                        "min-h-[42px] w-full rounded-lg px-3 py-1.5 text-left text-sm transition-colors",
                        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-or",
                        practice.id === active.id
                          ? "bg-white/10 text-white"
                          : "text-white/65 hover:bg-white/5 hover:text-white",
                      ].join(" ")}
                    >
                      <span className="block truncate">{practice.name}</span>
                      <span className="block truncate text-xs text-white/45">
                        {PRACTICE_TYPE_LABELS[practice.type] ?? practice.type} ·{" "}
                        {practiceRoleLabel(practice.role)}
                      </span>
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </details>
        ) : (
          <div className="flex items-center gap-3 rounded-lg px-3 py-2.5">
            <Initiale nom={active.name} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-white">{active.name}</span>
              <span className="block text-xs text-or">Espace actif</span>
            </span>
          </div>
        )}

        {/* LA SEULE SORTIE DE CET ESPACE. <form> et Server Action, jamais un
            window.location vers un GET /logout : un GET destructeur se déclenche
            depuis n'importe quelle balise <img>, et la Server Action fonctionne
            sans JavaScript. */}
        <form action={logoutAction}>
          <button
            type="submit"
            className="mt-1 flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium text-white/65 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-or"
          >
            <span className="text-white/45">
              <LogoutIcon />
            </span>
            Fermer la session
          </button>
        </form>
      </div>
    </div>
  );
}

// Pastille d'initiale. Fond Or, lettre Navy — jamais l'inverse : du texte clair
// sur l'Or de Guinée plafonne à 1.8:1 (R-11).
function Initiale({ nom }: { nom: string }) {
  return (
    <span
      aria-hidden
      className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-or font-display text-sm font-bold text-navy-950"
    >
      {nom.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}
