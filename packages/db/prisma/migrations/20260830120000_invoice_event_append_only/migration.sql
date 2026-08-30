-- Lot J1 (ADR-015) — invoice_event est append-only : source de vérité du
-- journal d'audit (DAT §4). Rien en base ne l'empêchait jusqu'ici — un bug,
-- une migration ou un accès compromis pouvait réécrire l'historique sans trace.
--
-- Garde ACTIVE (contrairement à la RLS de Lot I, dormante) : le trigger
-- s'applique à tout le monde, y compris au rôle propriétaire des tables et à un
-- superuser. Aucun code applicatif n'émet d'UPDATE/DELETE sur invoice_event
-- (vérifié) — cette garde ne change donc aucun comportement, elle ferme un
-- vecteur d'altération.
--
-- Écart assumé vis-à-vis du « SQL volontairement plat » de la migration RLS :
-- une garde append-only exige une fonction plpgsql + un trigger. `prisma migrate
-- deploy` passe le fichier entier à Postgres (le dollar-quoting `$$` est géré) —
-- l'avertissement de la migration RLS ne visait qu'un découpage naïf sur ';'.
--
-- TRUNCATE n'est volontairement PAS couvert (pas de trigger FOR EACH STATEMENT) :
-- le reset des tests d'intégration et de la CI passe par TRUNCATE ... CASCADE.
--
-- Défense en profondeur complémentaire (dormante, activée avec le rôle non
-- propriétaire) : voir docs/runbooks/rls-rollout.md, étape 5.

CREATE OR REPLACE FUNCTION reject_invoice_event_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'invoice_event est append-only (ADR-015) : % interdit', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER invoice_event_append_only
  BEFORE UPDATE OR DELETE ON "invoice_event"
  FOR EACH ROW EXECUTE FUNCTION reject_invoice_event_mutation();
