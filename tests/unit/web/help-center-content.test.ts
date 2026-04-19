import { describe, expect, it } from "vitest"

import { featureGuides } from "../../../apps/web/src/help-center/content/features"
import { releaseTimelineEntries } from "../../../apps/web/src/help-center/content/releases"
import { workflowGuides } from "../../../apps/web/src/help-center/content/workflows"

describe("help center content integrity", () => {
  it("defines unique workflow guides with stages and related features", () => {
    const ids = new Set<string>()

    expect(workflowGuides.length).toBeGreaterThanOrEqual(3)

    for (const workflow of workflowGuides) {
      expect(workflow.id.length).toBeGreaterThan(0)
      expect(ids.has(workflow.id)).toBe(false)
      ids.add(workflow.id)

      expect(workflow.title.length).toBeGreaterThan(0)
      expect(workflow.summary.length).toBeGreaterThan(0)
      expect(workflow.stages.length).toBeGreaterThan(1)
      expect(workflow.relatedFeatureIds.length).toBeGreaterThan(0)

      for (const stage of workflow.stages) {
        expect(stage.id.length).toBeGreaterThan(0)
        expect(stage.title.length).toBeGreaterThan(0)
        expect(stage.description.length).toBeGreaterThan(0)
      }
    }
  })

  it("defines unique feature guides with operator-first sections", () => {
    const ids = new Set<string>()

    expect(featureGuides.length).toBeGreaterThanOrEqual(7)

    for (const feature of featureGuides) {
      expect(feature.id.length).toBeGreaterThan(0)
      expect(ids.has(feature.id)).toBe(false)
      ids.add(feature.id)

      expect(feature.title.length).toBeGreaterThan(0)
      expect(feature.purpose.length).toBeGreaterThan(0)
      expect(feature.whenToUse.length).toBeGreaterThan(0)
      expect(feature.sections.length).toBeGreaterThanOrEqual(3)

      for (const section of feature.sections) {
        expect(section.title.length).toBeGreaterThan(0)
        expect(section.points.length).toBeGreaterThan(0)
      }
    }
  })

  it("defines timeline entries with practical operator summaries", () => {
    const ids = new Set<string>()

    expect(releaseTimelineEntries.length).toBeGreaterThanOrEqual(3)

    for (const entry of releaseTimelineEntries) {
      expect(entry.id.length).toBeGreaterThan(0)
      expect(ids.has(entry.id)).toBe(false)
      ids.add(entry.id)

      expect(entry.versionDate.length).toBeGreaterThan(0)
      expect(entry.title.length).toBeGreaterThan(0)
      expect(entry.summary.length).toBeGreaterThan(0)
      expect(entry.affectedFeatureIds.length).toBeGreaterThan(0)
      expect(entry.operatorNotes.length).toBeGreaterThan(0)
    }
  })
})
