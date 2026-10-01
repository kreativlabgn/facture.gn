"use client";

import { useActionState } from "react";
import { Button, Field, SelectInput } from "@/components/ui";
import { modeLabel, palierLabel } from "@/lib/cabinet-nav";
import { PARTNER_TIERS, SETTLEMENT_MODES } from "@/lib/trust-api";
import {
  changerModeReversementAction,
  changerPalierAction,
  type ReglagesActionState,
} from "./actions";

function Message({ state }: { state: ReglagesActionState }) {
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

export function PalierForm({ tierActuel }: { tierActuel: string }) {
  const [state, formAction, pending] = useActionState<ReglagesActionState, FormData>(
    changerPalierAction,
    null,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field
        label="Palier partenaire"
        htmlFor="reglages-tier"
        hint="Le changement prend effet immédiatement, sans validation de notre part."
      >
        <SelectInput
          id="reglages-tier"
          name="tier"
          defaultValue={tierActuel}
          aria-describedby="reglages-tier-hint"
        >
          {PARTNER_TIERS.map((tier) => (
            <option key={tier} value={tier}>
              {palierLabel(tier)}
            </option>
          ))}
        </SelectInput>
      </Field>
      <Message state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Enregistrement…" : "Changer de palier"}
        </Button>
      </div>
    </form>
  );
}

export function ModeReversementForm({ modeActuel }: { modeActuel: string }) {
  const [state, formAction, pending] = useActionState<ReglagesActionState, FormData>(
    changerModeReversementAction,
    null,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field
        label="Mode de reversement"
        htmlFor="reglages-mode"
        hint="N'affecte que les commissions à venir : celles déjà générées gardent le mode en vigueur au moment où elles ont été acquises."
      >
        <SelectInput
          id="reglages-mode"
          name="mode"
          defaultValue={modeActuel}
          aria-describedby="reglages-mode-hint"
        >
          {SETTLEMENT_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {modeLabel(mode)}
            </option>
          ))}
        </SelectInput>
      </Field>
      <Message state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Enregistrement…" : "Changer de mode"}
        </Button>
      </div>
    </form>
  );
}
