import { NOM_FICHIER_FEC_DEMO, genererFecDemo } from "@/lib/demo-fec";

// Téléchargement du FEC de démonstration.
//
// Une ROUTE, pas une Server Action : le fichier doit arriver comme un fichier —
// un lien qu'on ouvre, qu'on met en favori, que le navigateur enregistre seul.
// Une action rendrait le contenu dans une réponse que rien ne sait écrire sur
// le disque, et le bouton « Exporter le FEC » ne produirait rien de tangible.
//
// Aucune authentification ici, et c'est délibéré : le fichier ne contient que
// le jeu de démonstration de lib/demo-accounts.ts, qui n'appartient à personne.
// Le vrai export FEC d'une vraie organisation vit derrière trust-api, qui
// exige un mandat actif et un rôle habilité (fec.service.ts) — cette route ne
// touche jamais à ces données et n'ouvre aucun chemin vers elles.
export function GET(): Response {
  const contenu = genererFecDemo();

  return new Response(contenu, {
    headers: {
      // `text/tab-separated-values` plutôt que text/plain : c'est ce qu'est le
      // FEC, et c'est ce qui décide un tableur à ouvrir le fichier en colonnes
      // plutôt qu'en une seule.
      "content-type": "text/tab-separated-values; charset=utf-8",
      "content-disposition": `attachment; filename="${NOM_FICHIER_FEC_DEMO}"`,
      // Le jeu est figé, mais un cabinet qui ré-exporte après avoir changé
      // d'exercice doit obtenir le fichier courant, pas celui du cache.
      "cache-control": "no-store",
    },
  });
}
