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

/** ADR-108 — TTC_FIRST : parcours marchand (unitPrice TTC). HT_FIRST :
 *  passerelle PDP / ERP tiers (unitPrice hors taxes). */
export type SaisieRegimeRendu = "TTC_FIRST" | "HT_FIRST";

export interface InvoiceRenderLine {
  description: string;
  quantity: number;
  // centimes GNF. TTC ou HT selon saisieRegime ci-dessous — ADR-108. La
  // convention TTC-first (C4) reste celle du parcours marchand, elle n'est
  // simplement plus la seule.
  unitPrice: bigint;
  saisieRegime: SaisieRegimeRendu;
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
  // Lot C — code UNTDID 1001 (EN 16931 BT-3), null pour un devis. Bloc de
  // références B2G déjà assemblé par RenderingService (label + valeur des seules
  // références non-nulles) — le renderer n'inspecte jamais les champs bruts.
  untdidTypeCode: string | null;
  b2gReferences: { label: string; value: string }[];
}

// Le régime d'un TABLEAU, là où la colonne est portée par la LIGNE.
//
// Un en-tête de colonne ne peut annoncer qu'une seule unité : il faut donc
// trancher pour l'ensemble. En pratique les lignes d'une facture viennent
// toutes du même canal — un seul service les écrit, en une seule transaction
// — et le cas mixte n'existe pas. On ne le suppose pas pour autant : s'il
// survenait (reprise manuelle, migration future), intituler tout le tableau
// d'après la première ligne mentirait sur les autres. On retombe alors sur des
// libellés NEUTRES, qui n'affirment rien de faux.
//
// Une facture sans ligne suit la convention historique : il n'y a rien à
// mal intituler, et le récapitulatif doit garder son déroulé habituel.
function regimeDuTableau(lines: InvoiceRenderLine[]): SaisieRegimeRendu | null {
  if (lines.length === 0) {
    return "TTC_FIRST";
  }
  const premier = lines[0].saisieRegime;
  return lines.every((l) => l.saisieRegime === premier) ? premier : null;
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
  // ADR-108 — l'unité annoncée suit la provenance des lignes. Une facture
  // entrée par la passerelle PDP porte des prix unitaires HORS TAXES :
  // les intituler « P.U. TTC » était le micro-écart visuel à supprimer.
  const regime = regimeDuTableau(lines);
  const unite = regime === "HT_FIRST" ? " HT" : regime === "TTC_FIRST" ? " TTC" : "";

  const body: object[][] = [
    [
      { text: "Désignation", style: "th" },
      { text: "Qté", style: "th", alignment: "right" },
      { text: `P.U.${unite}`, style: "th", alignment: "right" },
      { text: `Montant${unite}`, style: "th", alignment: "right" },
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
  // La somme BRUTE des lignes, dans l'unité où elles sont saisies : TTC pour le
  // parcours marchand, HT pour la passerelle PDP. BigInt(0) en amorce, jamais le
  // littéral 0n (ADR-108, discipline de compilation du projet).
  const sommeLignes = input.lines.reduce((sum, l) => sum + BigInt(l.quantity) * l.unitPrice, BigInt(0));
  const htFirst = regimeDuTableau(input.lines) === "HT_FIRST";

  // ADR-108 — DEUX DÉROULÉS, PAS DEUX CALCULS. Tous les montants affichés
  // sortent des totaux scellés sur la facture ; seul leur ENCHAÎNEMENT change.
  //
  // HT_FIRST lit dans le sens du document : sous-total HT, puis la TVA isolée,
  // puis le total TTC. C'est la formule brute (quantité × P.U. HT), celle que
  // l'ERP a envoyée et que le lecteur peut refaire de tête, ligne à ligne.
  //
  // TTC_FIRST garde l'extraction à rebours historique : le total TTC d'abord,
  // dont on ventile ensuite le HT et la TVA. Appliquer ce déroulé-là à des
  // lignes HT afficherait un « Sous-total TTC » qui vaut le HT — précisément
  // l'écart que l'ADR-108 supprime.
  const libelleSousTotal = htFirst ? "Sous-total HT" : "Sous-total TTC";
  const rows: object[][] = [
    [{ text: libelleSousTotal, style: "sumLabel" }, { text: formatGnf(sommeLignes), style: "sumValue" }],
  ];

  // discountAmount = brut − net, DANS L'UNITÉ DU RÉGIME : comparer une somme de
  // lignes HT au total TTC rendrait un écart qui n'est pas une remise. Le rendu
  // de la ligne exige les DEUX conditions (discountPct enregistré ET écart
  // positif) : sur des données cohérentes elles vont toujours ensemble ; le
  // garde > 0 évite d'afficher "- -X GNF" si les lignes ont été retouchées
  // après coup sans le total. Aucune remise globale n'existe sur le chemin
  // HT_FIRST (le contrat PDP l'interdit), mais la formule reste juste s'il en
  // apparaissait une.
  const netDuRegime = htFirst ? input.totalHt : input.totalTtc;
  const discountAmount = sommeLignes - netDuRegime;
  if (input.discountPct > 0 && discountAmount > BigInt(0)) {
    rows.push([
      { text: `Remise (${input.discountPct} %)`, style: "sumLabel" },
      { text: `- ${formatGnf(discountAmount)}`, style: "sumValue" },
    ]);
  }

  if (htFirst) {
    rows.push(
      [{ text: "TVA", style: "sumLabel" }, { text: formatGnf(input.totalTva), style: "sumValue" }],
      [{ text: "Total TTC", bold: true, style: "sumLabel" }, { text: formatGnf(input.totalTtc), bold: true, style: "sumValue" }],
    );
  } else {
    rows.push(
      [{ text: "Total TTC", bold: true, style: "sumLabel" }, { text: formatGnf(input.totalTtc), bold: true, style: "sumValue" }],
      [{ text: "dont HT", style: "sumLabelSmall" }, { text: formatGnf(input.totalHt), style: "sumValueSmall" }],
      [{ text: "dont TVA", style: "sumLabelSmall" }, { text: formatGnf(input.totalTva), style: "sumValueSmall" }],
    );
  }

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
            ...(input.untdidTypeCode
              ? [{ text: `Type UNTDID 1001 : ${input.untdidTypeCode}`, fontSize: 8, color: PALETTE.muted }]
              : []),
          ],
        },
      ],
    },
  ];

  if (input.customer) {
    content.push(customerBlock(input.customer));
  }

  if (input.b2gReferences.length > 0) {
    content.push({
      margin: [0, 14, 0, 0],
      stack: [
        { text: "Références", fontSize: 8, color: PALETTE.muted, characterSpacing: 0.5 },
        ...input.b2gReferences.map((ref) => ({
          text: `${ref.label} : ${ref.value}`,
          fontSize: 9,
          margin: [0, 1, 0, 1],
        })),
      ],
    });
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
  if (payment.platformFeeAmount > BigInt(0)) {
    detailRows.push([{ text: "dont commission", style: "k" }, { text: formatGnf(payment.platformFeeAmount), style: "v" }]);
  }
  if (payment.gatewayFeeAmount > BigInt(0)) {
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
