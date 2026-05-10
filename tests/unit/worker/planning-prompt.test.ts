import { describe, expect, it } from "vitest"

describe("worker planning prompt", () => {
  it("builds a fidelity-first planning prompt without enhancement language", async () => {
    const providers = await import("../../../apps/worker/src/lib/providers")

    const prompt = providers.buildPlanningPromptContext({
      originalScript: "A user-supplied whole-video script.",
      projectId: "project_default",
      targetDurationSec: 30,
      platform: "tiktok",
      executionMode: "review_required",
      terminalPresetId: "phone_portrait",
      renderSpec: {
        width: 1080,
        height: 1920,
        aspectRatio: "9:16",
        compositionGuideline: "Keep the subject centered",
        motionGuideline: "Prefer slow push-ins",
      },
      generationMode: "user_locked",
      generationRoute: "multi_scene",
      routeReason: "target duration exceeds single-shot capability",
      maxSingleShotSec: 8,
      enhancementKeywords: [],
    })

    expect(prompt).toContain("A user-supplied whole-video script.")
    expect(prompt).toContain("generation route: multi_scene")
    expect(prompt).not.toContain("stronger hook")
    expect(prompt).not.toContain("generation mode:")
    expect(prompt).not.toContain("platform:")
    expect(prompt).toContain("do not add new products, offers, commercial angles, or environments")
    expect(prompt).toContain("preserve the user's original topic, domain, subject, scene, and CTA intent")
    expect(prompt).toContain("scenePlan.script and scenePlan.voiceoverScript are the final narration draft")
    expect(prompt).toContain("scenePlan.imagePrompt and scenePlan.videoPrompt are the final downstream prompts")
  })

  it("still enforces exact scene count and machine-usable output rules", async () => {
    const providers = await import("../../../apps/worker/src/lib/providers")

    const prompt = providers.buildPlanningPromptContext({
      originalScript: "A user-supplied whole-video script.",
      projectId: "project_default",
      targetDurationSec: 15,
      platform: "reels",
      executionMode: "review_required",
      terminalPresetId: "phone_portrait",
      renderSpec: {
        width: 1080,
        height: 1920,
        aspectRatio: "9:16",
        compositionGuideline: "Keep the subject centered",
        motionGuideline: "Prefer slow push-ins",
      },
      generationMode: "system_enhanced",
      generationRoute: "multi_scene",
      routeReason: "current model max single-shot length is 8 seconds",
      maxSingleShotSec: 8,
      enhancementKeywords: ["stronger hook", "native pacing", "clear CTA"],
    })

    expect(prompt).toContain("do not output explanations")
    expect(prompt).toContain("exactly 2 scenes")
    expect(prompt).toContain("finalVoiceoverScript must be direct voiceover text")
  })

  it("ignores commentary extras when machine-usable fields are present", async () => {
    const providers = await import("../../../apps/worker/src/lib/providers")

    const result = providers.validatePlanningOutput(
      {
        generationRoute: "multi_scene",
        targetDurationSec: 30,
        finalVoiceoverScript: "Valid script.",
        visualStyleGuide: "Native pacing.",
        ctaLine: "Link in bio.",
        commentary: "What changed and why",
        scenePlan: [
          {
            sceneIndex: 0,
            scenePurpose: "Hook",
            durationSec: 10,
            script: "Hook line.",
            imagePrompt: "Image prompt.",
            videoPrompt: "Video prompt.",
            transitionHint: "cut",
          },
          {
            sceneIndex: 1,
            scenePurpose: "Body",
            durationSec: 10,
            script: "Body line.",
            imagePrompt: "Image prompt.",
            videoPrompt: "Video prompt.",
            transitionHint: "cut",
          },
          {
            sceneIndex: 2,
            scenePurpose: "CTA",
            durationSec: 10,
            script: "CTA line.",
            imagePrompt: "Image prompt.",
            videoPrompt: "Video prompt.",
            transitionHint: "cut",
          },
        ],
      },
      {
        generationRoute: "multi_scene",
        targetDurationSec: 30,
      },
    )

    expect(result.ok).toBe(true)
  })

  it("accepts the model scene plan even when it differs from prior platform expectations", async () => {
    const providers = await import("../../../apps/worker/src/lib/providers")

    const result = providers.validatePlanningOutput(
      {
        generationRoute: "multi_scene",
        targetDurationSec: 15,
        finalVoiceoverScript: "Valid script.",
        visualStyleGuide: "Native pacing.",
        ctaLine: "Link in bio.",
        blueprint: {
          executionMode: "review_required",
          renderSpec: {
            terminalPresetId: "phone_portrait",
            width: 1080,
            height: 1920,
            aspectRatio: "9:16",
            safeArea: { topPct: 8, rightPct: 6, bottomPct: 10, leftPct: 6 },
            compositionGuideline: "Keep the subject centered",
            motionGuideline: "Prefer slow push-ins",
          },
          globalTheme: "Theme",
          visualStyleGuide: "Native pacing.",
          subjectProfile: "Single subject",
          productProfile: "Consistent product",
          backgroundConstraints: [],
          negativeConstraints: [],
          totalVoiceoverScript: "Valid script.",
          sceneContracts: [
            { id: "scene_1", index: 0, sceneGoal: "Hook", voiceoverScript: "A", startFrameDescription: "A", imagePrompt: "A", videoPrompt: "A", startFrameIntent: "A", endFrameIntent: "A", durationSec: 4, transitionHint: "cut", continuityConstraints: [] },
            { id: "scene_2", index: 1, sceneGoal: "Body", voiceoverScript: "B", startFrameDescription: "B", imagePrompt: "B", videoPrompt: "B", startFrameIntent: "B", endFrameIntent: "B", durationSec: 4, transitionHint: "cut", continuityConstraints: [] },
            { id: "scene_3", index: 2, sceneGoal: "Body", voiceoverScript: "C", startFrameDescription: "C", imagePrompt: "C", videoPrompt: "C", startFrameIntent: "C", endFrameIntent: "C", durationSec: 4, transitionHint: "cut", continuityConstraints: [] },
            { id: "scene_4", index: 3, sceneGoal: "CTA", voiceoverScript: "D", startFrameDescription: "D", imagePrompt: "D", videoPrompt: "D", startFrameIntent: "D", endFrameIntent: "D", durationSec: 3, transitionHint: "close", continuityConstraints: [] },
          ],
        },
        scenePlan: [
          { sceneIndex: 0, scenePurpose: "Hook", durationSec: 4, script: "A", voiceoverScript: "A", startFrameDescription: "A", imagePrompt: "A", videoPrompt: "A", startFrameIntent: "A", endFrameIntent: "A", transitionHint: "cut" },
          { sceneIndex: 1, scenePurpose: "Body", durationSec: 4, script: "B", voiceoverScript: "B", startFrameDescription: "B", imagePrompt: "B", videoPrompt: "B", startFrameIntent: "B", endFrameIntent: "B", transitionHint: "cut" },
          { sceneIndex: 2, scenePurpose: "Body", durationSec: 4, script: "C", voiceoverScript: "C", startFrameDescription: "C", imagePrompt: "C", videoPrompt: "C", startFrameIntent: "C", endFrameIntent: "C", transitionHint: "cut" },
          { sceneIndex: 3, scenePurpose: "CTA", durationSec: 3, script: "D", voiceoverScript: "D", startFrameDescription: "D", imagePrompt: "D", videoPrompt: "D", startFrameIntent: "D", endFrameIntent: "D", transitionHint: "close" },
        ],
      },
      {
        generationRoute: "multi_scene",
        targetDurationSec: 15,
        maxSceneCount: 2,
        maxSingleShotSec: 8,
      },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected validation success")
    }
    expect(result.value.scenePlan).toHaveLength(4)
  })

  it("normalizes V3 execution brief keyframe prompts as the downstream English execution source", async () => {
    const providers = await import("../../../apps/worker/src/lib/providers")

    const result = providers.validatePlanningOutput(
      {
        generationRoute: "multi_scene",
        targetDurationSec: 30,
        finalVoiceoverScript: "Valid script.",
        visualStyleGuide: "Soft cinematic education style.",
        ctaLine: "Link in bio.",
        bilingualUnderstandingPreview: {
          version: "understanding-preview-v1",
          generatedAt: "2026-05-10T00:00:00.000Z",
          sourceBriefHash: "brief-hash",
          topic: { zh: "职业周期", en: "Career cycle" },
          targetAudience: { zh: "努力但停滞的人", en: "People who feel stuck despite working hard" },
          corePainPoint: { zh: "努力没有反馈", en: "Hard work is not translating into progress" },
          mainPromise: { zh: "解释大运周期", en: "Explain luck-cycle timing" },
          conversionGoal: { zh: "查看完整报告", en: "View the full report" },
          emotionalArc: { zh: "疲惫到希望", en: "From tired to hopeful" },
          recommendedStructure: { zh: "痛点、解释、共鸣、行动", en: "Pain, explanation, pattern, action" },
          visualBrief: {
            subject: { zh: "28 岁亚洲女性", en: "28-year-old Asian woman" },
            setting: { zh: "深夜办公室", en: "late-night office" },
            style: { zh: "柔和电影感", en: "soft cinematic illustration" },
            mood: { zh: "疲惫反思", en: "tired and reflective" },
            negativeRules: [{ zh: "不要文字", en: "no text overlays" }],
            consistencyRules: [{ zh: "保持同一主角", en: "keep the same lead character" }],
          },
          riskWarnings: [],
          status: "confirmed",
        },
        englishExecutionBrief: {
          version: "execution-brief-v1",
          sourceBrief: "Explain the BaZi luck cycle.",
          topic: "Career cycle",
          targetAudience: "People who feel stuck despite working hard",
          corePainPoint: "Hard work is not translating into progress",
          mainPromise: "Explain luck-cycle timing",
          conversionGoal: "View the full report",
          emotionalArc: "From tired to hopeful",
          visualBrief: {
            subject: "28-year-old Asian woman",
            setting: "late-night office",
            style: "soft cinematic illustration",
            mood: "tired and reflective",
            negativeRules: ["no text overlays"],
            consistencyRules: ["keep the same lead character"],
          },
          narrativeStructure: ["Pain hook", "Explanation"],
          keyframePlan: [
            {
              index: 1,
              timestampRange: "0-15s",
              narrativeRole: "Pain hook",
              visualGoal: "Show the tired lead character at her desk.",
              imagePrompt: "English execution image prompt for frame one.",
              videoPrompt: "English execution video prompt for frame one.",
            },
            {
              index: 2,
              timestampRange: "15-30s",
              narrativeRole: "Explanation",
              visualGoal: "Show the realization moment.",
              imagePrompt: "English execution image prompt for frame two.",
              videoPrompt: "English execution video prompt for frame two.",
            },
          ],
          finalPromptLanguage: "en",
        },
        scenePlan: [
          { sceneIndex: 0, scenePurpose: "Hook", durationSec: 15, script: "A", voiceoverScript: "A", startFrameDescription: "A", imagePrompt: "Legacy image prompt one.", videoPrompt: "Legacy video prompt one.", startFrameIntent: "A", endFrameIntent: "A", transitionHint: "cut" },
          { sceneIndex: 1, scenePurpose: "Body", durationSec: 15, script: "B", voiceoverScript: "B", startFrameDescription: "B", imagePrompt: "Legacy image prompt two.", videoPrompt: "Legacy video prompt two.", startFrameIntent: "B", endFrameIntent: "B", transitionHint: "close" },
        ],
        blueprint: {
          executionMode: "review_required",
          renderSpec: {
            terminalPresetId: "phone_portrait",
            width: 1080,
            height: 1920,
            aspectRatio: "9:16",
            safeArea: { topPct: 8, rightPct: 6, bottomPct: 10, leftPct: 6 },
            compositionGuideline: "Keep the subject centered",
            motionGuideline: "Prefer slow push-ins",
          },
          globalTheme: "Theme",
          visualStyleGuide: "Soft cinematic education style.",
          subjectProfile: "Single subject",
          productProfile: "BaZi report",
          backgroundConstraints: [],
          negativeConstraints: [],
          totalVoiceoverScript: "Valid script.",
          sceneContracts: [],
        },
      },
      {
        generationRoute: "multi_scene",
        targetDurationSec: 30,
      },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error(result.reason)
    }
    expect(result.value.scenePlan[0]?.imagePrompt).toBe("English execution image prompt for frame one.")
    expect(result.value.scenePlan[1]?.videoPrompt).toBe("English execution video prompt for frame two.")
    expect(result.value.blueprint.englishExecutionBrief?.finalPromptLanguage).toBe("en")
  })

  it("uses a frozen task execution brief when rebuilding worker scene contracts", async () => {
    const providers = await import("../../../apps/worker/src/lib/providers")

    const detail = {
      title: "BaZi career cycle smoke",
      taskRunConfig: {
        executionMode: "review_required",
        renderSpecJson: {
          terminalPresetId: "phone_portrait",
          width: 1080,
          height: 1920,
          aspectRatio: "9:16",
          safeArea: { topPct: 8, rightPct: 6, bottomPct: 10, leftPct: 6 },
          compositionGuideline: "Keep the subject centered",
          motionGuideline: "Prefer slow push-ins",
        },
        understandingPreview: null,
        keyframeCount: 4,
        keyframeGenerationMode: "batch",
        visualSeedInput: "主角：28 岁亚洲女性。场景：深夜办公室。",
        executionBrief: {
          version: "execution-brief-v1",
          sourceBrief: "Explain the BaZi luck cycle.",
          topic: "Career cycle",
          targetAudience: "People who feel stuck despite working hard",
          corePainPoint: "Hard work is not translating into progress",
          mainPromise: "Explain luck-cycle timing",
          conversionGoal: "View the full report",
          emotionalArc: "From tired to hopeful",
          visualBrief: {
            subject: "28-year-old Asian woman",
            setting: "late-night office",
            style: "soft cinematic illustration",
            mood: "tired and reflective",
            negativeRules: ["no text overlays"],
            consistencyRules: ["keep the same lead character"],
          },
          narrativeStructure: ["Pain hook"],
          keyframePlan: [
            {
              index: 1,
              timestampRange: "0-15s",
              narrativeRole: "Pain hook",
              visualGoal: "Show the tired lead character at her desk.",
              imagePrompt: "Pain hook: show 28-year-old Asian woman in late-night office.",
              videoPrompt: "Slow push-in on the tired professional at her desk.",
            },
          ],
          finalPromptLanguage: "en",
        },
      },
    }

    const planned = {
      finalVoiceoverScript: "Voiceover.",
      ctaLine: "Link in bio.",
      visualStyleGuide: "Soft cinematic education style.",
      scenePlan: [
        {
          sceneIndex: 0,
          scenePurpose: "Weak legacy purpose",
          durationSec: 15,
          script: "Voiceover.",
          voiceoverScript: "Voiceover.",
          startFrameDescription: "Weak legacy frame.",
          imagePrompt: "Weak legacy image prompt.",
          videoPrompt: "Weak legacy video prompt.",
          startFrameIntent: "Weak legacy intent.",
          endFrameIntent: "Weak legacy end.",
          transitionHint: "cut",
          continuityConstraints: [],
        },
      ],
      blueprint: {
        visualStyleGuide: "Soft cinematic education style.",
        subjectProfile: "Single subject",
        productProfile: "BaZi report",
        backgroundConstraints: [],
        negativeConstraints: [],
        totalVoiceoverScript: "Voiceover.",
      },
    }

    const blueprint = providers.buildPlannedExecutionBlueprint(detail, planned)

    expect(blueprint.englishExecutionBrief?.finalPromptLanguage).toBe("en")
    expect(blueprint.sceneContracts[0]?.imagePrompt).toContain("28-year-old Asian woman")
    expect(blueprint.sceneContracts[0]?.videoPrompt).toContain("Slow push-in")
    expect(blueprint.sceneContracts[0]?.imagePrompt).not.toContain("Weak legacy")
  })

  it("accepts legacy N7-style planning output instead of rejecting it and falling back", async () => {
    const providers = await import("../../../apps/worker/src/lib/providers")

    const result = providers.validatePlanningOutput(
      {
        projectId: "project_default",
        executionMode: "review_required",
        terminalPreset: "phone_portrait",
        renderSize: "1080x1920",
        renderAspectRatio: "9:16",
        targetDuration: "30s",
        generationRoute: "multi_scene",
        routeReason: "target duration 30s exceeds the current model single-shot limit of 8s",
        modelSingleShotCeiling: "8s",
        compositionGuideline: "Keep the subject centered",
        motionGuideline: "Prefer slow push-ins",
        finalVoiceoverScript:
          "If you've been working hard for years but still feel stuck. Link in bio. Enter your birth date and time.",
        scenePlan: [
          {
            sceneIndex: 1,
            duration: "8s",
            script: "Hook line.",
            voiceoverScript: "Hook line.",
            imagePrompt: "A panda in a Chinese-style room.",
            videoPrompt: "The panda talks directly to camera.",
          },
          {
            sceneIndex: 2,
            duration: "8s",
            script: "Body line one.",
            voiceoverScript: "Body line one.",
            imagePrompt: "The panda stands beside a bookshelf.",
            videoPrompt: "The panda gestures gently.",
          },
          {
            sceneIndex: 3,
            duration: "8s",
            script: "Body line two.",
            voiceoverScript: "Body line two.",
            imagePrompt: "The panda points at a chart.",
            videoPrompt: "The panda taps the chart.",
          },
          {
            sceneIndex: 4,
            duration: "6s",
            script: "CTA line.",
            voiceoverScript: "CTA line.",
            imagePrompt: "The panda leans toward camera with a smile.",
            videoPrompt: "The panda gives a thumbs-up.",
          },
        ],
      },
      {
        generationRoute: "multi_scene",
        targetDurationSec: 30,
        maxSceneCount: 4,
        maxSingleShotSec: 8,
        executionMode: "review_required",
        renderSpec: {
          terminalPresetId: "phone_portrait",
          width: 1080,
          height: 1920,
          aspectRatio: "9:16",
          safeArea: { topPct: 8, rightPct: 6, bottomPct: 10, leftPct: 6 },
          compositionGuideline: "Keep the subject centered",
          motionGuideline: "Prefer slow push-ins",
        },
        generationMode: "user_locked",
        originalScript: "ignored",
      },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected validation success")
    }
    expect(result.value.targetDurationSec).toBe(30)
    expect(result.value.ctaLine).toBe("CTA line.")
    expect(result.value.scenePlan[3]?.imagePrompt).toBe("The panda leans toward camera with a smile.")
  })

})
