import { Counter, register } from "prom-client";
import { afterEach, describe, expect, it } from "vitest";
import { MetricsController } from "./metrics.controller";

afterEach(() => register.clear());

describe("MetricsController", () => {
  it("renvoie le format d'exposition Prometheus des métriques enregistrées", async () => {
    new Counter({ name: "lot_f_money_test_counter", help: "test" }).inc();

    const body = await new MetricsController().scrape();

    expect(body).toContain("# HELP lot_f_money_test_counter");
    expect(body).toContain("# TYPE lot_f_money_test_counter counter");
  });
});
