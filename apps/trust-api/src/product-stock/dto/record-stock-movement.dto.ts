import { z } from "zod";

// E10 — quantityDelta signé : cohérence avec `type` (reception>0, loss<0,
// adjustment libre) validée dans ProductStockService, jamais ici (la forme
// est valide même si le signe ne correspond pas encore au type).
export const recordStockMovementSchema = z.object({
  type: z.enum(["reception", "adjustment", "loss"]),
  quantityDelta: z.number().int(),
});

export type RecordStockMovementDto = z.infer<typeof recordStockMovementSchema>;
