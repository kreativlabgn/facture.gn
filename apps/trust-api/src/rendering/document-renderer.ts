import { formatGnf } from "./money-format";

// Renderer PUR — construit un docDefinition pdfmake à partir de données déjà
// résolues. Aucun accès DB, aucune I/O, aucun `new Date()` : le PDF d'une
// facture émise (immuable) est déterministe, testable par double rendu.
// Le seul point d'I/O de la couche restitution est pdf-printer.ts (polices).

const PALETTE = {
  ink: "#14202e",
  muted: "#55606e",
  rule: "#c4ccd6",
  accent: "#a9662a",
};

const NIF_PLACEHOLDER = "en cours de vérification";

// ---------- Facture ----------

export interface InvoiceRenderOrganization {
  name: string;
  // null → affiché "en cours de vérification", JAMAIS le placeholder interne
  // (UNVERIFIED_ORGANIZATION_NIF_PLACEHOLDER) — même discipline que
  // verification.service.ts.
  nif: string | null;
  rccm?: string | null;
}

export interface InvoiceRenderCustomer {
  name: string;
  phone?: string | null;
  nif?: string | null;
}

export interface InvoiceRenderLine {
  description: string;
  quantity: number;
  // centimes GNF, prix unitaire TTC (convention TTC-first du repo — les lignes
  // ne portent pas de ventilation HT, C4).
  unitPrice: bigint;
}

export interface InvoiceRenderInput {
  organization: InvoiceRenderOrganization;
  customer: InvoiceRenderCustomer | null;
  number: string;
  issuedAt: Date;
  certificationId: string;
  status: string;
  discountPct: number;
  lines: InvoiceRenderLine[];
  totalHt: bigint;
  totalTva: bigint;
  totalTtc: bigint;
  legalMentions: string[];
  verificationUrl: string;
  qrDataUrl: string;
}

