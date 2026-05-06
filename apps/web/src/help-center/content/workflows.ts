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
        description: "在 Defaults Center 中设置全局默认和任务创建默认值，形成稳定基线。",
        notes: ["任务创建默认值会覆盖全局默认。", "任务创建时只会冻结当下有效的默认值，不再在任务页做临时覆盖。"],
      },
    ],
    decisionPoints: [
      "只有通过校验的 Provider 和 Model 才会进入默认值可选池。",
      "默认值优先级固定：任务创建默认值 > 全局默认；任务创建后会冻结为任务快照。",
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
  {
    id: "production-dispatch-sop",
    title: "生产调度 SOP",
    summary: "用于值班运营按 queued / running / waiting_review / blocked / failed / completed lane 管理当天生产节奏。",
    audienceNote: "适合日常排队、卡住任务、worker 容量和交付节奏调度。",
    stages: [
      {
        id: "when",
        title: "何时操作",
        description: "每天开班、批量提交后、worker 或 redis 降级时，先进入生产调度台确认 lane 数量和卡住任务。",
        notes: ["看到 blocked 或 failed 增长时，先停下追加任务。", "queued 明显高于 running 时，说明容量正在排队消化。"],
      },
      {
        id: "where",
        title: "点哪里",
        description: "点侧栏「生产看板」，先看顶部生产 lane，再看「Worker / Redis 容量」和「卡住任务」。",
        notes: ["blocked 任务先点「打开资产排查」。", "waiting_review 任务点「进入任务审核」。"],
      },
      {
        id: "acceptance",
        title: "验收什么",
        description: "验收 queued 能进入 running、running 有新心跳、waiting_review 被处理、blocked 不继续堆积、completed 可进入资产验收。",
        notes: ["最近刷新时间不能长期过期。", "worker 与 redis 至少要能说明当前是否健康。"],
      },
      {
        id: "do-not",
        title: "不要做什么",
        description: "不要把看板当作重试按钮合集，不要在容量异常时重复提交同一母本，不要跳过资产排查直接恢复卡住任务。",
      },
    ],
    decisionPoints: [
      "blocked 优先级高于 queued；先排除卡住任务，再追加生产。",
      "worker / redis 降级时只做安全动作入口，不把前端判断当作 BullMQ 内核状态。",
      "completed 只代表生产链完成，交付是否可用仍要进资产中心验收。",
    ],
    relatedFeatureIds: ["batch-dashboard", "asset-center", "task-review"],
  },
  {
    id: "failed-task-triage-sop",
    title: "失败任务排查 SOP",
    summary: "用于 failed lane 任务的失败分类、资产确认和恢复运行判断。",
    audienceNote: "适合排障值班、交付复核和恢复运行前确认。",
    stages: [
      {
        id: "when",
        title: "何时操作",
        description: "当生产调度台出现 failed，或任务卡在同一阶段并转为失败时，先执行失败任务排查。",
        notes: ["先看失败分类，再看失败原因原文。", "Provider timeout 与资产缺失的处理顺序不同。"],
      },
      {
        id: "where",
        title: "点哪里",
        description: "在 failed 卡片点「查看失败任务资产」或「打开资产排查」，进入资产中心核对最终视频和中间资产。",
        notes: ["如果蓝图或提示词有明显问题，再从资产中心回到任务审核。"],
      },
      {
        id: "acceptance",
        title: "验收什么",
        description: "验收当前已产出的资产、缺失资产类型、失败分类、最近心跳和恢复后状态是否回到 queued / running。",
      },
      {
        id: "do-not",
        title: "不要做什么",
        description: "不要只凭 failed 文案猜原因，不要没看资产就恢复运行，不要把内容质量问题当成 provider 故障。",
      },
    ],
    decisionPoints: [
      "provider_timeout 可在确认资产缺口后恢复运行。",
      "asset_missing 先确认文件是否真实缺失，再决定恢复或重新生成。",
      "blueprint_contract 先回任务审核修正内容契约，不要直接恢复。",
    ],
    relatedFeatureIds: ["batch-dashboard", "asset-center", "task-review"],
  },
  {
    id: "partial-retry-sop",
    title: "局部重试选择 SOP",
    summary: "用于判断应该恢复失败任务、恢复卡住任务，还是回到审核环节重建蓝图。",
    audienceNote: "适合需要控制成本、避免整条链路重跑的运营场景。",
    stages: [
      {
        id: "when",
        title: "何时操作",
        description: "当任务 failed、blocked，或资产中心显示部分资产已经就绪但最终交付缺失时，再考虑局部重试。",
      },
      {
        id: "where",
        title: "点哪里",
        description: "先在生产调度台点「打开资产排查」；确认可恢复后，再点「恢复运行」或「恢复卡住任务」。",
        notes: ["蓝图待审或已驳回时点「进入任务审核」，不要从看板硬恢复。"],
      },
      {
        id: "acceptance",
        title: "验收什么",
        description: "验收恢复后任务回到 queued / running、retryCount 合理增长、心跳恢复、已存在资产没有被误判为缺失。",
      },
      {
        id: "do-not",
        title: "不要做什么",
        description: "不要在没确认缺口前连续点恢复，不要为了省时间跳过蓝图审核，不要把局部重试当成内容返工工具。",
      },
    ],
    decisionPoints: [
      "保守顺序是：资产排查 -> 判断缺口 -> 再恢复。",
      "如果失败点在内容契约，局部重试通常不会解决质量问题。",
      "如果容量已经降级，先处理现有队列，不追加新的重试压力。",
    ],
    relatedFeatureIds: ["batch-dashboard", "asset-center", "task-review"],
  },
  {
    id: "delivery-acceptance-sop",
    title: "交付验收 SOP",
    summary: "用于 completed 任务的最终视频、字幕、脚本和下载交付确认。",
    audienceNote: "适合交付前最后一轮检查。",
    stages: [
      {
        id: "when",
        title: "何时操作",
        description: "当生产调度台 lane 显示 completed，或交付负责人需要确认可发给客户/渠道时执行。",
      },
      {
        id: "where",
        title: "点哪里",
        description: "在 completed 任务点「打开任务资产」，进入资产中心先看最终视频，再看字幕、脚本和中间资产。",
      },
      {
        id: "acceptance",
        title: "验收什么",
        description: "验收最终视频能预览或下载、字幕和音频对齐、时长偏差在可接受范围、关键画面与母本语义一致。",
      },
      {
        id: "do-not",
        title: "不要做什么",
        description: "不要只看到 completed 就交付，不要先翻中间资产忽略最终视频，不要把下载成功当成内容验收通过。",
      },
    ],
    decisionPoints: [
      "最终视频优先级高于中间资产。",
      "时长、字幕、音频、主体一致性都通过后，才算交付可用。",
      "交付缺失回资产中心排查，不在生产调度台直接猜原因。",
    ],
    relatedFeatureIds: ["batch-dashboard", "asset-center"],
  },
  {
    id: "blueprint-review-sop",
    title: "蓝图审核 SOP",
    summary: "用于 waiting_review lane 的蓝图通过、驳回和继续完整生成判断。",
    audienceNote: "适合高质量链路的内容审核和继续执行。",
    stages: [
      {
        id: "when",
        title: "何时操作",
        description: "当生产调度台出现 waiting_review，或任务审核页显示蓝图待审、已通过待继续、已驳回待处理时执行。",
      },
      {
        id: "where",
        title: "点哪里",
        description: "在 waiting_review 卡片点「进入任务审核」，逐段查看蓝图、关键画面、图片提示词、视频提示词和终端尺寸。",
      },
      {
        id: "acceptance",
        title: "验收什么",
        description: "验收母本语义没有跑偏、分镜连续、关键画面可执行、提示词不互相矛盾、通过后任务能继续完整生成。",
      },
      {
        id: "do-not",
        title: "不要做什么",
        description: "不要只看单张关键画面，不要把审核通过当成自动生成完成，不要在蓝图明显跑偏时直接继续执行。",
      },
    ],
    decisionPoints: [
      "内容契约可用才通过蓝图。",
      "蓝图已通过后仍要显式继续完整生成。",
      "蓝图驳回后先重建契约，再考虑重新生产视频。",
    ],
    relatedFeatureIds: ["task-review", "batch-dashboard", "project-library"],
  },
]
