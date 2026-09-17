import { describe, expect, it } from "vitest";
import { whatsappWebhookSchema } from "./whatsapp-webhook.dto";

const CORPS_TEXTE = {
  object: "whatsapp_business_account",
  entry: [
    {
      changes: [
        {
          field: "messages",
          value: {
            messages: [
              { from: "224620000000", id: "wamid.abc", timestamp: "1758067200", type: "text", text: { body: "Facture pour Amadou" } },
            ],
          },
        },
      ],
    },
  ],
};

describe("whatsappWebhookSchema (plan 2026-09-16, clarification 6 — tolérant, pas .strict())", () => {
  it("accepte un corps texte conforme", () => {
    expect(whatsappWebhookSchema.safeParse(CORPS_TEXTE).success).toBe(true);
  });

  it("accepte un corps AVEC des champs Meta inconnus (statuts de lecture, contacts, réactions) — jamais un rejet", () => {
    const corps = {
      ...CORPS_TEXTE,
      entry: [
        {
          ...CORPS_TEXTE.entry[0],
          changes: [
            {
              field: "messages",
              value: {
                messages: CORPS_TEXTE.entry[0].changes[0].value.messages,
                statuses: [{ id: "wamid.abc", status: "read", timestamp: "1758067300" }],
                contacts: [{ profile: { name: "Amadou" }, wa_id: "224620000000" }],
                metadata: { display_phone_number: "224600000000", phone_number_id: "123" },
              },
            },
          ],
        },
      ],
    };

    const resultat = whatsappWebhookSchema.safeParse(corps);
    expect(resultat.success).toBe(true);
  });

  it("accepte un message audio (type: audio)", () => {
    const corps = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                messages: [
                  { from: "224620000000", id: "wamid.audio-1", type: "audio", audio: { id: "media-1", mime_type: "audio/ogg" } },
                ],
              },
            },
          ],
        },
      ],
    };

    expect(whatsappWebhookSchema.safeParse(corps).success).toBe(true);
  });

  it("accepte un message d'un type non supporté (image, sticker...) sans le rejeter au niveau schéma — la décision \"type non supporté\" vit dans whatsapp-inbound.service.ts", () => {
    const corps = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            { field: "messages", value: { messages: [{ from: "224620000000", id: "wamid.img-1", type: "image" }] } },
          ],
        },
      ],
    };

    expect(whatsappWebhookSchema.safeParse(corps).success).toBe(true);
  });

  it("accepte un changes[].value sans messages (uniquement des statuts)", () => {
    const corps = {
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: { statuses: [{ id: "wamid.abc", status: "delivered" }] } }] }],
    };

    expect(whatsappWebhookSchema.safeParse(corps).success).toBe(true);
  });

  it("rejette un corps sans entry", () => {
    expect(whatsappWebhookSchema.safeParse({ object: "whatsapp_business_account" }).success).toBe(false);
  });
});
