"use client";

import { useState } from "react";
import { OcrReviewAlert, formatCentimes, type OcrFinding } from "@/components/ai/OcrReviewAlert";
import { Badge, Button, Card, CardBody, CardHeader, FieldLabel, TextInput } from "@/components/ui";

// Parcours de démonstration du Hub Vision (ADR-122) pour le pilote FODIP
// (ADR-123). Trois écrans sur une seule page : l'alerte de relecture, la grille
// de correction, le scellage. Tout est simulé — aucun appel à trust-api,
// aucun brouillon créé, aucune signature. C'est un support de présentation,
// pas un écran de production : le vrai parcours part d'un `ocr_document` en
// DRAFT_PENDING_MANUAL_REVIEW et n'a pas encore d'écran de relecture.
//
// L'alerte est le VRAI composant `OcrReviewAlert`, avec son contrat réel
// (`findings: OcrFinding[]`, codes fermés). L'écart montré est `TOTAL_TTC` :
// le carnet est chez un commerçant en TPU, donc TVA nulle et HT = TTC — la
// somme des lignes doit retomber sur le total écrit au pied. Le modèle a lu
// « 0 » au pied (tampon, rature) : c'est l'écart initial, et la démo consiste
// à le résorber à la main.
//
// L'écart n'est pas un état : il est RECALCULÉ à chaque rendu depuis la grille,
// en BigInt sur des chaînes de chiffres seuls, comme la double-garde serveur
// (`ocr-validation.service.ts`). Si la somme des lignes et le pied coïncident,
// il n'y a plus d'écart, et l'alerte disparaît d'elle-même. On ne peut donc
// pas « lever » l'alerte autrement qu'en rendant l'équation vraie.
//
// Les montants sont saisis en GNF entiers (c'est ainsi qu'un carnet est écrit)
// et convertis en centimes pour le calcul et l'affichage : `formatCentimes`
// vient du composant d'alerte pour que la grille et l'alerte montrent la même
// chose au centime près.

type Ligne = {
  id: string;
  designation: string;
  quantite: number;
  /** Prix unitaire lu, en GNF entiers, chiffres seuls. "" = non lu. */
  prixUnitaireGnf: string;
};

const CENT = BigInt(100);

// Ce que le modèle « a lu » sur le carnet. Deux prix illisibles, le transport
// lu correctement, le pied de facture lu à zéro.
const LIGNES_LUES: Ligne[] = [
  { id: "riz", designation: "Sac de riz 25 kg", quantite: 4, prixUnitaireGnf: "" },
  { id: "huile", designation: "Bidon d'huile 20 L", quantite: 1, prixUnitaireGnf: "" },
  { id: "transport", designation: "Frais de transport", quantite: 1, prixUnitaireGnf: "12500" },
];
const PIED_LU_GNF = "0";

const TEXTE_LU =
  "« Envoie une facture pour 4 sacs de riz à M. Diallo, ajoute le transport à 12 500, et un bidon d'huile de 20 L »";

/** Chiffres seuls. Une lettre, un espace ou un séparateur tapés par mégarde
 *  sont retirés AVANT toute comparaison : l'anomalie ne se calcule jamais sur
 *  la frappe brute. */
function chiffresSeuls(valeur: string): string {
  return valeur.replace(/\D/g, "");
}

function gnfEnCentimes(gnf: string): bigint {
  return (gnf === "" ? BigInt(0) : BigInt(gnf)) * CENT;
}

function totalLigne(ligne: Ligne): bigint {
  return gnfEnCentimes(ligne.prixUnitaireGnf) * BigInt(ligne.quantite);
}

