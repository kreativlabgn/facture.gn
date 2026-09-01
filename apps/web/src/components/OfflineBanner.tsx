"use client";

import { useSyncExternalStore } from "react";

// PWA offline-first — Phase 1 (ADR-118). Bande discrète affichée uniquement
// quand le navigateur signale l'absence de connexion. `useSyncExternalStore`
// avec un `getServerSnapshot` = « en ligne » : aucun rendu de la bande au SSR,
// donc pas de mismatch d'hydratation (R7 du plan). Aucune dépendance.

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

const isOnlineClient = (): boolean => navigator.onLine;
const isOnlineServer = (): boolean => true;

export function OfflineBanner() {
  const online = useSyncExternalStore(subscribe, isOnlineClient, isOnlineServer);

  if (online) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-navy-950 px-4 py-2 text-center text-xs font-medium text-white"
    >
      Hors connexion — seules les vérifications déjà consultées sont à jour.
    </div>
  );
}
