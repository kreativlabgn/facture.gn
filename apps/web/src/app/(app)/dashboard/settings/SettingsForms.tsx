"use client";

import { useActionState, useState } from "react";
import { roleLabel } from "@/lib/permissions";
import { MIN_TIER_FOR_ROLE, tierIndex, tierLabel, type Tier } from "@/lib/plans";
import { Button } from "@/components/ui";
import {
  createApiKeyAction,
  createBranchAction,
  inviteMemberAction,
  revokeApiKeyAction,
  revokeMemberAction,
  type ApiKeyActionState,
  type SettingsActionState,
} from "./actions";

// Les formulaires des onglets Paramètres. Composants clients parce que chaque
// action doit rendre son résultat LÀ où on a cliqué : un formulaire nu
// rechargerait la page sans jamais dire ce qui s'est passé — et pour la
// génération d'une clé API, le secret disparaîtrait au rechargement sans que
// personne ait pu le copier.

function Retour({ state }: { state: SettingsActionState }) {
  if (!state) return null;
  const erreur = "error" in state;
  return (
    <p role="status" className={`mt-2 text-sm ${erreur ? "text-bad-text" : "text-good-text"}`}>
      {erreur ? state.error : state.ok}
    </p>
  );
}

const CHAMP_CLASSES =
  "min-h-[44px] w-full rounded-lg border border-navy-200 bg-white px-3.5 py-2.5 text-sm text-navy-950 focus:border-2 focus:border-navy-950 focus:outline-none disabled:bg-navy-50 disabled:text-navy-600";

const LABEL_CLASSES =
  "mb-1.5 block font-sans text-[11px] font-semibold tracking-wide text-navy-950 uppercase";

// ── Onglet B — Succursales ──────────────────────────────────────────────────

const TYPES_SUCCURSALE = [
  { valeur: "boutique", label: "Boutique" },
  { valeur: "entrepot", label: "Entrepôt" },
  { valeur: "agence", label: "Agence" },
  { valeur: "en_ligne", label: "En ligne" },
] as const;

