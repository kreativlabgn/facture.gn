import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { formatDate, formatGnf } from "@/lib/format";
import { chargerPortail } from "@/lib/portal";
import { getPortalToken } from "@/lib/portal-session";
import { StatusPill } from "@/components/StatusPill";
import { Card } from "@/components/ui";

export const metadata: Metadata = { title: "Mes factures — facture.gn" };

// Toutes les factures reçues par ce numéro, tous émetteurs confondus, avec un
// filtre par entreprise (`cli-org-filter-row` de la maquette).
//
// Le filtre passe par l'URL et non par un état client : la page reste un
// composant serveur, le lien est partageable, et le retour arrière du
// navigateur refait ce qu'on attend de lui. Il porte le `customerId` — la clé
// que connaît l'API — plutôt que l'organizationId, pour rester alignable sur
// une éventuelle requête serveur plus tard.
export default async function PortailFacturesPage({
  searchParams,
}: {
  searchParams: Promise<{ emetteur?: string }>;
}) {
  const token = await getPortalToken();
  if (!token) {
    redirect("/portail/auth");
  }

  const { emetteur } = await searchParams;
  const { comptes, lignes } = await chargerPortail(token);

  // Un `emetteur` inconnu (URL bricolée, compte retiré depuis) est ignoré
  // plutôt que de rendre une liste vide inexplicable.
  const filtreValide = emetteur && comptes.some((compte) => compte.customerId === emetteur) ? emetteur : null;
  const visibles = filtreValide
    ? lignes.filter((ligne) => ligne.compte.customerId === filtreValide)
    : lignes;

  const total = visibles
    .reduce((somme, ligne) => somme + BigInt(ligne.facture.totalTtc), BigInt(0))
    .toString();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-navy-950">Mes factures</h1>
        <p className="mt-1 text-sm text-navy-600">
          {visibles.length === 0
            ? "Aucune facture."
            : `${visibles.length} facture${visibles.length > 1 ? "s" : ""}, ${formatGnf(total)} au total.`}
        </p>
      </div>

      {/* Filtre par émetteur — masqué quand il n'y a qu'une entreprise :
          un filtre à une seule valeur ne filtre rien. */}
      {comptes.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          <Filtre href="/portail/factures" label="Tous" actif={filtreValide === null} />
          {comptes.map((compte) => (
            <Filtre
              key={compte.customerId}
              href={`/portail/factures?emetteur=${encodeURIComponent(compte.customerId)}`}
              label={compte.organizationName}
              actif={filtreValide === compte.customerId}
            />
          ))}
        </div>
      ) : null}

      <Card>
        {visibles.length === 0 ? (
          <p className="p-8 text-center text-sm text-navy-600">
            Aucune facture n&apos;est rattachée à ce numéro pour cette sélection.
          </p>
        ) : (
          <ul className="divide-y divide-navy-50">
            {visibles.map(({ compte, facture }) => (
              <li key={facture.id}>
                <Link
                  href={`/portail/${encodeURIComponent(facture.id)}`}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4 transition-colors hover:bg-navy-50 focus-visible:bg-navy-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-navy-950"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-sm text-navy-950">{compte.organizationName}</span>
                    <span className="font-mono text-xs text-navy-600">
                      {facture.number ?? "—"} · {formatDate(facture.createdAt)}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="font-mono text-sm font-bold tabular-nums text-navy-950">
                      {formatGnf(facture.totalTtc)}
                    </span>
                    <StatusPill status={facture.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Filtre({ href, label, actif }: { href: string; label: string; actif: boolean }) {
  return (
    <Link
      href={href}
      aria-current={actif ? "true" : undefined}
      className={[
        "rounded-full border px-3 py-1.5 text-sm font-medium transition",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-950",
        actif
          ? "border-navy-950 bg-navy-950 text-white"
          : "border-navy-200 bg-white text-navy-600 hover:text-navy-950",
      ].join(" ")}
    >
      {label}
    </Link>
  );
}
