"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ESPACES, LIBELLE_MENU } from "@/lib/espaces";

// « Se connecter » du header : un menu de PROFIL, pas un lien. Trois identités
// n'entrent pas par la même porte (mot de passe pour le marchand et le cabinet,
// code SMS sans compte pour l'acheteur) — envoyer tout le monde sur /login
// faisait échouer l'acheteur à coup sûr, et laissait le cabinet atterrir sur le
// tableau de bord PME.
//
// Un menu déroulant plutôt qu'une modale : trois liens ne justifient pas de
// bloquer l'écran, et un menu reste utilisable au clavier sans piège de focus à
// gérer. Sémantique WAI-ARIA « menu button » : le bouton annonce le menu
// (aria-haspopup, aria-expanded, aria-controls), les entrées sont des
// menuitem, Échap ferme et rend le focus, ↑/↓ circulent, un clic hors du menu
// le ferme. Sans JS, le bouton ne fait rien — le pied de page garde un lien
// /login nu, et chaque carte de la section Espaces porte ses propres liens :
// aucune porte ne dépend de ce menu.
export function LoginMenu() {
  const [ouvert, setOuvert] = useState(false);
  const racine = useRef<HTMLDivElement>(null);
  const bouton = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!ouvert) {
      return;
    }
    function fermerHors(event: MouseEvent) {
      if (racine.current && !racine.current.contains(event.target as Node)) {
        setOuvert(false);
      }
    }
    document.addEventListener("mousedown", fermerHors);
    return () => document.removeEventListener("mousedown", fermerHors);
  }, [ouvert]);

  function auClavier(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setOuvert(false);
      bouton.current?.focus();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }
    const entrees = Array.from(racine.current?.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]') ?? []);
    if (entrees.length === 0) {
      return;
    }
    event.preventDefault();
    if (!ouvert) {
      setOuvert(true);
      // Le menu n'est pas encore rendu : le focus se pose au prochain tick.
      requestAnimationFrame(() => entrees[0]?.focus());
      return;
    }
    const courant = entrees.indexOf(document.activeElement as HTMLAnchorElement);
    const pas = event.key === "ArrowDown" ? 1 : -1;
    const suivant = (courant + pas + entrees.length) % entrees.length;
    entrees[suivant].focus();
  }

  return (
    <div ref={racine} className="relative" onKeyDown={auClavier}>
      <button
        ref={bouton}
        type="button"
        aria-haspopup="menu"
        aria-expanded={ouvert}
        aria-controls={menuId}
        onClick={() => setOuvert((v) => !v)}
        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-[10px] px-3 text-sm font-semibold text-navy-950 transition hover:bg-navy-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-950"
      >
        Se connecter
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform ${ouvert ? "rotate-180" : ""}`}
        >
          <path d="m5 7.5 5 5 5-5" />
        </svg>
      </button>

      <div
        id={menuId}
        role="menu"
        aria-label="Choisir votre profil"
        hidden={!ouvert}
        className="absolute right-0 z-50 mt-2 w-64 rounded-2xl border border-navy-100 bg-white p-2 shadow-lg"
      >
        <p className="px-3 pb-2 pt-1 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-navy-600">
          Vous êtes…
        </p>
        {ESPACES.map((espace) => (
          <Link
            key={espace.id}
            role="menuitem"
            href={espace.connexion.href}
            onClick={() => setOuvert(false)}
            className="block rounded-xl px-3 py-2.5 hover:bg-navy-50 focus-visible:bg-navy-50 focus-visible:outline-none"
          >
            <span className="block text-sm font-semibold text-navy-950">{LIBELLE_MENU[espace.id]}</span>
            <span className="mt-0.5 block text-xs text-navy-600">{espace.eyebrow}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