function formatDate(date: Date): string {
  const d = String(date.getUTCDate()).padStart(2, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${d}/${m}/${date.getUTCFullYear()}`;
}

function organizationBlock(org: InvoiceRenderOrganization): object {
  const lines: object[] = [
    { text: org.name, bold: true, fontSize: 13 },
    { text: `NIF : ${org.nif ?? NIF_PLACEHOLDER}`, fontSize: 9, color: PALETTE.muted },
  ];
  if (org.rccm) {
    lines.push({ text: `RCCM : ${org.rccm}`, fontSize: 9, color: PALETTE.muted });
  }
  return { stack: lines };
}

function customerBlock(customer: InvoiceRenderCustomer): object {
  const lines: object[] = [
    { text: "Facturé à", fontSize: 8, color: PALETTE.muted, characterSpacing: 0.5 },
    { text: customer.name, bold: true },
  ];
  if (customer.phone) lines.push({ text: customer.phone, fontSize: 9, color: PALETTE.muted });
  if (customer.nif) lines.push({ text: `NIF : ${customer.nif}`, fontSize: 9, color: PALETTE.muted });
  return { stack: lines, margin: [0, 16, 0, 0] };
}

function linesTable(lines: InvoiceRenderLine[]): object {
  const body: object[][] = [
    [
      { text: "Désignation", style: "th" },
      { text: "Qté", style: "th", alignment: "right" },
      { text: "P.U. TTC", style: "th", alignment: "right" },
      { text: "Montant TTC", style: "th", alignment: "right" },
    ],
  ];
  for (const line of lines) {
    const lineTotal = BigInt(line.quantity) * line.unitPrice;
    body.push([
      { text: line.description },
      { text: String(line.quantity), alignment: "right" },
      { text: formatGnf(line.unitPrice), alignment: "right" },
      { text: formatGnf(lineTotal), alignment: "right" },
    ]);
  }
  return {
    margin: [0, 20, 0, 0],
    table: { headerRows: 1, widths: ["*", "auto", "auto", "auto"], body },
    layout: {
      hLineWidth: (i: number, node: { table: { body: unknown[] } }) =>
        i === 0 || i === 1 || i === node.table.body.length ? 0.75 : 0.25,
      vLineWidth: () => 0,
      hLineColor: () => PALETTE.rule,
      paddingTop: () => 5,
      paddingBottom: () => 5,
    },
  };
}

function summaryTable(input: InvoiceRenderInput): object {
  const grossTtc = input.lines.reduce((sum, l) => sum + BigInt(l.quantity) * l.unitPrice, 0n);
  const rows: object[][] = [[{ text: "Sous-total TTC", style: "sumLabel" }, { text: formatGnf(grossTtc), style: "sumValue" }]];

  // discountAmount = brut − net. Le rendu de la ligne exige les DEUX conditions
  // (discountPct enregistré ET écart de montant positif) : sur des données
  // cohérentes elles vont toujours ensemble ; le garde > 0n évite d'afficher
  // "- -X GNF" si les lignes ont été retouchées après coup sans le total.
  const discountAmount = grossTtc - input.totalTtc;
  if (input.discountPct > 0 && discountAmount > 0n) {
    rows.push([
      { text: `Remise (${input.discountPct} %)`, style: "sumLabel" },
      { text: `- ${formatGnf(discountAmount)}`, style: "sumValue" },
    ]);
  }

  rows.push(
    [{ text: "Total TTC", bold: true, style: "sumLabel" }, { text: formatGnf(input.totalTtc), bold: true, style: "sumValue" }],
    [{ text: "dont HT", style: "sumLabelSmall" }, { text: formatGnf(input.totalHt), style: "sumValueSmall" }],
    [{ text: "dont TVA", style: "sumLabelSmall" }, { text: formatGnf(input.totalTva), style: "sumValueSmall" }],
  );

  return {
    margin: [0, 16, 0, 0],
    columns: [
      { text: "", width: "*" },
      { width: "auto", table: { body: rows }, layout: "noBorders" },
    ],
  };
}

function certificationFooter(verificationUrl: string, certificationId: string, qrDataUrl: string): object {
  return {
    margin: [40, 10, 40, 20],
    columns: [
      { image: qrDataUrl, width: 54 },
      {
        width: "*",
        margin: [10, 6, 0, 0],
        stack: [
          { text: "Document certifié par facture.gn", fontSize: 8, bold: true, color: PALETTE.accent },
          { text: `Vérifiable sur ${verificationUrl}`, fontSize: 8, color: PALETTE.muted },
          { text: `Réf. de certification : ${certificationId}`, fontSize: 8, color: PALETTE.muted },
        ],
      },
    ],
  };
}

export function buildInvoiceDocDefinition(input: InvoiceRenderInput): object {
  const content: object[] = [
    {
      columns: [
        organizationBlock(input.organization),
        {
          width: "auto",
          alignment: "right",
          stack: [
            { text: "FACTURE", fontSize: 20, bold: true, color: PALETTE.accent },
            { text: `N° ${input.number}`, margin: [0, 4, 0, 0] },
            { text: `Émise le ${formatDate(input.issuedAt)}`, fontSize: 9, color: PALETTE.muted },
          ],
        },
      ],
    },
  ];

  if (input.customer) {
    content.push(customerBlock(input.customer));
  }

  content.push(linesTable(input.lines));
  content.push(summaryTable(input));

  content.push({
    margin: [0, 28, 0, 0],
    stack: input.legalMentions.map((mention) => ({ text: mention, fontSize: 7.5, color: PALETTE.muted, margin: [0, 1, 0, 1] })),
  });

  const doc: Record<string, unknown> = {
    pageSize: "A4",
    pageMargins: [40, 48, 40, 90],
    defaultStyle: { font: "Roboto", fontSize: 10, color: PALETTE.ink },
    styles: {
      th: { bold: true, fontSize: 8, color: PALETTE.muted },
      sumLabel: { alignment: "right", margin: [0, 2, 12, 2] },
      sumValue: { alignment: "right", margin: [0, 2, 0, 2] },
      sumLabelSmall: { alignment: "right", fontSize: 8, color: PALETTE.muted, margin: [0, 1, 12, 1] },
      sumValueSmall: { alignment: "right", fontSize: 8, color: PALETTE.muted, margin: [0, 1, 0, 1] },
    },
    content,
    footer: certificationFooter(input.verificationUrl, input.certificationId, input.qrDataUrl),
  };

  if (input.status === "voided") {
    doc.watermark = { text: "ANNULÉE", opacity: 0.25, bold: true, color: PALETTE.accent };
  }

  return doc;
}

// ---------- Reçu de paiement ----------

export interface ReceiptRenderPayment {
  method: string;
  depositType: string | null;
  amount: bigint;
  amountCollected: bigint;
  platformFeeAmount: bigint;
  gatewayFeeAmount: bigint;
  providerRef: string | null;
  providerSubMethod: string | null;
  collectedAt: Date;
}

export interface ReceiptRenderInput {
  invoiceNumber: string;
  certificationId: string;
  organizationName: string;
  payment: ReceiptRenderPayment;
  invoiceAfter: { amountPaid: bigint; amountDue: bigint; totalTtc: bigint };
  verificationUrl: string;
  qrDataUrl: string;
}

function paymentMethodLabel(payment: ReceiptRenderPayment): string {
  let base: string;
  switch (payment.method) {
    case "cash":
      base = "Espèces";
      break;
    case "bank_transfer":
      base = "Virement bancaire";
      break;
    case "payment_link":
      base = payment.providerSubMethod ? `Mobile Money (${payment.providerSubMethod})` : "Mobile Money";
      break;
    default:
      base = payment.method;
  }
  return payment.depositType === "arrhes" ? `Arrhes — ${base}` : base;
}

export function buildReceiptDocDefinition(input: ReceiptRenderInput): object {
  const { payment } = input;
  const isDeposit = payment.depositType === "arrhes";

  const detailRows: object[][] = [
    [{ text: "Mode de paiement", style: "k" }, { text: paymentMethodLabel(payment), style: "v" }],
    [{ text: "Montant reçu", style: "k" }, { text: formatGnf(payment.amount), style: "v", bold: true }],
  ];
  if (payment.amountCollected !== payment.amount) {
    detailRows.push([{ text: "Payé par le client", style: "k" }, { text: formatGnf(payment.amountCollected), style: "v" }]);
  }
  if (payment.platformFeeAmount > 0n) {
    detailRows.push([{ text: "dont commission", style: "k" }, { text: formatGnf(payment.platformFeeAmount), style: "v" }]);
  }
  if (payment.gatewayFeeAmount > 0n) {
    detailRows.push([{ text: "dont frais gateway", style: "k" }, { text: formatGnf(payment.gatewayFeeAmount), style: "v" }]);
  }
  if (payment.providerRef) {
    detailRows.push([{ text: "Référence transaction", style: "k" }, { text: payment.providerRef, style: "v" }]);
  }
  detailRows.push([{ text: "Date", style: "k" }, { text: formatDate(payment.collectedAt), style: "v" }]);

  const content: object[] = [
    {
      columns: [
        { text: input.organizationName, bold: true, fontSize: 13 },
        { text: "REÇU DE PAIEMENT", alignment: "right", fontSize: 16, bold: true, color: PALETTE.accent },
      ],
    },
    {
      margin: [0, 6, 0, 0],
      stack: [
        { text: `Facture N° ${input.invoiceNumber}`, fontSize: 9, color: PALETTE.muted },
        { text: `Réf. de certification : ${input.certificationId}`, fontSize: 9, color: PALETTE.muted },
      ],
    },
    {
      margin: [0, 22, 0, 0],
      table: { widths: ["auto", "*"], body: detailRows },
      layout: "noBorders",
    },
  ];

  if (isDeposit) {
    content.push({
      margin: [0, 20, 0, 0],
      text: "Cette arrhes est un dépôt de sécurité — montant non imputé au solde de la facture (ADR-034).",
      fontSize: 9,
      italics: true,
      color: PALETTE.muted,
    });
  } else {
    content.push({
      margin: [0, 22, 0, 0],
      table: {
        widths: ["auto", "*"],
        body: [
          [{ text: "Total facture TTC", style: "k" }, { text: formatGnf(input.invoiceAfter.totalTtc), style: "v" }],
          [{ text: "Déjà payé", style: "k" }, { text: formatGnf(input.invoiceAfter.amountPaid), style: "v" }],
          [
            { text: "Restant dû", style: "k", bold: true },
            { text: formatGnf(input.invoiceAfter.amountDue), style: "v", bold: true },
          ],
        ],
      },
      layout: "noBorders",
    });
  }

  return {
    pageSize: "A5",
    pageMargins: [36, 40, 36, 80],
    defaultStyle: { font: "Roboto", fontSize: 10, color: PALETTE.ink },
    styles: {
      k: { color: PALETTE.muted, margin: [0, 2, 16, 2] },
      v: { margin: [0, 2, 0, 2] },
    },
    content,
    footer: certificationFooter(input.verificationUrl, input.certificationId, input.qrDataUrl),
  };
}
