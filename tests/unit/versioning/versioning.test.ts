import { describe, expect, it } from "vitest";

describe("v2 versioning contract", () => {
  it("exports the schema and config version gates", async () => {
    const versioningModulePath = ["..", "..", "..", "electron", "services", "versioning", "schema-version"].join("/");
    const versioning = await import(versioningModulePath);

    expect(typeof versioning.SCHEMA_VERSION).toBe("number");
    expect(typeof versioning.CONFIG_VERSION).toBe("number");
    expect(versioning.SCHEMA_VERSION).toBeGreaterThan(0);
    expect(versioning.CONFIG_VERSION).toBeGreaterThan(0);
  });
});
