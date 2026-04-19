import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const stylesPath = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "apps",
  "web",
  "src",
  "styles.css",
);

function readStylesheet() {
  return readFileSync(stylesPath, "utf8").replace(/\r\n/g, "\n");
}

describe("web UI style regressions", () => {
  it("keeps eyebrow typography isolated from helper and body copy", () => {
    const stylesheet = readStylesheet();

    expect(stylesheet).toContain(".eyebrow {");
    expect(stylesheet).not.toContain(".topbar p,\n.muted,\n.task-item span,\n.eyebrow {");
  });

  it("provides a reduced-motion fallback for the running status pulse", () => {
    const stylesheet = readStylesheet();
    const pulseMatch = stylesheet.match(/@keyframes pulse \{([\s\S]*?)\n\}/);

    expect(pulseMatch?.[1]).toBeTruthy();
    expect(pulseMatch?.[1]).not.toMatch(/box-shadow/);
    expect(stylesheet).toContain("@media (prefers-reduced-motion: reduce)");
    expect(stylesheet).toContain(".status-dot--running");
    expect(stylesheet).toContain("animation: none;");
  });
});
