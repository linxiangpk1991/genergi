import { describe, expect, it } from "vitest";

describe("task run config contract", () => {
  it("loads the task run config module", async () => {
    const taskRunConfigModulePath = ["..", "..", "..", "electron", "services", "orchestrator", "task-run-config"].join("/");
    const taskRunConfig = await import(taskRunConfigModulePath);

    expect(taskRunConfig).toBeTruthy();
  });
});
