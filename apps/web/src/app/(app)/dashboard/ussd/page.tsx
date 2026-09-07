import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { UssdSimulator } from "./UssdSimulator";

export const metadata: Metadata = { title: "Simulateur USSD — facture.gn" };

// Le canal *620# est la promesse d'inclusion de facture.gn : certifier une
// vente depuis un téléphone à touches, sans internet et sans smartphone. Il
// existe côté serveur depuis août 2026 — un automate de plus de mille lignes,
// cinq menus, authentification par PIN — mais rien ne permettait de le VOIR :
// il fallait un agrégateur ou un curl.
//
// Cet écran est ce chaînon manquant. Il ne simule pas le comportement du
// serveur, il l'interroge réellement : chaque touche part vers
// POST /ussd/session, et l'état des menus vit dans ussd_session comme pour un
// vrai appel. Ce qui s'affiche est donc ce qu'un marchand verrait.
//
// SOUS /dashboard, DERRIÈRE L'AUTHENTIFICATION, à dessein — voir la note du
// relais (session/route.ts) : ouvrir cette route au public offrirait à
// n'importe qui le moyen de verrouiller le PIN de n'importe quel marchand.
export default function UssdSimulatorPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-navy-950">Simulateur USSD</h1>
        <p className="mt-1 max-w-2xl text-sm text-navy-600">
          Le canal <span className="font-mono">*620#</span> tel qu&apos;un marchand le vit depuis un
          téléphone à touches. Les appels partent vraiment vers la passerelle : ce que vous voyez à
          l&apos;écran est ce que le serveur répond.
        </p>
      </div>

      <UssdSimulator />

      <Card>
        <div className="flex flex-col gap-3 p-5">
          <h2 className="font-display text-base font-semibold text-navy-950">Deux choses à savoir</h2>
          <p className="max-w-2xl text-sm text-navy-600">
            <strong className="text-navy-950">Une saisie à la fois.</strong> Contrairement à la
            convention répandue chez les agrégateurs, la passerelle ne reçoit jamais l&apos;historique
            cumulé (<span className="font-mono">1*2*3</span>) : elle reçoit la dernière saisie seule et
            garde l&apos;état de son côté. C&apos;est ce qui rend possible les raccourcis du menu
            racine, où <span className="font-mono">1*50000</span> désigne une émission anonyme de
            50 000 GNF et non une suite de choix.
          </p>
          <p className="max-w-2xl text-sm text-navy-600">
            <strong className="text-navy-950">Les actions sont réelles.</strong> Émettre une facture
            ici l&apos;émet pour de bon, et trois PIN erronés verrouillent le compte visé comme lors
            d&apos;un vrai appel. Utilisez un numéro de test.
          </p>
        </div>
      </Card>
    </div>
  );
}
