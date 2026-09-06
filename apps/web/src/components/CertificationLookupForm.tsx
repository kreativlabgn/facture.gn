"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button, Field, TextInput } from "@/components/ui";

// Champ + bouton conformes aux specs "Composants UI — Formulaires" (charte +
// maquette consolidée), via les primitives : bordure hairline `border-navy-200`
// (= --border-strong de la maquette, teinte Navy plutôt qu'un gris neutre),
// focus Navy, label visible au-dessus — pas seulement un aria-label : un
// placeholder seul ne suffit pas en plein soleil sur un écran d'entrée de
// gamme (DAT accessibilité). Bouton "primary" : fond Navy, texte blanc.
//
// Le libellé est en Inter et non en Space Grotesk : à 11px on est sous le
// plancher de 12px que la charte §Typographie fixe au display (voir la
// primitive Field). Le texte SAISI est en Inter lui aussi — la maquette fixe
// explicitement `.field input{font-family:'Inter'}`, le mono de la charte
// étant réservé à l'AFFICHAGE d'identifiants déjà certifiés, jamais à la
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
        <Field label="Identifiant de vérification" htmlFor={inputId}>
          <TextInput
            id={inputId}
            type="text"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="GN-XXXXXXXX-2026-XXXXXX"
          />
        </Field>
      </div>
      <Button type="submit">Vérifier</Button>
    </form>
  );
}
