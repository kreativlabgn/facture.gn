// G3, ADR-091 — prédicat pur, découplé du DTO : le seuil n'est plus une
// constante globale figée mais un paramètre fourni par l'appelant
// (PaymentsService, qui résout l'override par organisation, Niveau 2).
export function isCashProofRequirementMet(params: {
  amount: bigint;
  effectiveThresholdGnfCentimes: bigint;
  proofPhotoUrl?: string;
  proofGpsLat?: number;
  proofGpsLng?: number;
  proofSignature?: string;
}): boolean {
  return (
    params.amount <= params.effectiveThresholdGnfCentimes ||
    (params.proofPhotoUrl !== undefined &&
      params.proofGpsLat !== undefined &&
      params.proofGpsLng !== undefined &&
      params.proofSignature !== undefined)
  );
}
