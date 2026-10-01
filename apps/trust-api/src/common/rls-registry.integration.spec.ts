import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPrismaClient, setOrganizationScope, setPracticeScope, type PrismaClient } from "@facture-gn/db";

// Garde du registre RLS et étanchéité des tables B2G (ADR-111 / ADR-126, plan
// 2026-10-01-rls-tables-b2g) — nécessite un Postgres JOIGNABLE.
//
// POURQUOI CE FICHIER EXISTE. La migration 20260917100000 (Phase 4 & 5) a créé
// b2g_case, telemo_award et ocaecg_license sans les enrôler dans le registre
// RLS ; rien ne l'a vu pendant deux semaines. Ce test rend l'oubli impossible
// à reproduire en silence : toute table du schéma public qui porte une colonne
// de tenant doit être sous RLS, FORCÉE, avec une politique — ou figurer dans
// EXCEPTIONS avec sa raison.
//
// DEUX NIVEAUX DE PREUVE.
//   1. Le registre (pg_class / pg_policies) : tourne partout où une base
//      répond, CI comprise.
//   2. L'étanchéité comportementale : endosse le rôle applicatif NOBYPASSRLS
//      (facture_app, étape 2 du runbook) par SET LOCAL ROLE le temps d'une
//      transaction — le superutilisateur bypasse la RLS, il ne prouverait rien.
//      Se dérobe si le rôle n'existe pas sur la base (même convention que
//      ocr-vision.integration.spec.ts).
//
// SUR LA SONDE `SELECT 1` plutôt que `describe.runIf(Boolean(DATABASE_URL))` :
// DATABASE_URL est défini même sans serveur en face ; seule la requête tranche.

let baseJoignable = false;

// Tables à colonne de tenant VOLONTAIREMENT hors RLS. Une exception obsolète
// (table disparue, ou enrôlée depuis) fait échouer le test : la liste ne peut
// pas pourrir en silence.
const EXCEPTIONS: Record<string, string> = {
  data_rights_request:
    "registre cross-organisation (organization_id nullable) — ADR-E2 « cross-organisation », runbook rls-rollout",
  practice_member:
    "scope practice : « restent hors RLS, aucune story ne les expose cross-tenant » — runbook rls-rollout, plan 2026-09-05-rls-practice-scope",
};

const TABLES_B2G = ["b2g_case", "telemo_award", "ocaecg_license"] as const;

interface LigneRegistre {
  table_name: string;
  relrowsecurity: boolean;
  relforcerowsecurity: boolean;
  policies: number;
}

