import type { HelpReleaseEntry } from "./types"

export const releaseTimelineEntries: HelpReleaseEntry[] = [
  {
    id: "2026-04-21-single-path-fidelity-first",
    versionDate: "2026-04-21",
    title: "单一路径母本保真重构上线",
    summary: "任务启动页收口为单一路径，只保留母本、项目、时长和终端尺寸约束，文本规划与提示词重新锚定母本语义。",
    affectedFeatureIds: ["task-launch", "task-review", "batch-dashboard", "asset-center", "model-control-center"],
    operatorNotes: [
      "任务启动页不再暴露渠道、生成方式和任务级临时覆盖，避免在入口处改写内容方向。",
      "任务审核现在会更强调母本原文、一致性契约和关键画面/提示词是否真的围绕同一内容展开。",
    ],
    workflowChanges: [
      "新任务统一按保真优先的单一路径创建，高质量链路先审蓝图与关键画面，再继续完整视频生成。",
      "图片提示词和视频提示词改为由系统基于母本场景契约组合生成，不再直接采用文本模型自由改写后的整段提示词。",
    ],
  },
  {
    id: "2026-04-20-keyframe-first-review-flow",
    versionDate: "2026-04-20",
    title: "关键画面优先审核流上线",
    summary: "高质量任务改为先生成整套蓝图和关键画面，审核通过后再继续完整视频生成，并沉淀到项目审核库。",
    affectedFeatureIds: ["task-launch", "task-review", "project-library", "batch-dashboard", "asset-center"],
    operatorNotes: [
      "高质量任务不再走旧分镜审阅和旧关键帧审阅入口，统一改到整任务审核工作台。",
      "项目审核库会沉淀审核通过的蓝图版本，可作为后续任务的参考基线。",
    ],
    workflowChanges: [
      "任务启动时会冻结项目、执行模式和终端尺寸规格。",
      "审核通过后需要在任务审核页显式继续完整视频生成，不再自动滑入旧链。",
    ],
  },
  {
    id: "2026-04-20-unified-media-slots",
    versionDate: "2026-04-20",
    title: "统一媒体模型槽位",
    summary: "模型控制面和运行时快照统一收敛到文本、图片、视频、TTS 四个真实槽位。",
    affectedFeatureIds: ["model-control-center", "task-launch", "task-review"],
    operatorNotes: [
      "图片和视频不再区分草图/终稿槽位，当前任务启动即直接走真实生成链。",
      "旧任务数据清理后，新任务只会冻结四个运行时槽位。",
    ],
    workflowChanges: [
      "Defaults Center 和当时的任务入口都切到了四个真实槽位；后续版本再把任务入口收口为单一路径。",
      "帮助中心与模型控制说明同步改成四槽位心智。",
    ],
  },
  {
    id: "2026-04-19-help-center",
    versionDate: "2026-04-19",
    title: "帮助中心一期上线",
    summary: "帮助中心作为站内模块上线，支持按流程学习、按功能查阅和时间线更新日志。",
    affectedFeatureIds: ["task-launch", "task-review", "project-library", "batch-dashboard", "asset-center", "model-control-center", "user-center"],
    operatorNotes: [
      "现在可以在后台直接查看系统功能说明，不需要翻仓库文档。",
      "帮助中心内容按运营视角重写，优先看流程图和操作要点。",
    ],
    workflowChanges: [
      "新增从任务启动到交付的流程指引。",
      "新增模型控制中心从接入到覆盖的流程指引。",
    ],
  },
  {
    id: "2026-04-19-model-control-uiux",
    versionDate: "2026-04-19",
    title: "模型控制中心 UI/UX 精修",
    summary: "模型控制中心和主工作台的导航、层级和操作视图做了明显收口。",
    affectedFeatureIds: ["model-control-center", "task-launch"],
    operatorNotes: [
      "侧栏导航重新按工作区和系统管理分组。",
      "模型控制总览、Provider 管理和 Registry 页面更利于快速扫描。",
    ],
    workflowChanges: [
      "当时的任务入口更容易理解默认值和最终生效结果；后续版本已收口为单一路径。",
    ],
  },
  {
    id: "2026-04-19-model-control-plane",
    versionDate: "2026-04-19",
    title: "模型控制面正式接入",
    summary: "平台新增 Provider Registry、Model Registry、Defaults Center 和运行时冻结快照基线。",
    affectedFeatureIds: ["model-control-center", "task-launch"],
    operatorNotes: [
      "Provider 和 Model 需要通过校验后才进入可选池。",
      "默认值采用全局默认、任务创建默认值两层基线；任务创建时冻结快照。",
    ],
    workflowChanges: [
      "新增模型接入 -> 登记 -> 默认值的完整控制链。",
      "任务创建后会冻结模型快照，不再跟随后续默认值变化。",
    ],
  },
]
