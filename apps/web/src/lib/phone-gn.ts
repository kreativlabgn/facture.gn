// ── Numéro de téléphone guinéen : de la saisie au comptoir au format canonique ─
//
// ADR-106, vente au comptoir : le commerçant n'a souvent que le numéro de son
// client, dicté à voix haute, écrit par paquets de deux chiffres. Il ne saisira
// pas « +224 ».
//
// LA NORMALISATION EST ICI, ET NULLE PART AILLEURS. Le serveur
// (resolve-customer-by-phone.dto.ts) n'accepte que le format canonique, à
// dessein : si le serveur tolérait AUSSI les formes locales, deux écritures du
// même numéro entreraient en base — « 622000000 » depuis une caisse,
// « +224622000000 » depuis une autre — et le dédoublonnage par téléphone, seule
// raison d'être de ce parcours, ne dédoublonnerait plus rien.

/** Format accepté par trust-api — copie EXACTE de msisdnSchema
 *  (auth/dto/register.dto.ts). Être plus strict ici refuserait un numéro que
 *  POST /customers accepte ; plus laxiste enverrait au serveur ce qu'il
 *  rejettera, en faisant porter l'erreur à l'utilisateur au pire moment. */
const MSISDN_CANONIQUE = /^\+224\d{8,9}$/;

const INDICATIF = "224";

/** `null` quand la saisie ne peut pas être un numéro guinéen — jamais une
 *  chaîne « au mieux » : un numéro approximatif créerait une fiche client sur
 *  un numéro qui appartient à quelqu'un d'autre. */
export function normaliserMsisdnGn(saisie: string): string | null {
  // Espaces, points et tirets seulement : ce sont les séparateurs qu'on écrit
  // en lisant un numéro. Tout autre caractère est laissé en place pour être
  // rejeté plus bas — retirer silencieusement une lettre ou un « + » égaré
  // fabriquerait un numéro que personne n'a saisi.
  const nettoye = saisie.replace(/[\s.-]/g, "");

  let chiffres: string;
  if (nettoye.startsWith("+")) {
    chiffres = nettoye.slice(1);
    if (!chiffres.startsWith(INDICATIF)) {
      // Un indicatif étranger n'est pas un numéro guinéen. Le raccrocher au
      // +224 donnerait un numéro valide… et attribué à quelqu'un d'autre.
      return null;
    }
  } else if (nettoye.startsWith("00")) {
    chiffres = nettoye.slice(2);
    if (!chiffres.startsWith(INDICATIF)) {
      return null;
    }
  } else if (nettoye.length > 9 && nettoye.startsWith(INDICATIF)) {
    // LA COLLISION : « 224000000 » fait 9 chiffres ET commence par 224. C'est
    // la LONGUEUR qui tranche, jamais le préfixe — un numéro national de
    // 9 chiffres reste national, quels que soient ses trois premiers.
    chiffres = nettoye;
  } else {
    chiffres = INDICATIF + nettoye;
  }

  if (!/^\d+$/.test(chiffres)) {
    return null;
  }

  const canonique = `+${chiffres}`;
  return MSISDN_CANONIQUE.test(canonique) ? canonique : null;
}
