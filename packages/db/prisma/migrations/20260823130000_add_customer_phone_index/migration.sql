-- F13, revue post-fix #3 — index sur customer.phone, requis par
-- ClientPortalService (seul point du repo qui interroge Customer par
-- téléphone à travers toutes les organisations, sans scoping organizationId
-- préalable).
CREATE INDEX "customer_phone_idx" ON "customer"("phone");
