-- Lot J1 (ADR-015) — invoice_event est append-only : source de vérité du
-- journal d'audit (DAT §4), base de l'audit OHADA et de la détection LBC/FT.
-- Rien en base ne l'empêchait jusqu'ici.
--
-- Portée réelle de cette garde :
--   * bloque TOUTE mutation DML directe (UPDATE/DELETE) sur invoice_event, pour
--     tous les rôles — y compris une injection SQL ou un bug ORM sous le rôle
--     applicatif actuel (qui est encore le propriétaire des tables).
--   * NE protège PAS contre un rôle disposant du DDL sur la table : il peut
--     `ALTER TABLE ... DISABLE TRIGGER` / `DROP TRIGGER`, ou `TRUNCATE`
--     (le trigger est de niveau ligne). Idem `TRUNCATE "invoice" CASCADE`.
--   Ces vecteurs se referment avec la bascule sur un rôle applicatif NON
--   propriétaire (docs/runbooks/rls-rollout.md, étapes 2 & 5 : REVOKE
--   UPDATE/DELETE/TRUNCATE FROM facture_app).
--
-- Garde ACTIVE dès maintenant (contrairement à la RLS de Lot I, dormante) :
-- aucun code applicatif n'émet d'UPDATE/DELETE sur invoice_event (vérifié — les
-- writers ne font que create/findMany/count), donc aucun changement de
-- comportement, juste un vecteur d'altération fermé.
--
-- Écart assumé vis-à-vis du « SQL volontairement plat » de la migration RLS :
-- une garde append-only exige une fonction + un trigger. `prisma migrate deploy`
-- passe le fichier entier à Postgres (dollar-quoting `$$` géré).
--
-- TRUNCATE volontairement non couvert (pas de trigger FOR EACH STATEMENT) : le
-- reset des tests d'intégration et de la CI passe par TRUNCATE. Voir aussi
-- l'étape 5 du runbook (REVOKE TRUNCATE + section « correction exceptionnelle »).

CREATE OR REPLACE FUNCTION reject_invoice_event_mutation() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
  AS $$
BEGIN
  RAISE EXCEPTION 'invoice_event est append-only (ADR-015) : % interdit', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE OR REPLACE TRIGGER invoice_event_append_only
  BEFORE UPDATE OR DELETE ON "invoice_event"
  FOR EACH ROW EXECUTE FUNCTION reject_invoice_event_mutation();