describe("Registre RLS — exhaustivité et tables B2G (Postgres réel)", () => {
  let prisma: PrismaClient;
  let orgA: string;
  let orgB: string;
  const ids = {
    awardA: "",
    awardB: "",
    awardOrpheline: "",
    caseA: "",
    caseB: "",
    caseNumberA: "",
    caseNumberB: "",
    licenceA: "",
    licenceB: "",
  };

  async function creerOrganisation(nom: string): Promise<string> {
    const org = await prisma.organization.create({
      data: { name: nom, regimeFiscal: "normal_tva", legalForm: "commercial", nif: `NIF-RLS-${randomUUID()}` },
    });
    return org.id;
  }

  async function creerAward(organizationId: string | null): Promise<string> {
    const award = await prisma.telemoAward.create({
      data: {
        telemoAwardId: `TEL-${randomUUID()}`,
        telemoContractId: "CONTRAT-TEST",
        supplierNif: "NIF-FOURNISSEUR-TEST",
        amountCentimes: "100000000",
        organizationId,
      },
    });
    return award.id;
  }

  async function lireRegistre(): Promise<LigneRegistre[]> {
    // Toute table du schéma public portant une colonne …organization_id /
    // …practice_id / …cabinet_id : le motif large attrape aussi une future
    // `referrer_organization_id`, pas seulement les trois noms d'aujourd'hui.
    const lignes = await prisma.$queryRaw<
      { table_name: string; relrowsecurity: boolean; relforcerowsecurity: boolean; policies: bigint }[]
    >`
      SELECT c.relname AS table_name,
             c.relrowsecurity,
             c.relforcerowsecurity,
             (SELECT count(*) FROM pg_policies p
               WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND EXISTS (
          SELECT 1 FROM information_schema.columns k
          WHERE k.table_schema = 'public'
            AND k.table_name = c.relname
            AND k.column_name ~ '(organization|practice|cabinet)_id$')
      ORDER BY c.relname`;
    return lignes.map((l) => ({ ...l, policies: Number(l.policies) }));
  }

  beforeAll(async () => {
    prisma = getPrismaClient();
    try {
      await prisma.$queryRaw`SELECT 1`;
      baseJoignable = true;
    } catch {
      return;
    }

    orgA = await creerOrganisation("PME A (B2G)");
    orgB = await creerOrganisation("PME B (B2G)");

    ids.awardA = await creerAward(orgA);
    ids.awardB = await creerAward(orgB);
    ids.awardOrpheline = await creerAward(null);

    ids.caseNumberA = `B2G-${randomUUID()}`;
    ids.caseNumberB = `B2G-${randomUUID()}`;
    ids.caseA = (
      await prisma.b2GCase.create({
        data: { caseNumber: ids.caseNumberA, telemoAwardId: ids.awardA, organizationId: orgA },
      })
    ).id;
    ids.caseB = (
      await prisma.b2GCase.create({
        data: { caseNumber: ids.caseNumberB, telemoAwardId: ids.awardB, organizationId: orgB },
      })
    ).id;

    ids.licenceA = (
      await prisma.ocaecgLicense.create({
        data: { licenseNumber: `OCAECG-${randomUUID()}`, firmName: "Cabinet A", cabinetId: orgA },
      })
    ).id;
    ids.licenceB = (
      await prisma.ocaecgLicense.create({
        data: { licenseNumber: `OCAECG-${randomUUID()}`, firmName: "Cabinet B", cabinetId: orgB },
      })
    ).id;
  });

  beforeEach((contexte) => {
    if (!baseJoignable) {
      contexte.skip();
    }
  });

  afterAll(async () => {
    if (!baseJoignable) {
      return;
    }
    // Par organisation, pas par identifiant connu : si un test échoue après avoir
    // inséré une ligne imprévue (c'est précisément ce qu'une politique affaiblie
    // provoquerait), la suppression des organisations échouerait sur la clé
    // étrangère RESTRICT et laisserait la base sale pour le passage suivant.
    const orgs = [orgA, orgB];
    await prisma.b2GCase.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.telemoAward.deleteMany({
      where: { OR: [{ organizationId: { in: orgs } }, { id: ids.awardOrpheline }] },
    });
    await prisma.ocaecgLicense.deleteMany({ where: { cabinetId: { in: orgs } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
  });

  // Le rôle applicatif est-il utilisable pour ces tests ? Rend `false` (et le
  // test se dérobe) si le rôle n'existe pas, s'il bypasse la RLS, ou s'il n'a
  // pas les droits de l'étape 2 du runbook sur CETTE base : un rôle est global
  // au serveur, il peut exister sans avoir été armé ici. Les politiques
  // appellent rls_practice_sees_org(), qui lit `mandate` : sans SELECT dessus,
  // la requête échoue en « permission denied » au lieu de tester la politique.
  async function roleApplicatifDisponible(): Promise<boolean> {
    const [role] = await prisma.$queryRaw<{ rolbypassrls: boolean }[]>`
      SELECT rolbypassrls FROM pg_roles WHERE rolname = 'facture_app'`;
    if (!role || role.rolbypassrls) {
      return false;
    }
    const [droits] = await prisma.$queryRaw<{ arme: boolean }[]>`
      SELECT has_table_privilege('facture_app', 'public.mandate', 'SELECT')
         AND has_table_privilege('facture_app', 'public.b2g_case', 'SELECT')
         AND has_table_privilege('facture_app', 'public.telemo_award', 'SELECT')
         AND has_table_privilege('facture_app', 'public.ocaecg_license', 'SELECT') AS arme`;
    return droits.arme;
  }

  // ── 1. Exhaustivité du registre ────────────────────────────────────────────

  it("toute table à colonne de tenant est sous RLS FORCÉE avec une politique, hors exceptions nommées", async () => {
    const registre = await lireRegistre();
    const fautives = registre
      .filter((t) => !(t.relrowsecurity && t.relforcerowsecurity && t.policies > 0))
      .filter((t) => !(t.table_name in EXCEPTIONS))
      .map((t) => t.table_name);

    expect(fautives).toEqual([]);
  });

  it("chaque exception documentée existe encore et est bien hors RLS (liste sans entrée obsolète)", async () => {
    const registre = await lireRegistre();
    const parTable = new Map(registre.map((t) => [t.table_name, t]));

    for (const [table, raison] of Object.entries(EXCEPTIONS)) {
      const ligne = parTable.get(table);
      expect(ligne, `exception « ${table} » (${raison}) : table introuvable ou sans colonne de tenant`).toBeDefined();
      expect(
        ligne?.relrowsecurity && ligne.relforcerowsecurity && ligne.policies > 0,
        `exception « ${table} » obsolète : la table est désormais sous RLS — retirer l'entrée de EXCEPTIONS`,
      ).toBe(false);
    }
  });

  it.each(TABLES_B2G)("%s est sous ROW LEVEL SECURITY, FORCÉE, avec l'unique politique org_isolation", async (table) => {
    const [ligne] = await prisma.$queryRaw<{ relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
      SELECT relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relname = ${table} AND relnamespace = 'public'::regnamespace`;
    expect(ligne).toEqual({ relrowsecurity: true, relforcerowsecurity: true });

    const politiques = await prisma.$queryRaw<{ policyname: string; cmd: string }[]>`
      SELECT policyname, cmd FROM pg_policies WHERE schemaname = 'public' AND tablename = ${table}`;
    expect(politiques).toEqual([{ policyname: "org_isolation", cmd: "ALL" }]);
  });

  // ── 2. Étanchéité comportementale, sous le rôle applicatif ─────────────────

  it("b2g_case : le scope B ne lit, ne modifie ni n'insère les lignes de A ; le scope A garde la main", async (contexte) => {
    if (!(await roleApplicatifDisponible())) {
      contexte.skip();
    }

    const resultat = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE facture_app`;
      await setOrganizationScope(tx, orgB);
      return {
        deA: await tx.b2GCase.findFirst({ where: { id: ids.caseA } }),
        sienne: await tx.b2GCase.findFirst({ where: { id: ids.caseB } }),
        majDeA: await tx.b2GCase.updateMany({ where: { id: ids.caseA }, data: { status: "OBJECTION_GEL_LITIGE" } }),
      };
    });
    expect(resultat.deA).toBeNull();
    expect(resultat.sienne?.id).toBe(ids.caseB);
    expect(resultat.majDeA.count).toBe(0);

    // WITH CHECK : le scope B ne peut pas fabriquer un dossier au nom de A.
    // createMany (INSERT sans RETURNING) pour isoler le WITH CHECK, comme plus bas.
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL ROLE facture_app`;
        await setOrganizationScope(tx, orgB);
        await tx.b2GCase.createMany({
          data: [{ caseNumber: `B2G-${randomUUID()}`, telemoAwardId: ids.awardB, organizationId: orgA }],
        });
      }),
    ).rejects.toThrow(/row-level security/i);

    // Rien n'a bougé pour A, vérifié en superutilisateur (hors politique).
    const intact = await prisma.b2GCase.findUniqueOrThrow({ where: { id: ids.caseA } });
    expect(intact.status).toBe("BROUILLON");
  });

  // Le WITH CHECK joue aussi à l'UPDATE : sans lui, le scope A pourrait
  // « pousser » son dossier chez B en changeant organization_id (la ligne
  // d'origine est visible de A, seule la ligne résultante trahit le transfert).
  it("b2g_case : un dossier ne peut pas être transféré vers un autre tenant (WITH CHECK à l'UPDATE)", async (contexte) => {
    if (!(await roleApplicatifDisponible())) {
      contexte.skip();
    }

    // Ce test prouve la PROTECTION (aucun transfert), pas le seul WITH CHECK :
    // sur un UPDATE, Postgres applique aussi la clause USING d'une politique
    // FOR ALL à la NOUVELLE ligne — vérifié sur Postgres 16 : même avec un
    // WITH CHECK (true), l'UPDATE est refusé. Le WITH CHECK est isolé, lui, par
    // les tests d'INSERT (createMany : pas de RETURNING). updateMany plutôt que
    // update pour ne pas mêler la vérification de la ligne retournée.
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL ROLE facture_app`;
        await setOrganizationScope(tx, orgA);
        await tx.b2GCase.updateMany({ where: { id: ids.caseA }, data: { organizationId: orgB } });
      }),
    ).rejects.toThrow(/row-level security/i);

    const intact = await prisma.b2GCase.findUniqueOrThrow({ where: { id: ids.caseA } });
    expect(intact.organizationId).toBe(orgA);
  });

  // Échappement « cabinet mandaté » de la politique (rls_practice_sees_org) :
  // il ÉLARGIT la vue, donc c'est lui qu'il faut éprouver des deux côtés — un
  // mandat actif ouvre, un mandat révoqué referme, un tiers n'ouvre rien.
  it("b2g_case : un cabinet voit les dossiers de l'organisation qui l'a mandaté tant que le mandat est actif, jamais ceux des autres", async (contexte) => {
    if (!(await roleApplicatifDisponible())) {
      contexte.skip();
    }

    const cabinet = await prisma.professionalPractice.create({
      data: { type: "cabinet_comptable", name: `Cabinet RLS ${randomUUID()}`, phone: "+224620000000" },
    });
    const mandat = await prisma.mandate.create({
      data: {
        practiceId: cabinet.id,
        organizationId: orgA,
        status: "active",
        grantedRole: "accountant_external",
        initiatedBy: "organization",
        grantedAt: new Date(),
      },
    });

    const voir = () =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL ROLE facture_app`;
        await setPracticeScope(tx, cabinet.id);
        return {
          deA: await tx.b2GCase.findFirst({ where: { id: ids.caseA } }),
          deB: await tx.b2GCase.findFirst({ where: { id: ids.caseB } }),
        };
      });

    try {
      const actif = await voir();
      expect(actif.deA?.id).toBe(ids.caseA);
      expect(actif.deB).toBeNull();

      await prisma.mandate.update({ where: { id: mandat.id }, data: { status: "revoked", revokedAt: new Date() } });
      const revoque = await voir();
      expect(revoque.deA).toBeNull();
      expect(revoque.deB).toBeNull();
    } finally {
      await prisma.mandate.deleteMany({ where: { practiceId: cabinet.id } });
      await prisma.professionalPractice.delete({ where: { id: cabinet.id } });
    }
  });

  it("registerObjection (non-régression) : lecture puis mise à jour de b2g_case dans le scope de sa propre organisation", async (contexte) => {
    if (!(await roleApplicatifDisponible())) {
      contexte.skip();
    }

    // Même chemin que PublicBuyerPortalService.registerObjection : le scope de
    // l'organisation de la facture est posé AVANT tout accès à b2g_case.
    // (Clé de recherche : caseNumber, unique — le chemin RLS est le même que
    // par invoiceId ; une facture complète n'ajouterait que du bruit ici.)
    const maj = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE facture_app`;
      await setOrganizationScope(tx, orgA);
      const existant = await tx.b2GCase.findUnique({ where: { caseNumber: ids.caseNumberA } });
      expect(existant?.id).toBe(ids.caseA);
      return tx.b2GCase.update({ where: { caseNumber: ids.caseNumberA }, data: { status: "OBJECTION_GEL_LITIGE" } });
    });
    expect(maj.status).toBe("OBJECTION_GEL_LITIGE");

    await prisma.b2GCase.update({ where: { id: ids.caseA }, data: { status: "BROUILLON" } });
  });

  it("telemo_award : isolation par organisation ; une attribution non rattachée est invisible d'un scope PME", async (contexte) => {
    if (!(await roleApplicatifDisponible())) {
      contexte.skip();
    }

    const vu = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE facture_app`;
      await setOrganizationScope(tx, orgB);
      return {
        deA: await tx.telemoAward.findFirst({ where: { id: ids.awardA } }),
        sienne: await tx.telemoAward.findFirst({ where: { id: ids.awardB } }),
        orpheline: await tx.telemoAward.findFirst({ where: { id: ids.awardOrpheline } }),
      };
    });
    expect(vu.deA).toBeNull();
    expect(vu.sienne?.id).toBe(ids.awardB);
    expect(vu.orpheline).toBeNull();

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL ROLE facture_app`;
        await setOrganizationScope(tx, orgB);
        await tx.telemoAward.createMany({
          data: [
            {
              telemoAwardId: `TEL-${randomUUID()}`,
              telemoContractId: "CONTRAT-TEST",
              supplierNif: "NIF-FOURNISSEUR-TEST",
              amountCentimes: "1",
              organizationId: orgA,
            },
          ],
        });
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  it("ocaecg_license : l'agrément d'un cabinet n'est visible que de ce cabinet", async (contexte) => {
    if (!(await roleApplicatifDisponible())) {
      contexte.skip();
    }

    const vu = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE facture_app`;
      await setOrganizationScope(tx, orgB);
      return {
        deA: await tx.ocaecgLicense.findFirst({ where: { id: ids.licenceA } }),
        sienne: await tx.ocaecgLicense.findFirst({ where: { id: ids.licenceB } }),
      };
    });
    expect(vu.deA).toBeNull();
    expect(vu.sienne?.id).toBe(ids.licenceB);
  });
});
