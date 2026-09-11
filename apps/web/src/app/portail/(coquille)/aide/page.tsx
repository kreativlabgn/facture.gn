import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui";

export const metadata: Metadata = { title: "Aide — facture.gn" };

// Écran d'aide du portail acheteur. Contenu statique : aucune route de support
// n'existe côté trust-api (le module `notifications` n'a pas de contrôleur, et
// il n'y a pas de table de tickets). Un formulaire de contact qui ne poste
// nulle part serait pire que pas de formulaire du tout.
//
// Les réponses sont écrites du point de vue de l'acheteur, avec ce que le
// produit fait RÉELLEMENT — pas ce qu'on aimerait qu'il fasse.
const QUESTIONS = [
  {
    q: "Pourquoi me demande-t-on un code par SMS ?",
    r: "Vos factures ne regardent que vous. Le code prouve que vous détenez bien le numéro auquel elles ont été adressées. Il est valable cinq minutes et ne sert qu'une fois.",
  },
  {
    q: "Je ne reçois pas le code.",
    r: "Vérifiez que le numéro saisi est bien celui que le commerçant a enregistré, au format +224 suivi de 8 ou 9 chiffres. Si vous utilisez plusieurs numéros, essayez l'autre — c'est la cause la plus fréquente.",
  },
  {
    q: "Cette facture est-elle authentique ?",
    r: "Chaque facture certifiée porte un identifiant de vérification. Depuis le détail d'une facture, le lien « Vérifier l'authenticité » ouvre une page publique qui confirme l'émetteur, le montant et l'intégrité du document — sans compte et sans connexion.",
  },
  {
    q: "À quoi correspond mon encours ?",
    r: "C'est la somme de vos factures encore dues chez une entreprise donnée. Certaines fixent un plafond ; vous le voyez alors sur votre accueil, avec la part déjà utilisée.",
  },
  {
    q: "Comment payer ?",
    r: "Depuis le détail d'une facture, le bouton « Payer maintenant » vous montre le montant et les frais avant tout paiement, puis vous conduit à votre opérateur — Orange Money ou MTN MoMo.",
  },
  {
    q: "Une facture manque, ou n'est pas la mienne.",
    r: "Seul le commerçant qui a émis la facture peut corriger le numéro auquel elle est adressée. Contactez-le directement : facture.gn ne modifie jamais une facture émise.",
  },
];

export default function PortailAidePage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-navy-950">Aide</h1>
        <p className="mt-1 max-w-prose text-sm text-navy-600">
          Les questions que se posent le plus souvent les acheteurs.
        </p>
      </div>

      <Card>
        <dl className="divide-y divide-navy-50">
          {QUESTIONS.map(({ q, r }) => (
            <div key={q} className="px-5 py-4">
              <dt className="font-display text-sm font-semibold text-navy-950">{q}</dt>
              <dd className="mt-1 max-w-prose text-sm leading-relaxed text-navy-600">{r}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card>
        <div className="p-5">
          <h2 className="font-display text-sm font-semibold text-navy-950">
            Une question sur une facture précise
          </h2>
          <p className="mt-1 max-w-prose text-sm text-navy-600">
            Adressez-vous à l&apos;entreprise qui l&apos;a émise : c&apos;est elle qui connaît la
            commande, la livraison et le règlement. Son nom figure en tête de chaque facture, dans{" "}
            <Link href="/portail/factures" className="underline underline-offset-2">
              Mes factures
            </Link>
            .
          </p>
        </div>
      </Card>
    </div>
  );
}
