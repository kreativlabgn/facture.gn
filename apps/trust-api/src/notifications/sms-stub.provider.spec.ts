import { describe, expect, it } from "vitest";
import { SmsStubProvider } from "./sms-stub.provider";

describe("SmsStubProvider", () => {
  it("retourne success:true — stub déterministe faute de credentials réels", async () => {
    const provider = new SmsStubProvider();

    const result = await provider.send("+224622334455", "Votre facture de 100 000 GNF : https://facture.gn/pay/inv-1");

    expect(result).toEqual({ success: true });
  });
});
