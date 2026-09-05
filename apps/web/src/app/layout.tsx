import type { Metadata } from "next";
import { Inter, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { OfflineBanner } from "@/components/OfflineBanner";

// Système typographique de la maquette consolidée (ADR-102/103, polices
// embarquées Space Grotesk / Inter / JetBrains Mono) : Space Grotesk (marque,
// titres, boutons — jamais en dessous de 12px, sinon Inter prend le relais),
// Inter (texte courant), JetBrains Mono (identifiants vérifiables DÉJÀ
// certifiés — certification ID, montants, hash, timestamps ; jamais la saisie
// utilisateur — chasse fixe pour lever l'ambiguïté 0/O, 1/l). Poids restreints
// aux poids réellement utilisés — chaque poids chargé est un aller-retour
// réseau de plus sur une connexion mobile guinéenne coûteuse (DAT). Un seul
// poids mono (Bold 700, charte §Typographie).
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "600"],
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
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

// PWA offline-first — Navy Atlantique, couleur de fond de la barre système.
export const viewport = { themeColor: "#0b1d3a" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="fr"
      className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-grey text-navy-950">
        <OfflineBanner />
        {children}
      </body>
    </html>
  );
}
