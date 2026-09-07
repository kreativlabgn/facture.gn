"use client";

import { useCallback, useRef, useState } from "react";
import { Button, Card } from "@/components/ui";

// Simulateur du canal *620#.
//
// LE PROTOCOLE EST CELUI DE trust-api, PAS CELUI D'AFRICA'S TALKING.
// La convention répandue (accumuler les saisies « 1*2*3 » et renvoyer la chaîne
// entière à chaque tour, réponses préfixées CON/END) ne s'applique PAS ici :
// ussd-request.dto.ts dit explicitement « input = SEULE la dernière saisie,
// jamais l'historique cumulé », l'état vit côté serveur dans ussd_session, et
// la réponse est un objet { continue, text }.
//
// Ce n'est pas un détail de forme : au menu racine, `1*50000` et `2*<code>` sont
// de VRAIS raccourcis (émission anonyme, vérification de reçu — voir
// ANONYMOUS_EMISSION_SHORTCUT). Une saisie cumulée serait donc indissociable
// d'un raccourci légitime, et le simulateur mentirait sur le comportement réel.

const CODE_USSD = "*620#";

interface UssdResponse {
  continue: boolean;
  text: string;
}

interface Echange {
  envoye: string;
  recu: string;
  ouverte: boolean;
}

const TOUCHES = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

function nouvelIdentifiantSession(): string {
  return `sim-${Math.random().toString(36).slice(2, 11)}`;
}

// trust-api rend DEUX formes d'erreur, et n'en montrer qu'une viderait le
// simulateur de son intérêt : une exception Nest porte `message`, alors qu'un
// rejet du ZodValidationPipe porte `fieldErrors` (« msisdn attendu au format
// +224XXXXXXXXX »). C'est justement la seconde qu'on veut lire ici.
async function messageErreur(reponse: Response): Promise<string> {
  const corps = (await reponse.json().catch(() => null)) as {
    message?: unknown;
    fieldErrors?: Record<string, unknown>;
  } | null;

  if (corps?.fieldErrors) {
    const details = Object.entries(corps.fieldErrors)
      .map(([champ, messages]) => `${champ} : ${Array.isArray(messages) ? messages.join(", ") : String(messages)}`)
      .join(" · ");
    if (details) {
      return details;
    }
  }
  if (Array.isArray(corps?.message)) {
    return corps.message.join(", ");
  }
  if (typeof corps?.message === "string") {
    return corps.message;
  }
  return `La passerelle a répondu ${reponse.status}`;
}

