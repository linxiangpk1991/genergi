import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("packaged ABI check contract", () => {
  it("documents the packaged ABI baseline in the deployment baseline doc", async () => {
    const deploymentBaseline = resolve(process.cwd(), "docs/architecture/deployment-baseline.md");
    const baselineDoc = await readFile(deploymentBaseline, "utf8");

    expect(baselineDoc).toMatch(/Packaged ABI/i);
  });
});