export function OcrRelectureDemo() {
  const [lignes, setLignes] = useState<Ligne[]>(LIGNES_LUES);
  const [piedGnf, setPiedGnf] = useState(PIED_LU_GNF);
  const [scelle, setScelle] = useState(false);

  const sommeLignes = lignes.reduce((somme, ligne) => somme + totalLigne(ligne), BigInt(0));
  const piedLu = gnfEnCentimes(piedGnf);

  const findings: OcrFinding[] =
    sommeLignes === piedLu
      ? []
      : [{ code: "TOTAL_TTC", chemin: "totals.totalTTC", attendu: sommeLignes.toString(), constate: piedLu.toString() }];
  const resolu = findings.length === 0;

  const changerPrix = (id: string, valeur: string) => {
    const prix = chiffresSeuls(valeur);
    setLignes((courantes) => courantes.map((ligne) => (ligne.id === id ? { ...ligne, prixUnitaireGnf: prix } : ligne)));
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-2xl font-bold text-navy-950">Relecture d&apos;un carnet</h1>
          <Badge tone="navy">Démonstration</Badge>
        </div>
        <p className="max-w-prose text-sm text-navy-600">
          Parcours de relecture du Hub Vision présenté au pilote FODIP. Rien n&apos;est envoyé : aucune facture n&apos;est
          créée, aucune signature n&apos;est apposée.
        </p>
      </div>

      {/* Écran 1 — signalétique. Le composant réel, avec le contrat réel. */}
      {resolu ? (
        <section
          role="status"
          className="flex items-start gap-3 rounded-2xl border border-green-text bg-white p-5 text-navy-950"
        >
          <IconeValide />
          <div>
            <p className="font-display text-base font-bold text-green-text">Équation vérifiée au centime près</p>
            <p className="mt-1 text-sm text-navy-800">
              La somme des lignes retombe sur le total écrit au pied du carnet ({formatCentimes(piedLu.toString())}). Le
              brouillon peut être scellé.
            </p>
          </div>
        </section>
      ) : (
        <OcrReviewAlert findings={findings} />
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Volet gauche — ce que le modèle a lu. */}
        <Card>
          <CardHeader title="Lecture du modèle" />
          <CardBody className="flex flex-col gap-4">
            <p className="font-mono text-[11px] font-bold tracking-wide text-navy-600 uppercase">
              Source : ocr-document · statut DRAFT_PENDING_MANUAL_REVIEW
            </p>
            <blockquote className="rounded-xl bg-navy-950 p-4 font-mono text-xs leading-relaxed text-white">{TEXTE_LU}</blockquote>
            <p className="text-xs text-navy-600">
              Le modèle rend une lecture structurée ; le serveur ne lui fait confiance sur rien qui se recalcule. Ici, le
              pied de facture a été lu à zéro et deux prix unitaires sont illisibles.
            </p>
          </CardBody>
        </Card>

        {/* Écran 2 — correction. Chaque frappe recalcule l'équation. */}
        <Card>
          <CardHeader title="Grille de relecture" />
          <CardBody className="flex flex-col gap-4">
            <ul className="flex flex-col gap-3">
              {lignes.map((ligne) => {
                const illisible = ligne.prixUnitaireGnf === "";
                const inputId = `pu-${ligne.id}`;
                return (
                  <li
                    key={ligne.id}
                    className={[
                      "rounded-xl border p-3",
                      illisible ? "border-amber-text bg-amber-bg" : "border-navy-100 bg-white",
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-navy-950">{ligne.designation}</p>
                        <p className="font-mono text-xs text-navy-600">Quantité : {ligne.quantite}</p>
                      </div>
                      <p className="font-mono text-xs text-navy-800 tabular-nums">
                        {formatCentimes(totalLigne(ligne).toString())}
                      </p>
                    </div>
                    <div className="mt-2">
                      <FieldLabel htmlFor={inputId}>
                        Prix unitaire (GNF){illisible ? " — non lu sur le papier" : ""}
                      </FieldLabel>
                      <TextInput
                        id={inputId}
                        inputMode="numeric"
                        placeholder="Saisir le prix"
                        value={ligne.prixUnitaireGnf}
                        onChange={(event) => changerPrix(ligne.id, event.target.value)}
                        disabled={scelle}
                        className="font-mono tabular-nums"
                      />
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="border-t border-navy-100 pt-4">
              <FieldLabel htmlFor="pied-ttc">Total TTC écrit au pied du carnet (GNF)</FieldLabel>
              <TextInput
                id="pied-ttc"
                inputMode="numeric"
                value={piedGnf}
                onChange={(event) => setPiedGnf(chiffresSeuls(event.target.value))}
                disabled={scelle}
                className="font-mono tabular-nums"
              />
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm text-navy-800">
                <dt>Somme des lignes</dt>
                <dd className="font-mono tabular-nums">{formatCentimes(sommeLignes.toString())}</dd>
                <dt>Pied lu</dt>
                <dd className="font-mono tabular-nums">{formatCentimes(piedLu.toString())}</dd>
              </dl>
            </div>

            {/* Écran 3 — scellage. Inerte tant qu'un écart subsiste. */}
            {scelle ? (
              <p role="status" className="rounded-xl bg-green-bg p-3 text-sm font-semibold text-green-text">
                Démonstration terminée : en production, le brouillon serait signé Ed25519 et l&apos;ancre de traçabilité
                écrite dans le registre d&apos;audit.
              </p>
            ) : (
              <Button type="button" size="lg" disabled={!resolu} onClick={() => setScelle(true)} className="w-full">
                Certifier et émettre la facture
              </Button>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function IconeValide() {
  // Coche cerclée, `currentColor` : prend le vert du conteneur. aria-hidden —
  // le titre en toutes lettres porte le sens (WCAG 1.4.1).
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-6 shrink-0 text-green-text"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5" />
    </svg>
  );
}
