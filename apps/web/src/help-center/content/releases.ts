import type { HelpReleaseEntry } from "./types"

export const releaseTimelineEntries: HelpReleaseEntry[] = [
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
    summary: "模型控制面、任务覆盖和运行时快照统一收敛到文本、图片、视频、TTS 四个真实槽位。",
    affectedFeatureIds: ["model-control-center", "task-launch", "task-review"],
    operatorNotes: [
      "图片和视频不再区分草图/终稿槽位，当前任务启动即直接走真实生成链。",
      "旧任务数据清理后，新任务只会冻结四个运行时槽位。",
    ],
    workflowChanges: [
      "Defaults Center 和任务级高级覆盖都只显示四个槽位。",
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
      "任务级高级覆盖更容易理解默认值和最终生效结果。",
    ],
  },
  {
    id: "2026-04-19-model-control-plane",
    versionDate: "2026-04-19",
    title: "模型控制面正式接入",
    summary: "平台新增 Provider Registry、Model Registry、Defaults Center 和任务级高级覆盖。",
    affectedFeatureIds: ["model-control-center", "task-launch"],
    operatorNotes: [
      "Provider 和 Model 需要通过校验后才进入可选池。",
      "默认值采用全局默认、模式默认、任务覆盖三层优先级。",
    ],
    workflowChanges: [
      "新增模型接入 -> 登记 -> 默认值 -> 任务覆盖的完整控制链。",
      "任务创建后会冻结模型快照，不再跟随后续默认值变化。",
    ],
  },
]
