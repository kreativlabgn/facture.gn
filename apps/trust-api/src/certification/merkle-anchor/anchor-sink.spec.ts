import { describe, expect, it } from "vitest";

import { NoopAnchorSink } from "./anchor-sink";

describe("NoopAnchorSink", () => {
  it("n'ancre jamais rien (retourne null → la tranche reste pending)", async () => {
    const sink = new NoopAnchorSink();
    expect(sink.name).toBe("noop");
    expect(await sink.anchor("deadbeef", "batch-1")).toBeNull();
  });
});
