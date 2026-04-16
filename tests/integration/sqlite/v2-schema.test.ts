import { describe, expect, it } from "vitest";

describe("sqlite v2 schema contract", () => {
  it("loads the sqlite v2 entrypoint", async () => {
    const v2SchemaModulePath = ["..", "..", "..", "electron", "sqlite", "index"].join("/");
    const v2Schema = await import(v2SchemaModulePath);

    expect(v2Schema).toBeTruthy();
  });
});
