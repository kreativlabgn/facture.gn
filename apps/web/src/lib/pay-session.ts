// ── Jeton éphémère du checkout public (Chantier 3) ──────────────────────────
//
// PAS `fg_portal` : ce nom est DÉJÀ pris par la session OTP du portail acheteur
// (lib/portal-session.ts), qui porte un JWT de 12 h sur tout le site. Le
// réutiliser ici écraserait la session d'un acheteur connecté dès qu'il ouvre un
// lien de paiement — il perdrait l'accès à /portail/factures sans comprendre
// pourquoi. Deux durées de vie, deux portées, deux cookies.
//
// CE QUE CE JETON FAIT, EXACTEMENT :
//   • il lie l'appel de la Server Action à un chargement préalable de la page de
//     CETTE facture (la signature couvre l'invoiceId, le `path` du cookie le
//     confine à cette URL) ;
//   • il périme au bout de 15 minutes, ce qui borne la durée pendant laquelle un
//     cookie récupéré sur un téléphone prêté reste utilisable ;
//   • il empêche qu'un même cookie serve à déclencher des débits sur d'autres
//     factures en changeant l'identifiant dans la requête.
//
// CE QU'IL NE FAIT PAS, et il faut le dire clairement : ce n'est pas une
// protection anti-IDOR en lecture. La page est publique et pose elle-même le
// cookie au premier chargement — quiconque atteint l'URL obtient un jeton
// valide. Ce qui protège la LECTURE reste ce qui la protégeait déjà : un
// identifiant de facture en UUID v4, non énumérable, et un 404 qui ne distingue
// pas « facture inexistante » de « aucun lien de paiement actif ». Prétendre
// autre chose donnerait un faux sentiment de sécurité à la revue suivante.

export const PAY_COOKIE_NAME = "fg_pay";

// 15 minutes : le temps de lire un récapitulatif, saisir un numéro et composer
// un code sur son téléphone. Au-delà, un rechargement de page en redonne un.
export const PAY_TTL_SECONDS = 15 * 60;

// Portée réduite à la facture concernée, jamais `/` : le navigateur n'enverra ce
// cookie à aucune autre page du site, checkout d'une autre facture compris.
export function cheminCookiePaiement(invoiceId: string): string {
  return `/pay/${encodeURIComponent(invoiceId)}`;
}

// Fail-closed, comme DJOMY_WEBHOOK_STUB_SECRET : un secret absent ne dégrade pas
// en « on laisse passer », il ferme le paiement. Une signature à secret vide ne
// signerait rien du tout — le jeton deviendrait forgeable par n'importe qui.
function lireSecret(): string {
  const secret = process.env.PAY_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "PAY_SESSION_SECRET manquant ou trop court (32 caractères minimum) — " +
        "le checkout Mobile Money ne peut pas signer ses jetons de session",
    );
  }
  return secret;
}

// Web Crypto et non node:crypto : ce module est appelé depuis le middleware,
// qui tourne sur le runtime Edge, ET depuis une Server Action, qui tourne sous
// Node. `crypto.subtle` est le seul HMAC disponible des deux côtés.
async function signer(invoiceId: string, expiration: number): Promise<string> {
  const cle = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(lireSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    cle,
    new TextEncoder().encode(`${invoiceId}:${expiration}`),
  );
  return base64url(new Uint8Array(signature));
}

function base64url(octets: Uint8Array): string {
  let binaire = "";
  for (const octet of octets) {
    binaire += String.fromCharCode(octet);
  }
  return btoa(binaire).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function creerJetonPaiement(invoiceId: string): Promise<string> {
  const expiration = Math.floor(Date.now() / 1000) + PAY_TTL_SECONDS;
  return `${expiration}.${await signer(invoiceId, expiration)}`;
}

/** `true` seulement si le jeton est bien formé, non expiré, ET signé pour CETTE
 *  facture. Les trois conditions, jamais deux — un jeton valide pour une autre
 *  facture est exactement l'abus que cette fonction existe pour refuser. */
export async function jetonPaiementValide(
  invoiceId: string,
  jeton: string | undefined,
): Promise<boolean> {
  if (!jeton) {
    return false;
  }
  const separateur = jeton.indexOf(".");
  if (separateur <= 0) {
    return false;
  }

  const expiration = Number(jeton.slice(0, separateur));
  if (!Number.isInteger(expiration) || expiration <= Math.floor(Date.now() / 1000)) {
    return false;
  }

  return comparaisonConstante(jeton.slice(separateur + 1), await signer(invoiceId, expiration));
}

// Jamais `===` sur une signature : une comparaison qui s'arrête au premier
// caractère différent laisse mesurer, essai après essai, à quel rang elle a
// cédé. Même posture qu'InternalAuthGuard côté money-api.
function comparaisonConstante(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let ecart = 0;
  for (let i = 0; i < a.length; i++) {
    ecart |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return ecart === 0;
}
