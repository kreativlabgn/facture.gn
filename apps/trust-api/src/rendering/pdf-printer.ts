import path from "node:path";
import PdfPrinter from "pdfmake";

// Seul point d'I/O de la couche restitution : le chargement des polices.
// __dirname = src/rendering/ en test/dev, dist/rendering/ en prod (nest-cli.json
// copie les .ttf). pdfmake 0.2.x (API serveur PdfPrinter) ne bundle pas les
// polices — d'où les Roboto (Apache 2.0) vendorées dans ./fonts/.
const FONTS_DIR = path.join(__dirname, "fonts");

const printer = new PdfPrinter({
  Roboto: {
    normal: path.join(FONTS_DIR, "Roboto-Regular.ttf"),
    bold: path.join(FONTS_DIR, "Roboto-Medium.ttf"),
    italics: path.join(FONTS_DIR, "Roboto-Italic.ttf"),
    bolditalics: path.join(FONTS_DIR, "Roboto-MediumItalic.ttf"),
  },
});

// Un docDefinition d'une facture émise (immuable) produit toujours le même PDF —
// aucune source de non-déterminisme ici (pas de timestamp, pas de nonce).
export function renderToBuffer(docDefinition: object): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let doc: NodeJS.ReadableStream & { end(): void };
    try {
      doc = printer.createPdfKitDocument(docDefinition);
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", (error: Error) => reject(error));
    doc.end();
  });
}
