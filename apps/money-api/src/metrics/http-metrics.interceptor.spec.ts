import { of, throwError } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { HttpMetricsInterceptor } from "./http-metrics.interceptor";

function context(overrides: { method?: string; routePath?: string; url?: string; statusCode?: number }) {
  const req = { method: overrides.method ?? "GET", route: { path: overrides.routePath }, url: overrides.url ?? "/x" };
  const res = { statusCode: overrides.statusCode ?? 200 };
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as never;
}

describe("HttpMetricsInterceptor", () => {
  function build() {
    const observe = vi.fn();
    const histogram = { observe };
    return { interceptor: new HttpMetricsInterceptor(histogram as never), observe };
  }

  it("observe la durée avec method / route (pattern) / status_code sur une réponse OK", async () => {
    const { interceptor, observe } = build();
    const ctx = context({ method: "POST", routePath: "/invoices/:id/pdf", statusCode: 200 });

    await new Promise<void>((resolve) => {
      interceptor.intercept(ctx, { handle: () => of("ok") }).subscribe({ complete: resolve });
    });

    expect(observe).toHaveBeenCalledWith(
      { method: "POST", route: "/invoices/:id/pdf", status_code: 200 },
      expect.any(Number),
    );
  });

  it("observe AUSSI une requête qui lève une exception (5xx)", async () => {
    const { interceptor, observe } = build();
    const ctx = context({ method: "GET", routePath: "/invoices/:id", statusCode: 500 });

    await new Promise<void>((resolve) => {
      interceptor
        .intercept(ctx, { handle: () => throwError(() => new Error("boom")) })
        .subscribe({ error: () => resolve() });
    });

    expect(observe).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", route: "/invoices/:id" }),
      expect.any(Number),
    );
  });

  it("n'observe pas /metrics ni /health*", async () => {
    const { interceptor, observe } = build();
    for (const routePath of ["/metrics", "/health/live", "/health/ready"]) {
      await new Promise<void>((resolve) => {
        interceptor
          .intercept(context({ routePath }), { handle: () => of("x") })
          .subscribe({ complete: resolve });
      });
    }
    expect(observe).not.toHaveBeenCalled();
  });

  it("route = 'unmatched' quand aucune route ne correspond (jamais l'URL brute — cardinalité)", async () => {
    const { interceptor, observe } = build();
    const ctx = context({ method: "GET", routePath: undefined, url: "/totally/unknown/8f2a" });

    await new Promise<void>((resolve) => {
      interceptor.intercept(ctx, { handle: () => of("x") }).subscribe({ complete: resolve });
    });

    expect(observe).toHaveBeenCalledWith(
      expect.objectContaining({ route: "unmatched" }),
      expect.any(Number),
    );
  });
});
