import { NextResponse } from "next/server";
import { requireSessionToken } from "@/lib/session";

// Mirroir de dashboard/settings/fec/route.ts, mais organizationId vient du
// segment dynamique de l'URL (contexte cabinet : l'organisation ciblée est un
// paramètre, pas déduite du compte connecté) — pas d'appel GET /organizations
// intermédiaire nécessaire. Route Handler plutôt qu'un lien direct : un
// <a href> ne peut pas porter de header Authorization, le token ne doit de
// toute façon jamais atteindre le navigateur.
const TRUST_API_URL = process.env.TRUST_API_URL ?? "http://localhost:3000";

type Params = { organizationId: string };

export async function GET(_request: Request, { params }: { params: Promise<Params> }) {
  const { organizationId } = await params;
  const token = await requireSessionToken();

  const fecResponse = await fetch(`${TRUST_API_URL}/organizations/${encodeURIComponent(organizationId)}/fec`, {
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
