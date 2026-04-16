import { describe, expect, it } from "vitest";

describe("model registry contract", () => {
  it("loads the registry module", async () => {
    const modelRegistryModulePath = ["..", "..", "..", "electron", "services", "models", "registry"].join("/");
    const modelRegistry = await import(modelRegistryModulePath);

    expect(modelRegistry).toBeTruthy();
  });
});
