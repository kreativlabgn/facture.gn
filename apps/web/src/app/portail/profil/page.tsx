import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { formatGnf } from "@/lib/format";
import { chargerPortail } from "@/lib/portal";
import { getPortalToken } from "@/lib/portal-session";
import { Button, Card } from "@/components/ui";
import { logoutPortalAction } from "./actions";

export const metadata: Metadata = { title: "Profil — facture.gn" };

// Profil du portail acheteur.
//
// PAS DE GESTION DES NUMÉROS, contrairement à la maquette (`cli-phone-list`,
// `cli-add-number-trigger`, `cli-add-number-form`) : ce n'est pas un oubli,
// c'est un refus de l'API. POST /auth/phones vit sur AuthController, qui ne
// porte pas @AllowClientPortalScope() — JwtAuthGuard rejette donc tout token
// `scope:"client_portal"` avec un 403 explicite (« Ce token (portail client)
// n'est pas autorisé sur cette route »), vérifié contre l'API. Et aucune route
// ne LIT les numéros vérifiés d'un utilisateur.
//
// Ajouter le décorateur serait une décision de sécurité, pas un détail
// d'affichage : elle élargirait la portée d'un token obtenu par simple SMS à
// l'ajout de numéros sur un compte qui peut aussi être celui d'un commerçant.
// Elle appartient au backend, pas à cet écran.
//
// En attendant, le chemin qui MARCHE est expliqué franchement : fermer la
// session et rouvrir avec l'autre numéro. C'est exactement ce que fait le
// bouton ci-dessous.
export default async function PortailProfilPage() {
  const token = await getPortalToken();
  if (!token) {
    redirect("/portail/auth");
  }

  const { comptes, totalDu } = await chargerPortail(token);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-navy-950">Profil</h1>
        <p className="mt-1 text-sm text-navy-600">
          Votre session est ouverte pour le numéro que vous avez confirmé par SMS.
        </p>
      </div>

      <Card>
        <div className="border-b border-navy-50 px-5 py-4">
          <h2 className="font-display text-base font-semibold text-navy-950">
            Entreprises qui vous facturent
          </h2>
        </div>
        {comptes.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-navy-600">
            Aucune entreprise n&apos;a encore facturé ce numéro.
          </p>
        ) : (
          <ul className="divide-y divide-navy-50">
            {comptes.map((compte) => (
              <li
                key={compte.customerId}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-4"
              >
                <span className="text-sm text-navy-950">{compte.organizationName}</span>
                <span className="font-mono text-sm tabular-nums text-navy-600">
                  {formatGnf(compte.runningBalance)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {comptes.length > 0 ? (
          <div className="border-t border-navy-50 px-5 py-3">
            <p className="font-mono text-sm font-bold tabular-nums text-navy-950">
              Total dû : {formatGnf(totalDu)}
            </p>
          </div>
        ) : null}
      </Card>

      <Card>
        <div className="flex flex-col gap-3 p-5">
          <h2 className="font-display text-base font-semibold text-navy-950">
            Vous utilisez un autre numéro ?
          </h2>
          <p className="max-w-prose text-sm text-navy-600">
            Ce portail affiche les factures adressées au seul numéro de la session en cours. Si une
            facture vous a été adressée sur un autre de vos numéros, fermez cette session et
            rouvrez-en une avec celui-là.
          </p>
          <p className="max-w-prose text-sm text-navy-600">
            Rattacher plusieurs numéros à un même accès n&apos;est pas encore possible depuis le
            portail. Pour corriger le numéro figurant sur une facture, adressez-vous à
            l&apos;entreprise qui l&apos;a émise.
          </p>
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-3 p-5">
          <h2 className="font-display text-base font-semibold text-navy-950">Fermer la session</h2>
          <p className="max-w-prose text-sm text-navy-600">
            À faire systématiquement sur un téléphone partagé. Vous pourrez rouvrir une session à
            tout moment avec un nouveau code par SMS.
          </p>
          <form action={logoutPortalAction}>
            <Button type="submit" variant="secondary">
              Fermer ma session
            </Button>
          </form>
        </div>
      </Card>
    </div>
  );
}
