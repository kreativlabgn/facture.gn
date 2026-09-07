import { z } from "zod";

// Provisionnement d'un terminal : la PME décrit l'appareil qu'elle s'apprête à
// enrôler, jamais son numéro de série — celui-ci n'est connu qu'au moment où le
// boîtier se présente (voir enroll-device.dto.ts).
export const provisionDeviceSchema = z.object({
  label: z.string().trim().min(1, "libellé requis").max(120),
  // Optionnel : un terminal peut être rattaché à l'organisation avant d'être
  // affecté à une succursale précise.
  branchId: z.string().uuid("branchId attendu au format uuid").optional(),
});

export type ProvisionDeviceDto = z.infer<typeof provisionDeviceSchema>;
