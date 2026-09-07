import { NextResponse } from "next/server";
import { requireSessionToken } from "@/lib/session";

// Route Handler plutôt qu'un lien direct vers trust-api : un <a href> ne peut
// pas porter de header Authorization, et le token n'a de toute façon jamais à
// atteindre le navigateur. Même patron que l'export FEC (settings/fec/route.ts).
//
// Pas de résolution d'organisation ici, contrairement au FEC : le FEC porte sur
// l'organisation ACTIVE (choisie dans l'OrgSwitcher), alors qu'une facture est
// désignée par son propre identifiant. GET /invoices/:id/pdf est déjà scopé par
// @OrganizationIdSource + RolesGuard côté trust-api, qui rend un 404 opaque
// pour la facture d'un tiers — on relaie ce statut tel quel plutôt que de
// reconstruire une vérification qui divergerait de la sienne.
const TRUST_API_URL = process.env.TRUST_API_URL ?? "http://localhost:3000";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = await requireSessionToken();

  const reponse = await fetch(`${TRUST_API_URL}/invoices/${encodeURIComponent(id)}/pdf`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!reponse.ok) {
    return NextResponse.json(
      { message: "PDF indisponible pour cette facture" },
      { status: reponse.status },
    );
  }

  // Le corps est relayé en flux, sans transformation : un PDF n'a pas à
  // transiter par un Buffer intermédiaire côté Next.
  return new NextResponse(reponse.body, {
    headers: {
      "Content-Type": reponse.headers.get("content-type") ?? "application/pdf",
      "Content-Disposition":
        reponse.headers.get("content-disposition") ?? `attachment; filename="facture-${id}.pdf"`,
    },
  });
}
