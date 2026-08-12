import { describe, expect, it } from "vitest";
import { createCustomerSchema } from "./create-customer.dto";

describe("createCustomerSchema", () => {
  it("accepte un client avec uniquement les champs requis", () => {
    const result = createCustomerSchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      name: "Épicerie Sory",
    });
    expect(result.success).toBe(true);
  });

  it("rejette un nom vide", () => {
    const result = createCustomerSchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      name: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejette un creditLimit négatif", () => {
    const result = createCustomerSchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      name: "Épicerie Sory",
      creditLimit: -1000,
    });
    expect(result.success).toBe(false);
  });

  it("rejette un phone mal formé", () => {
    const result = createCustomerSchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      name: "Épicerie Sory",
      phone: "0620000000",
    });
    expect(result.success).toBe(false);
  });

  it("accepte notificationChannel whatsapp/both en plus de sms (C9)", () => {
    const result = createCustomerSchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      name: "Épicerie Sory",
      notificationChannel: "both",
    });
    expect(result.success).toBe(true);
  });

  it("rejette un notificationChannel hors énumération", () => {
    const result = createCustomerSchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      name: "Épicerie Sory",
      notificationChannel: "email",
    });
    expect(result.success).toBe(false);
  });
});
