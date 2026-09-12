"use client";

import { useActionState, useState } from "react";
import { Button, Field, TextInput } from "@/components/ui";
import { requestOtpAction, verifyOtpAction, type OtpActionState } from "./actions";

// Tunnel d'accès du portail acheteur : numéro, puis code reçu par SMS.
//
// LE CODE FAIT QUATRE CHIFFRES, pas six — verify-otp.dto.ts : `/^\d{4}$/`. Un
// champ à six chiffres promettrait un code que l'acheteur ne recevra jamais, et
// le rejet arriverait après coup, sans explication.
//
// Le token n'apparaît nulle part ici : verifyOtpAction le pose dans un cookie
// httpOnly côté serveur. Ce composant ne voit jamais de secret.
//
// `retour` permet de rendre la main là d'où l'on vient : sur la facture
// demandée quand on arrive par un lien SMS, sur l'accueil sinon.
//
// `encadre` : dans la coquille du portail (page facture sans session), le
// tunnel est une carte posée sur le fond gris. Dans AuthLayout, la colonne
// d'action EST la carte — on ne pose pas une bordure dans une bordure.
export function OtpTunnel({
  retour,
  titre,
  intro,
  encadre = true,
}: {
  retour?: string;
  titre?: string;
  intro?: string;
  encadre?: boolean;
}) {
  const [etatDemande, demander, demandeEnCours] = useActionState<OtpActionState, FormData>(
    requestOtpAction,
    null,
  );
  const [etatVerif, verifier, verifEnCours] = useActionState<OtpActionState, FormData>(
    verifyOtpAction,
    null,
  );
  const [msisdn, setMsisdn] = useState("");

  const envoye = etatDemande && "envoye" in etatDemande ? etatDemande.envoye : null;
  const erreur =
    (etatVerif && "error" in etatVerif ? etatVerif.error : null) ??
    (etatDemande && "error" in etatDemande ? etatDemande.error : null);

  return (
    <div className="mx-auto w-full max-w-md">
      <div className={encadre ? "rounded-2xl border border-navy-100 bg-white p-6 sm:p-8" : ""}>
        <h1 className="font-display text-2xl font-bold text-navy-950">
          {titre ?? "Accéder à mes factures"}
        </h1>
        <p className="mt-1 text-sm text-navy-600">
          {envoye
            ? `Nous avons envoyé un code à ${envoye}. Il est valable cinq minutes.`
            : (intro ??
              "Nous vous envoyons un code par SMS pour confirmer que ce numéro est bien le vôtre.")}
        </p>

        {erreur ? (
          <p role="alert" className="mt-4 rounded-lg border border-bad bg-bad-bg px-3 py-2 text-sm text-bad-text">
            {erreur}
          </p>
        ) : null}

        {envoye ? (
          <form action={verifier} className="mt-6 flex flex-col gap-4">
            <input type="hidden" name="msisdn" value={envoye} />
            {retour ? <input type="hidden" name="retour" value={retour} /> : null}
            <Field label="Code reçu par SMS" htmlFor="portail-code">
              <TextInput
                id="portail-code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={4}
                placeholder="0000"
                required
                className="text-center tracking-[0.4em]"
              />
            </Field>
            <Button type="submit" size="lg" disabled={verifEnCours}>
              {verifEnCours ? "Vérification…" : "Ouvrir mes factures"}
            </Button>
          </form>
        ) : (
          <form action={demander} className="mt-6 flex flex-col gap-4">
            <Field label="Votre numéro de téléphone" htmlFor="portail-msisdn">
              <TextInput
                id="portail-msisdn"
                name="msisdn"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+224620000000"
                value={msisdn}
                onChange={(event) => setMsisdn(event.target.value)}
                required
              />
            </Field>
            <Button type="submit" size="lg" disabled={demandeEnCours}>
              {demandeEnCours ? "Envoi…" : "Recevoir le code par SMS"}
            </Button>
          </form>
        )}

        <p className="mt-6 text-xs text-navy-600">
          Seul le numéro auquel vos factures ont été adressées peut les ouvrir.
        </p>
      </div>
    </div>
  );
}
