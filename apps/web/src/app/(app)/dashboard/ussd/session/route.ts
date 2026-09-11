import { NextResponse } from "next/server";
import { requireSessionToken } from "@/lib/session";

// Relais du simulateur vers POST /ussd/session.
//
// POURQUOI UN RELAIS AUTHENTIFIÉ ALORS QUE L'ENDPOINT EST @Public()
// Côté trust-api, la route est publique parce que l'appelant légitime est
// l'agrégateur USSD (Orange/MTN) — un pair réseau de confiance, pas un
// navigateur. L'exposer telle quelle depuis le web ouvrirait deux abus qu'un
// agrégateur ne peut pas commettre :
//
//   1. Le verrouillage de PIN se retourne en déni de service. Trois PIN faux
//      verrouillent le compte (ussd-auth.service.ts) : n'importe qui pourrait
//      couper n'importe quel marchand du canal *620# en saisissant son numéro.
//   2. Chaque appel crée une ligne ussd_session, sans authentification ni
//      limite de débit (aucun @Throttle sur UssdController).
//
// Ce fichier vit donc sous /dashboard, derrière le proxy : simuler exige
// d'être connecté. La session USSD simulée, elle, reste bien anonyme du point
// de vue de trust-api — c'est tout l'intérêt du simulateur.
const TRUST_API_URL = process.env.TRUST_API_URL ?? "http://localhost:3000";

export async function POST(request: Request) {
  // Le token n'est PAS transmis à trust-api : /ussd/session n'en veut pas et
  // l'agrégateur réel n'en a aucun. Il sert uniquement à prouver, ici, que
  // l'appelant est un utilisateur connecté de la plateforme.
  await requireSessionToken();

  const corps = (await request.json().catch(() => null)) as {
    sessionId?: unknown;
    phone?: unknown;
    input?: unknown;
  } | null;

  if (!corps || typeof corps.sessionId !== "string" || typeof corps.phone !== "string") {
    return NextResponse.json({ message: "Requête invalide" }, { status: 400 });
  }

  const reponse = await fetch(`${TRUST_API_URL}/ussd/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      sessionId: corps.sessionId,
      phone: corps.phone,
      // `input` est la SEULE dernière saisie, jamais un historique cumulé —
      // voir ussd-request.dto.ts. Une chaîne vide est légitime : c'est ce que
      // reçoit le serveur au décrochage, et ce qui déclenche le menu racine.
      input: typeof corps.input === "string" ? corps.input : "",
    }),
  });

  // Le corps est relayé tel quel, statut compris : les erreurs de validation de
  // trust-api (msisdn mal formé, par exemple) sont exactement ce que le
  // simulateur doit montrer, pas quelque chose à masquer derrière un message
  // maison qui divergerait du vrai comportement de la passerelle.
  const charge = await reponse.text();
  return new NextResponse(charge, {
    status: reponse.status,
    headers: { "Content-Type": reponse.headers.get("content-type") ?? "application/json" },
  });
}
