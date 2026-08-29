import QRCode from "qrcode";

// URL publique de vérification d'une facture certifiée (verify.facture.gn), non
// séquentielle, construite à partir du seul certificationId (ADR-023 : jamais
// l'UUID interne). Base configurable pour les environnements staging/sandbox.
const DEFAULT_VERIFICATION_BASE_URL = "https://verify.facture.gn";

export function verificationUrl(certificationId: string): string {
  const base = (process.env.PUBLIC_VERIFICATION_BASE_URL ?? DEFAULT_VERIFICATION_BASE_URL).replace(/\/+$/, "");
  return `${base}/${certificationId}`;
}

// PNG data URI (niveau de correction M — le PDF peut être photographié dans de
// mauvaises conditions de lumière/impression) prêt à être embarqué comme image
// pdfmake.
export async function buildVerificationQrDataUrl(certificationId: string): Promise<string> {
  return QRCode.toDataURL(verificationUrl(certificationId), {
    errorCorrectionLevel: "M",
    margin: 1,
    scale: 4,
  });
}
