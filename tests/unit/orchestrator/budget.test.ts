import { describe, expect, it } from "vitest";

describe("budget contract", () => {
  it("loads the budget module", async () => {
    const budgetModulePath = ["..", "..", "..", "electron", "services", "orchestrator", "budget"].join("/");
    const budget = await import(budgetModulePath);

    expect(budget).toBeTruthy();
  });
});
