import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Une seule police (Inter) — jamais une seconde police décorative : légèreté
// du bundle cohérente avec le contexte data mobile coûteuse en Guinée (DAT),
// excellent support du français, lisibilité neutre appropriée à un document
// de certification.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
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
    <html lang="fr" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-ink-50 text-ink-950">{children}</body>
    </html>
  );
}
