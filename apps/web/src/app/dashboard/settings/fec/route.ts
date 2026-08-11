import { NextResponse } from "next/server";
import { requireSessionToken } from "@/lib/session";

// Route Handler plutôt qu'un lien direct vers trust-api : un <a href> ne peut
// pas porter de header Authorization, et le token ne doit de toute façon
// jamais atteindre le navigateur. On relaie ici la réponse text/plain de
// trust-api telle quelle (streaming, pas de transformation).
const TRUST_API_URL = process.env.TRUST_API_URL ?? "http://localhost:3000";

export async function GET() {
  const token = await requireSessionToken();

  const orgResponse = await fetch(`${TRUST_API_URL}/organizations`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!orgResponse.ok) {
    return NextResponse.json({ message: "Organisation introuvable" }, { status: orgResponse.status });
  }
  const organizations = await orgResponse.json();
  const organization = organizations[0];
  if (!organization) {
    return NextResponse.json({ message: "Aucune organisation associée à ce compte" }, { status: 404 });
  }

  const fecResponse = await fetch(`${TRUST_API_URL}/organizations/${organization.id}/fec`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!fecResponse.ok) {
    return NextResponse.json({ message: "Export FEC impossible" }, { status: fecResponse.status });
  }

  return new NextResponse(fecResponse.body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": fecResponse.headers.get("content-disposition") ?? `attachment; filename="FEC.txt"`,
    },
  });
}
