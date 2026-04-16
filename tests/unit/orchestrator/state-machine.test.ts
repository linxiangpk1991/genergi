import { describe, expect, it } from "vitest";

describe("state machine contract", () => {
  it("loads the state machine module", async () => {
    const stateMachineModulePath = ["..", "..", "..", "electron", "services", "orchestrator", "state-machine"].join("/");
    const stateMachine = await import(stateMachineModulePath);

    expect(stateMachine).toBeTruthy();
  });
});
