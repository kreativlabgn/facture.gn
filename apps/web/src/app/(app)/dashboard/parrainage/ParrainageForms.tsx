"use client";

import { useActionState, useState } from "react";
import { Button, Field, TextInput } from "@/components/ui";
import { activerParrainageAction, rattacherParrainAction, type ParrainageActionState } from "./actions";

function Message({ state }: { state: ParrainageActionState }) {
  if (!state) return null;
  return (
    <p
      role="status"
      className={
        "error" in state
          ? "rounded-lg border border-bad bg-bad-bg px-3 py-2 text-sm text-bad-text"
          : "rounded-lg border border-good bg-good-bg px-3 py-2 text-sm text-good-text"
      }
    >
      {"error" in state ? state.error : state.ok}
    </p>
  );
}

export function ActivationForm() {
  const [state, formAction, pending] = useActionState<ParrainageActionState, FormData>(
    async () => activerParrainageAction(),
    null,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <Message state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Activation…" : "Obtenir mon code"}
        </Button>
      </div>
    </form>
  );
}

// Le code, une fois obtenu, ne change plus : le regénérer invaliderait tous les
// partages déjà faits. D'où l'absence de bouton « nouveau code ».
export function CodeAPartager({ code }: { code: string }) {
  const [copie, setCopie] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* JetBrains Mono : identifiant déjà attribué, à recopier caractère par
          caractère — exactement l'usage que la charte réserve au monospace. */}
      <span className="rounded-lg border border-navy-200 bg-navy-50 px-4 py-2.5 font-mono text-xl font-bold tracking-[0.2em] text-navy-950">
        {code}
      </span>
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          // navigator.clipboard manque en http sur certains navigateurs
          // Android : l'échec ne doit pas laisser un « Copié » mensonger.
          // Le gestionnaire ne rend rien — React ignorerait la promesse, et le
          // rejet deviendrait une unhandled rejection.
          void navigator.clipboard
            .writeText(code)
            .then(() => {
              setCopie(true);
              setTimeout(() => setCopie(false), 2000);
            })
            .catch(() => setCopie(false));
        }}
      >
        {copie ? "Copié" : "Copier"}
      </Button>
    </div>
  );
}

export function RattachementForm() {
  const [state, formAction, pending] = useActionState<ParrainageActionState, FormData>(
    rattacherParrainAction,
    null,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field
        label="Code de votre parrain"
        htmlFor="parrainage-code"
        hint="Six caractères, sans les lettres O et I pour éviter la confusion avec 0 et 1."
      >
        <TextInput
          id="parrainage-code"
          name="code"
          type="text"
          required
          maxLength={6}
          autoComplete="off"
          spellCheck={false}
          placeholder="A2B4C6"
          aria-describedby="parrainage-code-hint"
          className="font-mono tracking-[0.2em] uppercase"
        />
      </Field>
      <Message state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer ce code"}
        </Button>
      </div>
    </form>
  );
}
