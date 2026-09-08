import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EtaxClient, EtaxRejetDefinitif } from "./etax.client";
import type { EtaxDeclarationPayload } from "./etax-declaration";
import type { EtaxInvoicePayload } from "./etax-invoice";

const CLE = "a".repeat(64);

const PAYLOAD: EtaxDeclarationPayload = {
  organizationId: "org-1",
  fiscalPeriodId: "closing-1",
  year: 2025,
  etaxNumber: "ETAX-42",
  totalHt: "1000000",
  totalTva: "180000",
  totalTtc: "1180000",
  taxRateBps: 1800,
  taxCode: "TVA-18",
  sealHash: "sceau-abc",
};

function reponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

beforeEach(() => {
  process.env.ETAX_API_URL = "https://etax.example.gn";
  process.env.ETAX_API_KEY = CLE;
});

afterEach(() => {
  delete process.env.ETAX_API_URL;
  delete process.env.ETAX_API_KEY;
  vi.unstubAllGlobals();
});

describe("EtaxClient.submit", () => {
  it("rend la référence de dépôt acquittée par eTax", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reponse({ submissionRef: "ACK-1" })));

    await expect(new EtaxClient().submit(PAYLOAD)).resolves.toEqual({ submissionRef: "ACK-1" });
  });

  // La signature doit porter sur le corps EXACT transmis : le guichet la
  // vérifie à l'octet près, une reconstruction divergerait à la moindre
  // différence d'ordre de clés.
  it("signe le corps exact transmis, en HMAC-SHA256", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reponse({ submissionRef: "ACK-1" }));
    vi.stubGlobal("fetch", fetchMock);

    await new EtaxClient().submit(PAYLOAD);

    const [, init] = fetchMock.mock.calls[0];
    const attendue = createHmac("sha256", CLE).update(init.body).digest("hex");
    expect(init.headers["X-Etax-Signature"]).toBe(attendue);
  });

  // Clé d'idempotence côté guichet : un réessai après acquittement perdu porte
  // le même sceau, eTax peut reconnaître le doublon plutôt que d'enregistrer
  // deux déclarations pour un même exercice.
  it("transmet le sceau comme clé d'idempotence", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reponse({ submissionRef: "ACK-1" }));
    vi.stubGlobal("fetch", fetchMock);

    await new EtaxClient().submit(PAYLOAD);

    expect(fetchMock.mock.calls[0][1].headers["X-Idempotency-Key"]).toBe("sceau-abc");
  });

  // CONTRASTE DÉLIBÉRÉ avec PaymentLinkClient, qui rend null et n'échoue jamais.
  // Ici l'exception EST le mécanisme de réessai : l'avaler marquerait le job
  // « completed » alors que la DGI n'a rien reçu.
  it("lève sur réponse en erreur — c'est ce qui fait rejouer le job", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reponse({ erreur: "maintenance" }, { ok: false, status: 503 })));

    await expect(new EtaxClient().submit(PAYLOAD)).rejects.toThrow(/503/);
  });

  it("lève si la configuration manque — jamais un succès silencieux", async () => {
    delete process.env.ETAX_API_URL;

    await expect(new EtaxClient().submit(PAYLOAD)).rejects.toThrow(/non configurés/);
  });

  // Un 200 sans référence n'est pas un acquittement exploitable : sans preuve de
  // dépôt, on ne peut pas marquer la clôture comme transmise.
  it("lève sur un 200 sans référence de dépôt", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reponse({})));

    await expect(new EtaxClient().submit(PAYLOAD)).rejects.toThrow(/sans référence/);
  });

  // Un guichet qui rejette une déclaration en renvoie typiquement l'écho —
  // numéro eTax et montants de la PME. `*.nif` et `*.etaxNumber` sont des
  // chemins RÉDIGÉS (logging.config.ts), mais la rédaction pino porte sur des
  // propriétés d'objet et ne voit rien de ce qui est interpolé dans une chaîne.
  // Ni l'exception NI LE LOG ne doivent donc recopier le corps de la réponse.
  it("ne divulgue le corps de la réponse ni dans l'exception ni dans le log", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(reponse({ echo: PAYLOAD, message: "rejet" }, { ok: false, status: 422 })),
    );
    const client = new EtaxClient();
    const warn = vi.spyOn((client as unknown as { logger: { warn: (m: string) => void } }).logger, "warn");

    const erreur = await client.submit(PAYLOAD).catch((e) => e);

    expect(erreur.message).not.toContain("ETAX-42");
    expect(erreur.message).not.toContain("1180000");

    const journalise = warn.mock.calls.map((c) => String(c[0])).join(" ");
    expect(journalise).toContain("422");
    expect(journalise).not.toContain("ETAX-42");
    expect(journalise).not.toContain("1180000");
  });
});

