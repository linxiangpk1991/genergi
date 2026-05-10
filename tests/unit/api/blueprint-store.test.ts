import { describe, expect, it } from "vitest"
import type { TaskDetail } from "@genergi/shared"

import { buildInitialBlueprintFromTaskDetail } from "../../../apps/api/src/lib/blueprint-store"

describe("API blueprint store", () => {
  it("uses the frozen English execution brief as the initial blueprint prompt source", () => {
    const detail = {
      taskId: "task_execution_brief",
      projectId: "project_default",
      title: "Execution brief smoke",
      script: "Original customer brief.",
      blueprintVersion: 1,
      updatedAt: "2026-05-10T00:00:00.000Z",
      visualStyleGuide: "Customer-selected visual style.",
      ctaLine: "Link in bio.",
      taskRunConfig: {
        executionMode: "single_path",
        renderSpecJson: {
          aspectRatio: "9:16",
          width: 1080,
          height: 1920,
          fps: 30,
          container: "mp4",
        },
        understandingPreview: {
          version: "understanding-preview-v1",
          topic: { zh: "职业周期", en: "Career cycle" },
          audience: { zh: "职场用户", en: "career-focused viewers" },
          message: { zh: "不要自责", en: "stop blaming yourself" },
          visualBrief: {
            subject: { zh: "28 岁亚洲女性", en: "28-year-old Asian woman" },
            setting: { zh: "深夜办公室", en: "late-night office" },
            style: { zh: "柔和电影感插画", en: "soft cinematic illustration" },
            mood: { zh: "疲惫、反思、希望", en: "tired, reflective, hopeful" },
            negative: { zh: "不要文字水印", en: "no text overlays or watermarks" },
          },
          keyframeCount: 4,
          keepCharacterConsistent: true,
        },
        executionBrief: {
          version: "execution-brief-v1",
        finalPromptLanguage: "en",
          sourceBrief: "BaZi career cycle short video.",
          topic: "BaZi career cycle",
          targetAudience: "career-focused viewers",
          corePainPoint: "hard work still feels stuck",
          mainPromise: "the luck cycle may explain the friction",
          conversionGoal: "link in bio for the full report",
          emotionalArc: "tired, reflective, hopeful",
          visualBrief: {
            subject: "28-year-old Asian woman",
            setting: "late-night office",
            style: "soft cinematic illustration",
            mood: "tired, reflective, hopeful",
            negativeRules: ["no text overlays or watermarks"],
            consistencyRules: ["keep the same primary character"],
          },
          narrativeStructure: ["Pain hook"],
          keyframePlan: [
            {
              index: 1,
              timestampRange: "0-15s",
              narrativeRole: "Pain hook",
              visualGoal: "Pain hook",
              imagePrompt: "Pain hook: show 28-year-old Asian woman in late-night office.",
              videoPrompt: "Slow push-in on the tired professional at her desk.",
            },
          ],
        },
      },
      scenes: [
        {
          id: "scene_1",
          index: 0,
          title: "Legacy scene title",
          script: "Legacy script.",
          durationSec: 15,
          imagePrompt: "Weak legacy image prompt.",
          videoPrompt: "Weak legacy video prompt.",
        },
      ],
    } as unknown as TaskDetail

    const blueprint = buildInitialBlueprintFromTaskDetail(detail)

    expect(blueprint.englishExecutionBrief?.finalPromptLanguage).toBe("en")
    expect(blueprint.bilingualUnderstandingPreview?.visualBrief.subject.en).toBe("28-year-old Asian woman")
    expect(blueprint.sceneContracts[0]?.imagePrompt).toContain("28-year-old Asian woman")
    expect(blueprint.sceneContracts[0]?.imagePrompt).not.toContain("Weak legacy")
    expect(blueprint.sceneContracts[0]?.videoPrompt).toContain("Slow push-in")
  })
})
