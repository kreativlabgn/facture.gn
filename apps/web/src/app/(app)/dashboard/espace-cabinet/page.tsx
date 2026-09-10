import type { Metadata } from "next";
import { resolveActiveOrganization } from "@/lib/active-organization";
import { PRACTICE_TYPE_LABELS, practiceRoleLabel } from "@/lib/cabinet-nav";
import { requireSessionToken } from "@/lib/session";
import { listMyPractices } from "@/lib/trust-api";
import { Button, Card, EmptyState } from "@/components/ui";
import { entrerDansCabinetAction } from "./actions";

export const metadata: Metadata = { title: "Espace cabinet — facture.gn" };

// LE SEUIL. Cet écran existe pour une seule raison : le tiroir « Plus » menait
// directement au tableau de bord d'un cabinet. Un clic, et l'on se retrouvait
// dans une AUTRE ENTITÉ JURIDIQUE — d'autres clients, d'autres chiffres,
// d'autres obligations — sans un mot, depuis le tableau de bord de son propre
// commerce.
//
// L'accès était légitime : on ne voit ici que les cabinets dont on est
// réellement membre, et trust-api refuse tout le reste en 403. Mais un accès
// légitime qui s'ouvre sans qu'on l'ait demandé reste un défaut : personne ne
// devrait découvrir qu'il a changé d'entreprise en lisant un chiffre qui ne lui
// dit rien.
//
// Deux garanties portées par cet écran :
//   • on NOMME ce qu'on quitte et ce qu'on rejoint, avec le rôle qu'on y tient ;
//   • on y entre par un POST (Server Action), jamais par un <Link>. Un lien se
//     déclenche au frôlement, une soumission demande un geste.
export default async function SeuilCabinetPage() {
  const token = await requireSessionToken();
  const [{ active: organisation }, practices] = await Promise.all([
    resolveActiveOrganization(token),
    listMyPractices(token),
  ]);

  // Le tiroir ne propose cette entrée qu'à partir d'un cabinet. Y arriver sans
  // aucun cabinet signifie une URL tapée à la main : on le dit, sans détour.
  if (practices.length === 0) {
    return (
      <EmptyState
        title="Aucun espace cabinet"
        description="Votre compte n'est rattaché à aucun cabinet comptable, gestionnaire, fiduciaire ou CGA. Cet espace est réservé aux professionnels du chiffre qui suivent la comptabilité d'autres entreprises."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-navy-950">Espace cabinet</h1>
        <p className="mt-2 max-w-prose text-sm text-navy-600">
          Vous êtes actuellement sur{" "}
          <strong className="text-navy-950">{organisation?.name ?? "votre commerce"}</strong>. Un
          cabinet est une <strong className="text-navy-950">entité distincte</strong> : d&apos;autres
          clients, d&apos;autres chiffres, d&apos;autres obligations. Rien n&apos;est partagé entre
          les deux, et vous ne verrez d&apos;un cabinet que ce que votre rôle vous y autorise.
        </p>
      </div>

      <section>
        <h2 className="mb-3 font-display text-lg font-semibold text-navy-950">
          {practices.length > 1 ? "Vos cabinets" : "Votre cabinet"}
        </h2>
        <div className="flex flex-col gap-3">
          {practices.map((practice) => (
            <Card key={practice.id}>
              <form
                action={entrerDansCabinetAction}
                className="flex flex-wrap items-center justify-between gap-4 p-5"
              >
                <input type="hidden" name="practiceId" value={practice.id} />
                <div className="flex min-w-0 items-center gap-4">
                  {/* Fond Or, lettre Navy — jamais l'inverse (R-11, 1.8:1). */}
                  <span
                    aria-hidden
                    className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-or font-display text-base font-bold text-navy-950"
                  >
                    {practice.name.trim().charAt(0).toUpperCase() || "?"}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-display text-base font-bold text-navy-950">
                      {practice.name}
                    </p>
                    <p className="mt-0.5 text-xs text-navy-600">
                      {PRACTICE_TYPE_LABELS[practice.type] ?? practice.type} ·{" "}
                      {practiceRoleLabel(practice.role)}
                    </p>
                  </div>
                </div>
                {/* Un <button> de soumission, pas un lien : c'est le geste qui
                    fait la différence entre changer d'entité et y glisser. */}
                <Button type="submit">Entrer dans cet espace</Button>
              </form>
            </Card>
          ))}
        </div>
      </section>

      <p className="max-w-prose text-xs leading-relaxed text-navy-600">
        Vous reviendrez à {organisation?.name ?? "votre commerce"} depuis « Retour à mon commerce »,
        en bas de la barre latérale du cabinet.
      </p>
    </div>
  );
}
