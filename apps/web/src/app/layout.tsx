import type { Metadata } from "next";
import { Inter, Poppins, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Système typographique verrouillé par la Charte Graphique v1.3 : Poppins
// (marque, titres — jamais en dessous de 12px), Inter (texte courant),
// JetBrains Mono (identifiants vérifiables — certification ID, montants,
// hash — chasse fixe pour lever toute ambiguïté 0/O, 1/l).
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
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
  weight: ["500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "facture.gn — Vérification de facture certifiée",
  description:
    "Vérifiez l'authenticité d'une facture certifiée par facture.gn, infrastructure de confiance transactionnelle pour les PME de Guinée.",
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`${inter.variable} ${poppins.variable} ${jetbrainsMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-grey text-navy-950">{children}</body>
    </html>
  );
}