export function BranchForm({ bloque, quota }: { bloque: boolean; quota: number | null }) {
  const [state, formAction, pending] = useActionState<SettingsActionState, FormData>(
    createBranchAction,
    null,
  );

  // Le quota est présenté comme une LIMITE DE PALIER, jamais comme une panne :
  // la barrière réelle est côté trust-api (branches.service), et le message dit
  // ce qu'il faut faire pour la lever.
  if (bloque) {
    return (
      <div className="rounded-xl border border-amber bg-amber-bg p-4">
        <p className="font-display text-sm font-bold text-navy-950">Quota de succursales atteint</p>
        <p className="mt-1 text-sm text-navy-700">
          Votre palier en autorise {quota}. Passez à un palier supérieur pour en ouvrir
          d&apos;autres.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="grid grid-cols-1 gap-3 sm:grid-cols-[1.5fr_1fr_auto]">
      <div>
        <label htmlFor="branch-name" className={LABEL_CLASSES}>
          Nom
        </label>
        <input
          id="branch-name"
          name="name"
          required
          maxLength={120}
          placeholder="Boutique Kaloum"
          className={CHAMP_CLASSES}
        />
      </div>
      <div>
        <label htmlFor="branch-type" className={LABEL_CLASSES}>
          Type
        </label>
        <select id="branch-type" name="type" defaultValue="boutique" className={CHAMP_CLASSES}>
          {TYPES_SUCCURSALE.map((type) => (
            <option key={type.valeur} value={type.valeur}>
              {type.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-end">
        <Button type="submit" variant="secondary" disabled={pending} className="w-full sm:w-auto">
          {pending ? "Création…" : "Ajouter"}
        </Button>
      </div>
      <div className="sm:col-span-3">
        <Retour state={state} />
      </div>
    </form>
  );
}

// ── Onglet C — Équipe & rôles ───────────────────────────────────────────────

// Catalogue d'invite-organization-member.dto.ts, à l'identique. `owner` en est
// absent : il n'est jamais assignable par invitation (élévation de privilège —
// seulement à la création de l'organisation). `client_portal` non plus :
// identité transverse auto-résolue par téléphone vérifié (ADR-096), jamais un
// accès que l'organisation accorde ou reprend.
const ROLES_INVITABLES = [
  "admin",
  "accountant_internal",
  "cashier",
  "field_agent",
  "delivery_driver",
  "auditor",
  "approver",
  "tax_controller_readonly",
  "developer_api",
  "inventory_manager",
  "viewer",
] as const;

export function InviteMemberForm({
  palier,
  bloque,
  quota,
}: {
  palier: Tier;
  bloque: boolean;
  quota: number | null;
}) {
  const [state, formAction, pending] = useActionState<SettingsActionState, FormData>(
    inviteMemberAction,
    null,
  );

  if (bloque) {
    return (
      <div className="rounded-xl border border-amber bg-amber-bg p-4">
        <p className="font-display text-sm font-bold text-navy-950">
          Quota de collaborateurs atteint
        </p>
        <p className="mt-1 text-sm text-navy-700">
          Votre palier en autorise {quota}. Passez à un palier supérieur pour agrandir
          l&apos;équipe.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="grid grid-cols-1 gap-3 sm:grid-cols-[1.2fr_1fr_auto]">
      <div>
        <label htmlFor="member-msisdn" className={LABEL_CLASSES}>
          Téléphone du collaborateur
        </label>
        <input
          id="member-msisdn"
          name="msisdn"
          type="tel"
          inputMode="numeric"
          required
          placeholder="622 00 00 00"
          className={`${CHAMP_CLASSES} font-mono`}
        />
        <p className="mt-1 text-xs text-navy-600">
          Il doit déjà avoir un compte facture.gn sur ce numéro.
        </p>
      </div>
      <div>
        <label htmlFor="member-role" className={LABEL_CLASSES}>
          Rôle
        </label>
        <select id="member-role" name="role" defaultValue="cashier" className={CHAMP_CLASSES}>
          {ROLES_INVITABLES.map((role) => {
            const minimum = MIN_TIER_FOR_ROLE[role];
            // Un rôle non débloqué par le palier reste VISIBLE mais désactivé,
            // avec le palier qui l'ouvre. Le masquer laisserait croire qu'il
            // n'existe pas, alors que c'est précisément une raison d'évoluer.
            const verrouille = minimum !== undefined && tierIndex(palier) < tierIndex(minimum);
            return (
              <option key={role} value={role} disabled={verrouille}>
                {roleLabel(role)}
                {verrouille ? ` — ${tierLabel(minimum)} requis` : ""}
              </option>
            );
          })}
        </select>
      </div>
      <div className="flex items-end">
        <Button type="submit" variant="secondary" disabled={pending} className="w-full sm:w-auto">
          {pending ? "Ajout…" : "Ajouter"}
        </Button>
      </div>
      <div className="sm:col-span-3">
        <Retour state={state} />
      </div>
    </form>
  );
}

// Retirer un accès est irréversible dans les faits : la contrainte unique
// (organizationId, userId) est permanente, et une ligne révoquée bloque toute
// réinvitation du même compte. D'où la confirmation explicite — même précédent
// que l'émission d'une facture et la fusion de clients.
export function RevokeMemberForm({ memberId, nom }: { memberId: string; nom: string }) {
  const [state, formAction, pending] = useActionState<SettingsActionState, FormData>(
    revokeMemberAction,
    null,
  );
  const [confirme, setConfirme] = useState(false);

  return (
    <form action={formAction}>
      <input type="hidden" name="memberId" value={memberId} />
      {confirme ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="secondary" disabled={pending}>
            {pending ? "Retrait…" : `Confirmer le retrait de ${nom}`}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setConfirme(false)}>
            Annuler
          </Button>
        </div>
      ) : (
        <Button type="button" variant="ghost" onClick={() => setConfirme(true)}>
          Retirer l&apos;accès
        </Button>
      )}
      <Retour state={state} />
    </form>
  );
}

// ── Onglet D — Clés API ─────────────────────────────────────────────────────

export function ApiKeyForm() {
  const [state, formAction, pending] = useActionState<ApiKeyActionState, FormData>(
    createApiKeyAction,
    null,
  );

  return (
    <form action={formAction}>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="apikey-env" className={LABEL_CLASSES}>
            Environnement
          </label>
          <select
            id="apikey-env"
            name="environment"
            defaultValue="sandbox"
            className={CHAMP_CLASSES}
          >
            <option value="sandbox">Test (sandbox)</option>
            <option value="production">Production</option>
          </select>
        </div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Génération…" : "Générer une clé"}
        </Button>
      </div>

      {state && "error" in state ? (
        <p role="status" className="mt-2 text-sm text-bad-text">
          {state.error}
        </p>
      ) : null}

      {/* Le secret n'existe en clair qu'ICI, une seule fois : il est haché
          (argon2id) côté serveur comme un mot de passe, et ne peut pas être
          relu. Bloc dédié, chasse fixe, coupure autorisée — c'est une valeur à
          copier caractère par caractère. */}
      {state && "secret" in state && state.secret ? (
        <div className="mt-3 rounded-xl border border-amber bg-amber-bg p-4">
          <p className="font-display text-sm font-bold text-navy-950">{state.ok}</p>
          <code className="mt-2 block rounded-lg bg-white px-3 py-2 font-mono text-xs break-all text-navy-950">
            {state.secret}
          </code>
        </div>
      ) : null}
    </form>
  );
}

export function RevokeApiKeyForm({ apiKeyId, label }: { apiKeyId: string; label: string }) {
  const [state, formAction, pending] = useActionState<SettingsActionState, FormData>(
    revokeApiKeyAction,
    null,
  );
  const [confirme, setConfirme] = useState(false);

  return (
    <form action={formAction}>
      <input type="hidden" name="apiKeyId" value={apiKeyId} />
      {confirme ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="secondary" disabled={pending}>
            {pending ? "Révocation…" : `Confirmer la révocation de ${label}`}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setConfirme(false)}>
            Annuler
          </Button>
        </div>
      ) : (
        <Button type="button" variant="ghost" onClick={() => setConfirme(true)}>
          Révoquer
        </Button>
      )}
      <Retour state={state} />
    </form>
  );
}
