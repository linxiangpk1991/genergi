import { describe, expect, it } from "vitest";

describe("preload contract", () => {
  it("loads the preload bridge module", async () => {
    const preloadContractModulePath = ["..", "..", "..", "electron", "preload"].join("/");
    const preloadContract = await import(preloadContractModulePath);

    expect(preloadContract).toBeTruthy();
  });
});
