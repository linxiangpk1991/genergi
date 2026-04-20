import type { HelpWorkflowGuide } from "./types"

export const workflowGuides: HelpWorkflowGuide[] = [
  {
    id: "launch-review-delivery",
    title: "新建任务 -> 审阅 -> 交付",
    summary: "适合运营理解一条视频从内容母本到成片交付的完整主流程。",
    audienceNote: "最适合第一次接触系统的运营同学。",
    stages: [
      {
        id: "launch",
        title: "任务启动",
        description: "在任务启动页填写任务名称、内容母本、时长、尺寸和所属项目，发起新任务。",
        notes: ["先把内容写清楚，再确认输出时长和终端尺寸。"],
      },
      {
        id: "task-review",
        title: "任务审核",
        description: "整任务检查蓝图、旁白、关键画面、图片提示词、视频提示词和终端尺寸，确认是否继续执行。",
        notes: ["重点看整套分镜契约是否连续一致。", "审核通过后还需要显式继续完整生成。"],
      },
      {
        id: "delivery",
        title: "交付资产",
        description: "查看最终视频、字幕、脚本和中间资产，确认交付内容是否齐全。",
        notes: ["最终视频通过后，再回看字幕和脚本细节。"],
      },
    ],
    decisionPoints: [
      "任务启动时只需要确定内容母本、时长和终端尺寸，系统会按保真优先的单一路径规划分镜。",
      "任务审核通过后，任务才会继续完整视频生成；审核驳回则需要重建蓝图。",
      "交付资产里优先看最终视频，再决定是否需要继续回查中间产物。",
    ],
    relatedFeatureIds: ["task-launch", "task-review", "project-library", "asset-center"],
  },
  {
    id: "model-onboarding-and-defaults",
    title: "模型接入 -> 模型登记 -> 默认值设置",
    summary: "适合理解模型控制中心的稳定基线如何形成，以及新任务创建时会冻结哪套默认值。",
    audienceNote: "最适合模型接入、调参与系统配置负责人。",
    stages: [
      {
        id: "provider",
        title: "新增 Provider",
        description: "先登记连接目标、鉴权方式和密钥状态，让系统知道可以连到哪里。",
        notes: ["新增后默认是草稿状态，需要继续校验。"],
      },
      {
        id: "registry",
        title: "登记 Model",
        description: "把可运行模型按四个运行时槽位登记到 Model Registry，并绑定对应 Provider。",
        notes: ["当前只维护四个运行时槽位：文本、图片、视频、TTS。", "不要再按草图/终稿去理解图片和视频模型。"],
      },
      {
        id: "defaults",
        title: "设置默认值",
        description: "在 Defaults Center 中设置全局默认和模式默认，形成稳定基线。",
        notes: ["模式默认会覆盖全局默认。", "任务创建时只会冻结当下有效的默认值，不再在任务页做临时覆盖。"],
      },
    ],
    decisionPoints: [
      "只有通过校验的 Provider 和 Model 才会进入默认值可选池。",
      "默认值优先级固定：模式默认 > 全局默认；任务创建后会冻结为任务快照。",
      "后续再调整默认值，不会回写已经创建的历史任务。",
    ],
    relatedFeatureIds: ["model-control-center"],
  },
  {
    id: "failure-triage",
    title: "失败任务 -> 看板定位 -> 资产排查 -> 继续处理",
    summary: "适合理解任务失败后从哪里开始排查，以及如何快速回到正确页面继续处理。",
    audienceNote: "适合日常值班、排障和交付复核场景。",
    stages: [
      {
        id: "dashboard",
        title: "先看生产看板",
        description: "在生产看板里定位失败任务、运行状态和需要人工继续处理的异常。",
        notes: ["先确认失败在哪个任务，而不是直接到处翻页面。"],
      },
      {
        id: "asset-check",
        title: "再看交付资产",
        description: "进入资产中心确认当前已经产出了什么，哪些环节已经完成，哪些还缺失。",
        notes: ["先看最终视频是否存在，再看中间资产。"],
      },
      {
        id: "review-context",
        title: "必要时回到任务审核",
        description: "如果问题出在蓝图契约、关键画面或提示词表达上，再回到任务审核工作台继续处理。",
        notes: ["不要在没确认问题类型时直接重做。", "审核通过但未继续执行的任务，也应从这里恢复主链。"],
      },
    ],
    decisionPoints: [
      "先分清是生成失败、内容问题还是交付缺失，再决定去哪一页继续处理。",
      "失败任务优先看任务状态和资产缺口，不要直接猜原因。",
    ],
    relatedFeatureIds: ["batch-dashboard", "asset-center", "task-review"],
  },
]
