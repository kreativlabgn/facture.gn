import Link from "next/link";
import { Card } from "@/components/ui";

// Frontière `notFound()` de la coquille. Sans ce fichier, Next rendait une page
// pratiquement vide — juste l'en-tête, aucun message : l'utilisateur ne savait
// ni ce qui s'était passé, ni où aller. Deux écrans appellent déjà notFound()
// (détail facture et détail client) ; ils partagent désormais cette sortie.
//
// LE MESSAGE RESTE VOLONTAIREMENT VAGUE sur la cause. Côté trust-api, le
// RolesGuard rend le même 404 opaque pour une ressource inexistante et pour
// celle d'une autre organisation (correctif d'opacification, 7 septembre) —
// précisément pour qu'on ne puisse pas deviner l'existence d'un document en
// sondant des identifiants. Écrire ici « ce document appartient à une autre
// organisation » redonnerait au navigateur l'oracle que l'API vient de fermer.
export default function DashboardNotFound() {
  return (
    <Card>
      <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
        <h1 className="font-display text-xl font-bold text-navy-950">Document introuvable</h1>
        <p className="max-w-md text-sm text-navy-600">
          Ce document n&apos;existe pas, ou n&apos;est pas accessible depuis l&apos;organisation
          active. Si vous en gérez plusieurs, vérifiez celle sélectionnée en haut de l&apos;écran.
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-4 text-sm font-medium text-navy-950">
          <Link href="/dashboard/invoices" className="underline underline-offset-2">
            Voir mes factures
          </Link>
          <Link href="/dashboard" className="underline underline-offset-2">
            Retour à l&apos;accueil
          </Link>
        </div>
      </div>
    </Card>
  );
}
