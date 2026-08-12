import { describe, expect, it } from "vitest";
import { WhatsAppStubProvider } from "./whatsapp-stub.provider";

describe("WhatsAppStubProvider", () => {
  it("retourne success:true — stub déterministe faute de credentials réels", async () => {
    const provider = new WhatsAppStubProvider();

    const result = await provider.send("+224622334455", "Votre facture de 100 000 GNF : https://facture.gn/pay/inv-1");

    expect(result).toEqual({ success: true });
  });
});
