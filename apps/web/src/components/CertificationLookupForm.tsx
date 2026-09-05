"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

// Champ + bouton conformes aux specs "Composants UI — Formulaires" (charte +
// maquette consolidée) : bordure hairline `border-navy-200` (= --border-strong
// de la maquette, teinte Navy plutôt qu'un gris neutre), focus 2px Navy, label
// Space Grotesk SemiBold visible au-dessus (pas seulement aria-label — un placeholder seul
// ne suffit pas en plein soleil sur un écran d'entrée de gamme, DAT
// accessibilité). Bouton "primary" : fond Navy, texte blanc, radius 10px.
// Texte du champ en Inter (pas JetBrains Mono) — la maquette de référence
// fixe explicitement `.field input{font-family:'Inter'}`, le mono de la
// charte est réservé à l'AFFICHAGE d'identifiants déjà certifiés, pas à la
// saisie utilisateur.
export function CertificationLookupForm() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const inputId = useId();

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = value.trim();
    if (trimmed) {
      router.push(`/${encodeURIComponent(trimmed)}`);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex-1 text-left">
        <label htmlFor={inputId} className="mb-1.5 block font-display text-[10px] font-semibold tracking-wide text-navy-950 uppercase">
          Identifiant de vérification
        </label>
        <input
          id={inputId}
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="GN-XXXXXXXX-2026-XXXXXX"
          className="w-full rounded-lg border border-navy-200 bg-white px-3.5 py-2.5 text-sm text-navy-950 placeholder:text-navy-600 focus:border-2 focus:border-navy-950 focus:outline-none"
        />
      </div>
      <button
        type="submit"
        className="rounded-[10px] bg-navy-950 px-6 py-2.5 font-display text-sm font-semibold text-white transition hover:bg-navy-800"
      >
        Vérifier
      </button>
    </form>
  );
}
