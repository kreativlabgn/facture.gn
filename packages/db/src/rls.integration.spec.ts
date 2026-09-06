import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@prisma/client";
import { organizationScopedClient, practiceScopedClient } from "./rls";

// Validation RÉELLE de l'isolation RLS. Ne tourne QUE si RLS_INTEGRATION_TEST=1
// — car elle exige la config de l'étape 3 du runbook (docs/runbooks/rls-rollout.md) :
//   - DATABASE_URL pointant sur un rôle NON-propriétaire, sans BYPASSRLS
//   - FORCE ROW LEVEL SECURITY sur invoice (sinon le rôle propriétaire bypasse
//     et l'isolation n'est pas testée).
// En CI (rôle superuser `postgres`) RLS est dormant → ce test échouerait à tort,
// d'où le gate explicite plutôt qu'un simple `DATABASE_URL`.
const RUN = process.env.RLS_INTEGRATION_TEST === "1";

(RUN ? describe : describe.skip)("RLS — isolation par organisation (Postgres réel, rôle applicatif)", () => {
  let prisma: PrismaClient;
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    if (!RUN) return;
    prisma = new PrismaClient();
    const a = await prisma.organization.create({
      data: { name: "RLS Org A", regimeFiscal: "tpu", legalForm: "commercial", nif: `NIF-A-${randomUUID()}` },
    });
    const b = await prisma.organization.create({
      data: { name: "RLS Org B", regimeFiscal: "tpu", legalForm: "commercial", nif: `NIF-B-${randomUUID()}` },
    });
    orgA = a.id;
    orgB = b.id;
    await prisma.invoice.create({ data: { organizationId: orgB } });
  });

  afterAll(async () => {
    if (!RUN) return;
    await prisma.invoice.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await prisma.$disconnect();
  });

  it("un client scopé sur l'organisation A ne voit aucune facture de l'organisation B", async () => {
    const scopedToA = organizationScopedClient(prisma, orgA);
    const seen = await scopedToA.invoice.findMany({});
    expect(seen.every((inv) => inv.organizationId === orgA)).toBe(true);
    expect(seen.some((inv) => inv.organizationId === orgB)).toBe(false);
  });

  it("un client scopé sur B voit bien sa propre facture", async () => {
    const scopedToB = organizationScopedClient(prisma, orgB);
    const seen = await scopedToB.invoice.findMany({});
    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(seen.every((inv) => inv.organizationId === orgB)).toBe(true);
  });
});

// Chantier A — scope PRACTICE : un cabinet voit les factures de ses organisations
// à mandat `active`, jamais celles d'une organisation non mandatée. Mêmes
// prérequis que ci-dessus (rôle applicatif non-propriétaire + FORCE).
(RUN ? describe : describe.skip)("RLS — scope practice (cabinet mandaté, Postgres réel)", () => {
  let prisma: PrismaClient;
  let orgMandated: string;
  let orgOther: string;
  let practiceId: string;

  beforeAll(async () => {
    if (!RUN) return;
    prisma = new PrismaClient();
    const m = await prisma.organization.create({
      data: { name: "RLS Org mandatée", regimeFiscal: "tpu", legalForm: "commercial", nif: `NIF-M-${randomUUID()}` },
    });
    const o = await prisma.organization.create({
      data: { name: "RLS Org tierce", regimeFiscal: "tpu", legalForm: "commercial", nif: `NIF-O-${randomUUID()}` },
    });
    orgMandated = m.id;
    orgOther = o.id;
    const practice = await prisma.professionalPractice.create({
      data: { type: "cabinet_comptable", name: `RLS Cabinet ${randomUUID()}`, phone: "+224600000000" },
    });
    practiceId = practice.id;
    await prisma.mandate.create({
      data: {
        practiceId,
        organizationId: orgMandated,
        status: "active",
        grantedRole: "accountant_external",
        initiatedBy: "practice",
      },
    });
    await prisma.invoice.create({ data: { organizationId: orgMandated } });
    await prisma.invoice.create({ data: { organizationId: orgOther } });
  });

  afterAll(async () => {
    if (!RUN) return;
    await prisma.invoice.deleteMany({ where: { organizationId: { in: [orgMandated, orgOther] } } });
    await prisma.mandate.deleteMany({ where: { practiceId } });
    await prisma.professionalPractice.deleteMany({ where: { id: practiceId } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgMandated, orgOther] } } });
    await prisma.$disconnect();
  });

  it("voit les factures de l'organisation mandatée, jamais celles d'une organisation tierce", async () => {
    const scoped = practiceScopedClient(prisma, practiceId);
    const seen = await scoped.invoice.findMany({});
    expect(seen.some((inv) => inv.organizationId === orgMandated)).toBe(true);
    expect(seen.some((inv) => inv.organizationId === orgOther)).toBe(false);
  });

  it("un practiceId sans aucun mandat actif ne voit rien", async () => {
    const scoped = practiceScopedClient(prisma, randomUUID());
    const seen = await scoped.invoice.findMany({});
    expect(seen.length).toBe(0);
  });
});
