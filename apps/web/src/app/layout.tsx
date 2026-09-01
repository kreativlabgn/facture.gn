import type { Metadata } from "next";
import { Inter, Poppins, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { OfflineBanner } from "@/components/OfflineBanner";

// Système typographique verrouillé par la Charte Graphique v1.3 : Poppins
// (marque, titres — jamais en dessous de 12px), Inter (texte courant),
// JetBrains Mono (identifiants vérifiables déjà certifiés — certification
// ID, montants, hash, jamais la saisie utilisateur — chasse fixe pour lever
// toute ambiguïté 0/O, 1/l). Poids restreints aux poids RÉELLEMENT utilisés
// par les composants (vérifié par grep sur tout apps/web/src), pas une
// gamme large par défaut — chaque poids chargé est un aller-retour réseau
// de plus sur une connexion mobile guinéenne coûteuse (DAT). La charte ne
// définit d'ailleurs qu'UN SEUL poids mono ("code" = Bold, 700) — aucun
// poids intermédiaire mono ne devrait donc jamais être introduit ici.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "600"],
  display: "swap",
});

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "facture.gn — Vérification de facture certifiée",
  description:
    "Vérifiez l'authenticité d'une facture certifiée par facture.gn, infrastructure de confiance transactionnelle pour les PME de Guinée.",
  manifest: "/manifest.webmanifest",
};

// PWA offline-first — Charte v1.3, couleur de fond de la barre système.
export const viewport = { themeColor: "#0b1d3a" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`${inter.variable} ${poppins.variable} ${jetbrainsMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-grey text-navy-950">
        <OfflineBanner />
        {children}
      </body>
    </html>
  );
}
