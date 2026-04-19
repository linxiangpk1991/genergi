import type { HelpReleaseEntry } from "./types"

export const releaseTimelineEntries: HelpReleaseEntry[] = [
  {
    id: "2026-04-19-help-center",
    versionDate: "2026-04-19",
    title: "帮助中心一期上线",
    summary: "帮助中心作为站内模块上线，支持按流程学习、按功能查阅和时间线更新日志。",
    affectedFeatureIds: ["task-launch", "storyboard-review", "keyframe-review", "batch-dashboard", "asset-center", "model-control-center", "user-center"],
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
