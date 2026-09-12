import type { Metadata } from "next";
import { OcrRelectureDemo } from "./OcrRelectureDemo";

export const metadata: Metadata = { title: "Démonstration — relecture OCR — facture.gn" };

// Route de démonstration commerciale (pilote FODIP, ADR-123). Habillée par la
// coquille `(app)` pour ressembler à l'espace marchand, donc derrière une
// session comme le reste — /demo figure dans PROTECTED_PREFIXES et dans le
// matcher du proxy, sans quoi requireSessionToken() lèverait au lieu de
// renvoyer vers /login. Aucune donnée d'organisation n'est lue : tout ce que
// l'écran montre est simulé dans OcrRelectureDemo.
export default function OcrRelectureDemoPage() {
  return <OcrRelectureDemo />;
}
