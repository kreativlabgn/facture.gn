import type { ReactNode } from "react";
import { hasAnyShellScreen } from "@/lib/nav";
import { roleLabel } from "@/lib/permissions";
import { EmptyState } from "@/components/ui";

// Garde d'entrée de la coquille : que voit un membre dont le rôle n'ouvre
// AUCUN écran web ?
//
// Le cas est réel, pas théorique. `delivery_driver` ne possède qu'une seule
// permission (payments:record) et aucun écran web ne la consomme encore : il
// ne peut ni lire les factures (GET /invoices l'exclut), ni voir les clients,
// ni ouvrir les paramètres. Sans ce garde, il obtiendrait une coquille sans
// onglets dont chaque page répondrait 403 — une application qui a l'air
// cassée alors qu'elle applique correctement ses règles.
//
// Ce n'est PAS un garde de sécurité : trust-api reste seul juge (voir
// permissions.ts). C'est un garde d'honnêteté — dire pourquoi l'écran est
// vide plutôt que de laisser l'utilisateur croire à une panne.
export function NavGate({ role, children }: { role: string; children: ReactNode }) {
  if (hasAnyShellScreen(role)) {
    return <>{children}</>;
  }

  return (
    <EmptyState
      title="Aucun écran pour ce rôle"
      description={`Le rôle « ${roleLabel(role)} » n'a pas encore d'écran dans l'application web. Contactez le propriétaire de l'organisation si vous pensez devoir accéder à autre chose.`}
    />
  );
}
