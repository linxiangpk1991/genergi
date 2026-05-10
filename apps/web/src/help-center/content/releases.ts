import type { HelpReleaseEntry } from "./types"

export const releaseTimelineEntries: HelpReleaseEntry[] = [
  {
    id: "2026-05-09-visual-brief-batch-keyframes",
    versionDate: "2026-05-09",
    title: "画面参考与批量关键画面上线",
    summary: "任务启动支持用可选画面参考描述主角、场景、风格、情绪和禁止项，并按视频时长自动规划关键画面数量；支持的生图模型可一次返回整组关键画面。",
    affectedFeatureIds: ["task-launch", "task-review", "batch-dashboard", "asset-center", "model-control-center"],
    operatorNotes: [
      "运营不需要手动拆分四张图的提示词，只需提供视频内容，可选补充画面参考。",
      "60 秒视频默认规划 4 张关键画面；批量和单张生成方式会随任务固定并在审核、看板、素材页显示。",
    ],
    workflowChanges: [
      "任务启动新增画面参考（可选）输入和批量/单张选择。",
      "任务审核新增画面参考与关键画面追踪，素材与交付、生产看板、任务管理同步展示关键画面数量和生成方式。",
    ],
  },
  {
    id: "2026-04-21-single-path-fidelity-first",
    versionDate: "2026-04-21",
    title: "单一路径视频内容保真重构上线",
    summary: "任务启动页收口为单一路径，只保留视频内容、项目、时长和终端尺寸约束，文本规划与生成说明重新锚定视频内容。",
    affectedFeatureIds: ["task-launch", "task-review", "batch-dashboard", "asset-center", "model-control-center"],
    operatorNotes: [
      "任务启动页不再暴露渠道、生成方式和任务级临时覆盖，避免在入口处改写内容方向。",
      "任务审核现在会更强调视频内容、一致性要求和关键画面/生成说明是否真的围绕同一内容展开。",
    ],
    workflowChanges: [
      "新任务统一按保真优先的单一路径创建，先审核生成方案与关键画面，再继续生成正片。",
      "画面说明和视频说明改为由系统基于视频内容和分段内容组合生成，不再直接采用文本模型自由改写后的整段说明。",
    ],
  },
  {
    id: "2026-04-20-keyframe-first-review-flow",
    versionDate: "2026-04-20",
    title: "关键画面优先审核流上线",
    summary: "高质量任务改为先生成整套方案和关键画面，审核通过后再继续生成正片，并沉淀到项目模板库。",
    affectedFeatureIds: ["task-launch", "task-review", "project-library", "batch-dashboard", "asset-center"],
    operatorNotes: [
      "高质量任务不再走旧的视频分段审阅和旧关键画面审阅入口，统一改到整任务审核工作台。",
      "项目模板库会沉淀审核通过的方案版本，可作为后续任务的参考基线。",
    ],
    workflowChanges: [
      "任务启动时会固定项目、生成流程和终端尺寸规格。",
      "审核通过后需要在任务审核页显式继续生成正片，不再自动进入旧流程。",
    ],
  },
  {
    id: "2026-04-20-unified-media-slots",
    versionDate: "2026-04-20",
    title: "统一媒体模型槽位",
    summary: "模型设置和任务固定配置统一收敛到文本、图片、视频、配音四类生成能力。",
    affectedFeatureIds: ["model-control-center", "task-launch", "task-review"],
    operatorNotes: [
      "图片和视频不再区分草图/终稿槽位，当前任务启动即直接走真实生成链。",
      "旧任务数据清理后，新任务只会固定四类生成能力。",
    ],
    workflowChanges: [
      "默认模型和当时的任务入口都切到了四类生成能力；后续版本再把任务入口收口为单一路径。",
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
    summary: "模型设置和主工作台的导航、层级和操作视图做了明显收口。",
    affectedFeatureIds: ["model-control-center", "task-launch"],
    operatorNotes: [
      "侧栏导航重新按工作区和系统管理分组。",
      "模型配置概览、接入方管理和模型列表更利于快速扫描。",
    ],
    workflowChanges: [
      "当时的任务入口更容易理解默认值和最终生效结果；后续版本已收口为单一路径。",
    ],
  },
  {
    id: "2026-04-19-model-control-plane",
    versionDate: "2026-04-19",
    title: "模型控制面正式接入",
    summary: "平台新增接入方管理、模型列表、默认模型和任务固定配置基线。",
    affectedFeatureIds: ["model-control-center", "task-launch"],
    operatorNotes: [
      "接入方和模型需要通过校验后才进入可选池。",
      "默认值采用全局兜底、新任务默认两层基线；任务创建时固定本次设置。",
    ],
    workflowChanges: [
      "新增模型接入 -> 登记 -> 默认值的完整控制流程。",
      "任务创建后会固定模型设置，不再跟随后续默认值变化。",
    ],
  },
]