const FACTURE: EtaxInvoicePayload = {
  invoiceId: "inv-1",
  organizationId: "org-1",
  etaxNumberEmetteur: "ETAX-42",
  nifAcquereur: "NIF-CLIENT",
  numero: "FG-2026-000042",
  certificationId: "GN-12345678-2026-ABC123",
  totalHt: "1000000",
  totalTva: "180000",
  totalTtc: "1180000",
  taxRateBps: 1800,
  taxCode: "TVA-18",
  issuedAt: "2026-09-08T10:00:00.000Z",
  hash: "hash-facture",
};

describe("EtaxClient.submitInvoice", () => {
  it("rend le numéro de reçu de la DGI", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reponse({ receiptNumber: "RECU-9" })));
    await expect(new EtaxClient().submitInvoice(FACTURE)).resolves.toEqual({ submissionRef: "RECU-9" });
  });

  // Le guichet nomme « receiptNumber » le reçu unitaire et « submissionRef »
  // l'acquittement d'une déclaration. Parier sur un seul nom ferait
  // retransmettre une facture que la DGI a déjà enregistrée.
  it("accepte aussi submissionRef comme nom de champ", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reponse({ submissionRef: "ACK-7" })));
    await expect(new EtaxClient().submitInvoice(FACTURE)).resolves.toEqual({ submissionRef: "ACK-7" });
  });

  // Un 200 sans référence n'est pas un acquittement exploitable : sans preuve de
  // dépôt, on ne peut pas marquer la facture comme transmise.
  it("refuse un acquittement sans référence", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reponse({ ok: true })));
    await expect(new EtaxClient().submitInvoice(FACTURE)).rejects.toThrow(/sans numéro de reçu/);
  });

  it("signe le corps EXACT transmis, à l'octet près", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reponse({ receiptNumber: "RECU-9" }));
    vi.stubGlobal("fetch", fetchMock);

    await new EtaxClient().submitInvoice(FACTURE);

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["X-Etax-Signature"]).toBe(
      createHmac("sha256", CLE).update(init.body).digest("hex"),
    );
  });

  // Deux transmissions de la même facture portent forcément le même hash de
  // certification : le guichet peut donc reconnaître le doublon.
  it("porte le hash de certification comme clé d'idempotence", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reponse({ receiptNumber: "RECU-9" }));
    vi.stubGlobal("fetch", fetchMock);

    await new EtaxClient().submitInvoice(FACTURE);

    expect(fetchMock.mock.calls[0][1].headers["X-Idempotency-Key"]).toBe("hash-facture");
  });

  // LE PARTAGE QUI COMPTE. Un 4xx signale un payload invalide : rejouer à
  // l'identique donnera le même refus, et s'acharner bloquerait la file derrière
  // des milliers de factures par jour.
  it("marque un 4xx comme refus DÉFINITIF", async () => {
    for (const status of [400, 403, 422]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reponse({}, { ok: false, status })));
      await expect(new EtaxClient().submitInvoice(FACTURE)).rejects.toBeInstanceOf(EtaxRejetDefinitif);
    }
  });

  // 429 excepté : c'est un « revenez plus tard », pas un refus — le rejouer est
  // exactement ce que le guichet demande.
  it("traite un 429 comme passager, jamais comme un refus", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reponse({}, { ok: false, status: 429 })));
    const erreur = await new EtaxClient().submitInvoice(FACTURE).catch((e) => e);
    expect(erreur).not.toBeInstanceOf(EtaxRejetDefinitif);
    expect(erreur.message).toContain("429");
  });

  it("traite un 5xx comme passager", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reponse({}, { ok: false, status: 503 })));
    const erreur = await new EtaxClient().submitInvoice(FACTURE).catch((e) => e);
    expect(erreur).not.toBeInstanceOf(EtaxRejetDefinitif);
  });

  it("ne divulgue le corps de la réponse ni dans l'exception ni dans le log", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(reponse({ echo: FACTURE, message: "rejet" }, { ok: false, status: 422 })),
    );
    const client = new EtaxClient();
    const warn = vi.spyOn((client as unknown as { logger: { warn: (m: string) => void } }).logger, "warn");

    const erreur = await client.submitInvoice(FACTURE).catch((e) => e);

    expect(erreur.message).not.toContain("ETAX-42");
    expect(erreur.message).not.toContain("1180000");

    const journalise = warn.mock.calls.map((c) => String(c[0])).join(" ");
    expect(journalise).toContain("422");
    expect(journalise).not.toContain("ETAX-42");
    expect(journalise).not.toContain("1180000");
  });

  it("lève sans configuration plutôt que de se croire transmis", async () => {
    delete process.env.ETAX_API_URL;
    await expect(new EtaxClient().submitInvoice(FACTURE)).rejects.toThrow(/non configurés/);
  });
});
