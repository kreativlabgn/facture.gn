import { switchOrganizationAction } from "@/app/(app)/actions";
import { roleLabel } from "@/lib/permissions";
import type { OrganizationSummary } from "@/lib/trust-api";
import { Button, SelectInput } from "@/components/ui";

// Sélecteur d'organisation (F7). Remplace le `organizations[0]` codé en dur
// des anciens layouts, qui condamnait un utilisateur rattaché à plusieurs
// organisations — un comptable, un dirigeant de groupe — à ne jamais voir que
// la première.
//
// Composant serveur : un <form> qui poste une Server Action, pas de state
// client. Il fonctionne donc sans JavaScript, et le bouton « Changer » est
// assumé plutôt que masqué derrière un `onChange` — un select qui navigue au
// premier mouvement du doigt est un piège sur un écran tactile.
export function OrgSwitcher({
  organizations,
  active,
}: {
  organizations: readonly OrganizationSummary[];
  active: OrganizationSummary;
}) {
  if (organizations.length <= 1) {
    return (
      <p className="text-sm">
        <span className="font-semibold text-navy-950">{active.name}</span>
        <span className="ml-2 text-xs text-navy-600">{roleLabel(active.role)}</span>
      </p>
    );
  }

  return (
    <form action={switchOrganizationAction} className="flex items-center gap-2">
      <label htmlFor="organization-switcher" className="sr-only">
        Organisation active
      </label>
      <SelectInput
        id="organization-switcher"
        name="organizationId"
        defaultValue={active.id}
        className="w-auto max-w-[14rem] py-1.5 text-sm"
      >
        {organizations.map((organization) => (
          <option key={organization.id} value={organization.id}>
            {organization.name} — {roleLabel(organization.role)}
          </option>
        ))}
      </SelectInput>
      <Button type="submit" variant="secondary" className="min-h-[36px] px-3 py-1.5 text-xs">
        Changer
      </Button>
    </form>
  );
}
