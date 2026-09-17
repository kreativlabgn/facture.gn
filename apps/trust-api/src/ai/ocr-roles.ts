// Extrait de ai.controller.ts (plan 2026-09-16, OCR multicanal) — un rôle qui
// a le droit de saisir une facture photographiée (POST /ai/ocr/scans) a le
// droit de la dicter (POST /ai/ocr/audio-notes) ou de l'envoyer par WhatsApp
// (whatsapp-inbound.service.ts, lot suivant) : c'est le même acte de saisie du
// comptoir, jamais une action financière — le caissier et l'agent terrain y
// ont leur place. Zéro duplication du tableau entre les deux modules.
export const ROLES_SAISIE = ["owner", "admin", "accountant_internal", "cashier", "field_agent"] as const;
