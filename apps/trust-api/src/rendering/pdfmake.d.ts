// pdfmake 0.2.x expose son API serveur via `module.exports = PdfPrinter`.
// @types/pdfmake ne type que le build client (createPdf) — déclaration locale
// minimale de l'entrée serveur réellement utilisée (pdf-printer.ts).
declare module "pdfmake" {
  interface PdfFontFiles {
    normal: string;
    bold: string;
    italics: string;
    bolditalics: string;
  }

  class PdfPrinter {
    constructor(fontDescriptors: Record<string, PdfFontFiles>);
    createPdfKitDocument(docDefinition: unknown): NodeJS.ReadableStream & { end(): void };
  }

  export = PdfPrinter;
}