export function UssdSimulator() {
  const [numero, setNumero] = useState("620000001");
  const [sessionId, setSessionId] = useState(nouvelIdentifiantSession);
  const [saisie, setSaisie] = useState("");
  const [ecran, setEcran] = useState<string | null>(null);
  const [ouverte, setOuverte] = useState(false);
  const [echanges, setEchanges] = useState<Echange[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const champ = useRef<HTMLInputElement>(null);

  const msisdn = `+224${numero}`;
  const msisdnValide = /^\+224\d{8,9}$/.test(msisdn);

  const envoyer = useCallback(
    async (input: string) => {
      setEnCours(true);
      setErreur(null);
      try {
        const reponse = await fetch("/dashboard/ussd/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, phone: msisdn, input }),
        });

        if (!reponse.ok) {
          setErreur(await messageErreur(reponse));
          return;
        }

        const data = (await reponse.json()) as UssdResponse;
        setEcran(data.text);
        setOuverte(data.continue);
        setEchanges((precedents) => [
          ...precedents,
          { envoye: input, recu: data.text, ouverte: data.continue },
        ]);
        setSaisie("");
        champ.current?.focus();
      } catch {
        setErreur("Impossible de joindre la passerelle.");
      } finally {
        setEnCours(false);
      }
    },
    [msisdn, sessionId],
  );

  // Décrocher : le serveur reçoit une saisie VIDE, et c'est elle qui déclenche
  // le menu racine (handleRoot : `if (!input) return ROOT_MENU`).
  const composer = () => void envoyer("");

  const raccrocher = () => {
    setSessionId(nouvelIdentifiantSession());
    setSaisie("");
    setEcran(null);
    setOuverte(false);
    setEchanges([]);
    setErreur(null);
  };

  const demarree = echanges.length > 0;

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[auto_1fr]">
      {/* ── Le combiné ───────────────────────────────────────────────────── */}
      <div className="flex justify-center">
        <div className="w-[320px] rounded-[36px] border-4 border-navy-800 bg-navy-950 p-5">
          {/* L'écran. Fond clair et chasse fixe plutôt qu'un vert LCD :
              l'écran d'un téléphone d'entrée de gamme se lit en plein soleil,
              et la charte n'a pas de teinte pour ça — voir la note de la page. */}
          <div className="mb-5 flex h-56 flex-col rounded-lg border border-navy-800 bg-grey p-3">
            <div className="mb-2 flex items-center justify-between text-[10px] text-navy-600">
              <span className="font-mono">GN · Orange / MTN</span>
              <span className="font-mono">{ouverte ? "session ouverte" : demarree ? "raccroché" : "veille"}</span>
            </div>
            <div
              role="status"
              aria-live="polite"
              className="flex-1 overflow-y-auto font-mono text-[13px] leading-relaxed whitespace-pre-wrap text-navy-950"
            >
              {enCours
                ? "…"
                : (ecran ??
                  `Composez ${CODE_USSD} puis Appeler.\n\nAucune donnée n'est envoyée avant l'appel.`)}
            </div>
          </div>

          {/* Saisie */}
          <label className="sr-only" htmlFor="ussd-saisie">
            Saisie à envoyer
          </label>
          <input
            id="ussd-saisie"
            ref={champ}
            type="text"
            inputMode="text"
            value={saisie}
            onChange={(event) => setSaisie(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && ouverte && saisie.trim()) {
                event.preventDefault();
                void envoyer(saisie.trim());
              }
            }}
            placeholder={ouverte ? "Votre choix" : CODE_USSD}
            disabled={!ouverte || enCours}
            className="mb-4 w-full rounded-lg border border-navy-800 bg-navy-950 px-3 py-2 text-center font-mono text-sm text-white placeholder:text-white/40 focus:outline-2 focus:outline-offset-2 focus:outline-or disabled:opacity-60"
          />

          {/* Décrocher / raccrocher */}
          <div className="mb-5 grid grid-cols-2 gap-3">
            {ouverte ? (
              <Button
                type="button"
                onClick={() => void envoyer(saisie.trim())}
                disabled={enCours || !saisie.trim()}
                className="w-full"
              >
                Envoyer
              </Button>
            ) : (
              <Button
                type="button"
                onClick={composer}
                disabled={enCours || !msisdnValide}
                className="w-full"
              >
                Appeler
              </Button>
            )}
            <Button type="button" variant="secondary" onClick={raccrocher} className="w-full">
              Raccrocher
            </Button>
          </div>

          {/* Clavier */}
          <div className="grid grid-cols-3 gap-2">
            {TOUCHES.map((touche) => (
              <button
                key={touche}
                type="button"
                onClick={() => setSaisie((precedent) => precedent + touche)}
                disabled={!ouverte || enCours}
                className="h-11 rounded-lg border border-navy-800 bg-navy-800 font-mono text-sm font-bold text-white transition-colors hover:bg-navy-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-or disabled:opacity-40"
              >
                {touche}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Panneau de contexte ─────────────────────────────────────────── */}
      <div className="flex flex-col gap-6">
        <Card>
          <div className="flex flex-col gap-4 p-5">
            <h2 className="font-display text-base font-semibold text-navy-950">Contexte de l&apos;appel</h2>

            <div>
              <label
                htmlFor="ussd-numero"
                className="mb-1 block text-xs font-semibold tracking-wide text-navy-600 uppercase"
              >
                Numéro appelant
              </label>
              <div className="flex overflow-hidden rounded-lg border border-navy-200">
                <span className="border-r border-navy-200 bg-navy-50 px-3 py-2 font-mono text-sm text-navy-600">
                  +224
                </span>
                <input
                  id="ussd-numero"
                  type="text"
                  inputMode="numeric"
                  value={numero}
                  onChange={(event) => setNumero(event.target.value.replace(/\D/g, ""))}
                  disabled={demarree}
                  className="w-full px-3 py-2 font-mono text-sm text-navy-950 focus:outline-2 focus:outline-offset-[-2px] focus:outline-navy-950 disabled:bg-navy-50"
                />
              </div>
              <p className="mt-1 text-xs text-navy-600">
                {msisdnValide
                  ? demarree
                    ? "Verrouillé pendant la session — un appel ne change pas de numéro en cours de route."
                    : "Un numéro inconnu de la plateforme déclenche la demande de code compte."
                  : "8 ou 9 chiffres après +224."}
              </p>
            </div>

            <div>
              <p className="mb-1 text-xs font-semibold tracking-wide text-navy-600 uppercase">
                Identifiant de session
              </p>
              <p className="rounded-lg bg-navy-50 px-3 py-2 font-mono text-xs break-all text-navy-950">
                {sessionId}
              </p>
              <p className="mt-1 text-xs text-navy-600">
                Renouvelé à chaque raccrochage. Côté serveur, c&apos;est lui qui porte l&apos;état du
                menu — pas le navigateur.
              </p>
            </div>
          </div>
        </Card>

        {erreur ? (
          <div className="rounded-2xl border border-bad bg-bad-bg p-4">
            <p className="text-sm text-bad-text">{erreur}</p>
          </div>
        ) : null}

        <Card>
          <div className="border-b border-navy-50 px-5 py-4">
            <h2 className="font-display text-base font-semibold text-navy-950">Échanges avec la passerelle</h2>
            <p className="mt-1 text-xs text-navy-600">
              Une requête par saisie. Chaque <code className="font-mono">input</code> est envoyé seul —
              jamais l&apos;historique cumulé.
            </p>
          </div>
          {echanges.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-navy-600">
              Aucun échange. Appuyez sur Appeler pour composer {CODE_USSD}.
            </p>
          ) : (
            <ol className="divide-y divide-navy-50">
              {echanges.map((echange, index) => (
                <li key={index} className="flex flex-col gap-1.5 px-5 py-3">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-[11px] text-navy-600">#{index + 1} →</span>
                    <code className="font-mono text-xs text-navy-950">
                      {echange.envoye === "" ? "(saisie vide — décrochage)" : echange.envoye}
                    </code>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="font-mono text-[11px] text-navy-600">←</span>
                    <span className="flex-1 font-mono text-xs whitespace-pre-wrap text-navy-700">
                      {echange.recu}
                    </span>
                  </div>
                  <span className="font-mono text-[11px] text-navy-600">
                    continue: {String(echange.ouverte)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}
