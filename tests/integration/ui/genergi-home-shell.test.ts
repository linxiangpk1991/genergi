import { describe, expect, it } from "vitest";

describe("GENERGI home shell contract", () => {
  it("loads the home view component", async () => {
    const homeShellModulePath = ["..", "..", "..", "src", "views", "Home", "index.vue"].join("/");
    const homeShell = await import(homeShellModulePath);

    expect(homeShell).toBeTruthy();
  });
});
