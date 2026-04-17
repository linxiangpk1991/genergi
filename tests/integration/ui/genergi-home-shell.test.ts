import { describe, expect, it } from "vitest";

describe("GENERGI home shell contract", () => {
  it("loads the current React app shell", async () => {
    const homeShellModulePath = ["..", "..", "..", "apps", "web", "src", "App"].join("/");
    const homeShell = await import(homeShellModulePath);

    expect(homeShell).toBeTruthy();
    expect(typeof homeShell.App).toBe("function");
  });
});
