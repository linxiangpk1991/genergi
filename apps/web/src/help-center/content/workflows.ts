import type { HelpWorkflowGuide } from "./types"

export const workflowGuides: HelpWorkflowGuide[] = [
  {
    id: "launch-review-delivery",
    title: "新建任务 -> 审阅 -> 交付",
    summary: "适合运营理解一条视频从视频内容到成片交付的完整主流程。",
    audienceNote: "最适合第一次接触系统的运营同学。",
    stages: [
      {
        id: "launch",
        title: "任务启动",
        description: "在任务启动页填写任务名称、视频内容、可选画面参考、时长、尺寸和所属项目，发起新任务。",
        notes: ["先把内容写清楚，再确认输出时长和终端尺寸。", "画面参考是可选项；不填写时，系统会按视频内容补全主角、场景、风格、情绪和禁止项。"],
      },
      {
        id: "task-review",
        title: "任务审核",
        description: "整条视频检查生成方案、旁白、关键画面、画面说明、视频说明和终端尺寸，确认是否继续生成正片。",
        notes: ["重点看整套视频分段是否连续一致。", "审核通过后还需要显式继续生成正片。"],
      },
      {
        id: "delivery",
        title: "素材与交付",
        description: "查看成片视频、字幕、脚本和中间素材，确认交付内容是否齐全。",
        notes: ["最终视频通过后，再回看字幕和脚本细节。"],
      },
    ],
    decisionPoints: [
      "任务启动时只需要确定视频内容、可选画面参考、时长和终端尺寸，系统会按保真优先的单一路径规划视频分段和关键画面。",
      "任务审核通过后，任务才会继续生成正片；审核驳回则需要重做方案。",
      "素材与交付里优先看成片视频，再决定是否需要继续回查中间素材。",
    ],
    relatedFeatureIds: ["task-launch", "task-review", "project-library", "asset-center"],
  },
  {
    id: "task-launch-source-sop",
    title: "视频内容启动 SOP",
    summary: "用于运营在任务启动台把业务内容稳定转成审核优先任务，减少漏填、跑题和重复提交。",
    audienceNote: "适合日常新建任务、批量发车前自检和新人上手。",
    stages: [
      {
        id: "project-output",
        title: "先定项目与输出",
        description: "选择所属项目、终端预设和目标时长，确认默认渠道、输出语言和画幅是否符合本次交付。",
        notes: ["项目决定品牌方向和复用约束。", "时长会默认决定关键画面数量：约每 15 秒 1 张。"],
      },
      {
        id: "visual-brief",
        title: "可选补充画面参考",
        description: "如果你知道主角、场景、风格、情绪、禁止项或是否保持角色一致，就写在画面参考里；如果还不清楚，可以留空让文本模型补全。",
        notes: ["不要手动拆成很多输入框。", "批量生成适合一次返回整组画面，单张生成适合局部微调或模型不支持批量时使用。"],
      },
      {
        id: "source-copy",
        title: "再写视频内容",
        description: "把产品/服务、目标人群、核心卖点、使用场景、语气和 CTA 写清楚；必要时套用页面内模板补齐结构。",
        notes: ["视频内容是业务表达，不是技术说明。", "越清楚的目标人群和场景，越容易得到可审的生成方案。"],
      },
      {
        id: "preflight",
        title: "看启动前检查",
        description: "提交前查看文案检查、相似任务、预算粗估、音频字幕策略和最近异常任务提醒。",
        notes: ["有相似任务时先确认是否真的要重复生产。", "看到失败或卡住任务堆积时先去生产看板处理。"],
      },
      {
        id: "freeze",
        title: "确认提交并固定设置",
        description: "最后在确认弹窗复核任务名称、项目、渠道、时长、画幅、场景和预算；确认后任务进入审核优先队列。",
        notes: ["提交成功不等于完整成片完成。", "下一步应进入任务审核，看生成方案和关键画面是否可继续。"],
      },
    ],
    decisionPoints: [
      "视频内容至少要包含明确主题、卖点、目标人群或 CTA，缺少关键内容时先补充再提交。",
      "同项目、同标题、同视频内容或同长度内容重复时，先确认是否复用已有任务。",
      "审核优先流程的正确顺序是：提交 -> 生成方案/关键画面准备 -> 任务审核 -> 审核通过后继续生成正片。",
    ],
    relatedFeatureIds: ["task-launch", "task-review", "batch-dashboard"],
  },
  {
    id: "model-onboarding-and-defaults",
    title: "模型接入 -> 模型登记 -> 默认值设置",
    summary: "适合理解模型设置的稳定基线如何形成，以及新任务创建时会固定哪套默认值。",
    audienceNote: "最适合模型接入、调参与系统配置负责人。",
    stages: [
      {
        id: "provider",
        title: "新增接入方",
        description: "先登记连接目标、鉴权方式和密钥状态，让系统知道可以连到哪里。",
        notes: ["新增后默认是草稿状态，需要继续校验。"],
      },
      {
        id: "registry",
        title: "登记模型",
        description: "把可运行模型按四类生成能力登记到模型列表，并绑定对应接入方。",
        notes: ["当前只维护四类生成能力：文本、图片、视频、配音。", "不要再按草图/终稿去理解图片和视频模型。"],
      },
      {
        id: "defaults",
        title: "设置默认值",
        description: "在默认模型中设置全局兜底和新任务默认，形成稳定基线。",
        notes: ["新任务默认会覆盖全局兜底。", "任务创建时只会固定当下有效的默认值，不再在任务页做临时覆盖。"],
      },
    ],
    decisionPoints: [
      "只有通过校验的接入方和模型才会进入默认值可选池。",
      "默认值优先级固定：新任务默认 > 全局兜底；任务创建后会固定为本次任务设置。",
      "后续再调整默认值，不会回写已经创建的历史任务。",
    ],
    relatedFeatureIds: ["model-control-center"],
  },
  {
    id: "failure-triage",
    title: "失败任务 -> 看板定位 -> 素材排查 -> 继续处理",
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
        title: "再看素材与交付",
        description: "进入素材与交付确认当前已经产出了什么，哪些环节已经完成，哪些还缺失。",
        notes: ["先看成片视频是否存在，再看中间素材。"],
      },
      {
        id: "review-context",
        title: "必要时回到任务审核",
        description: "如果问题出在生成方案、关键画面或生成说明上，再回到任务审核工作台继续处理。",
        notes: ["不要在没确认问题类型时直接重做。", "审核通过但未继续生成的任务，也应从这里恢复主流程。"],
      },
    ],
    decisionPoints: [
      "先分清是生成失败、内容问题还是交付缺失，再决定去哪一页继续处理。",
      "失败任务优先看任务状态和素材缺口，不要直接猜原因。",
    ],
    relatedFeatureIds: ["batch-dashboard", "asset-center", "task-review"],
  },
  {
    id: "production-dispatch-sop",
    title: "生产调度 SOP",
    summary: "用于值班运营按排队中、生成中、待审核、卡住、失败、已完成几个生产分组管理当天生产节奏。",
    audienceNote: "适合日常排队、卡住任务、生成服务容量和交付节奏调度。",
    stages: [
      {
        id: "when",
        title: "何时操作",
        description: "每天开班、批量提交后、生成服务降级时，先进入生产看板确认各状态数量和卡住任务。",
        notes: ["看到卡住或失败任务增长时，先停下追加任务。", "排队任务明显高于生成中任务时，说明容量正在排队消化。"],
      },
      {
        id: "where",
        title: "点哪里",
        description: "点侧栏「生产看板」，先看顶部任务状态分组，再看「生成服务容量」和「卡住任务」。",
        notes: ["卡住任务先点「查看素材文件」。", "待审核任务点「进入任务审核」。"],
      },
      {
        id: "acceptance",
        title: "验收什么",
        description: "验收排队任务能进入生成中、生成中有新进展、待审核被处理、卡住任务不继续堆积、已完成任务可进入交付验收。",
        notes: ["最近刷新时间不能长期过期。", "生成服务与排队服务至少要能说明当前是否健康。"],
      },
      {
        id: "do-not",
        title: "不要做什么",
        description: "不要把看板当作重试按钮合集，不要在容量异常时重复提交同一视频内容，不要跳过素材排查直接恢复卡住任务。",
      },
    ],
    decisionPoints: [
      "卡住任务优先级高于排队任务；先排除卡住任务，再追加生产。",
      "生成服务降级时只做安全动作入口，不把前端判断当作底层队列状态。",
      "已完成只代表生产流程完成，交付是否可用仍要进素材与交付验收。",
    ],
    relatedFeatureIds: ["batch-dashboard", "asset-center", "task-review"],
  },
  {
    id: "failed-task-triage-sop",
    title: "失败任务排查 SOP",
    summary: "用于失败任务的问题分类、素材确认和恢复生成判断。",
    audienceNote: "适合排障值班、交付复核和恢复生成前确认。",
    stages: [
      {
        id: "when",
        title: "何时操作",
        description: "当生产看板出现失败任务，或任务卡在同一阶段并转为失败时，先做失败任务排查。",
        notes: ["先看问题类型，再看失败原因原文。", "接入方超时与文件缺失的处理顺序不同。"],
      },
      {
        id: "where",
        title: "点哪里",
        description: "在失败任务卡片点「查看失败素材」或「查看素材文件」，进入素材与交付核对成片视频和中间素材。",
        notes: ["如果方案或生成说明有明显问题，再从素材与交付回到任务审核。"],
      },
      {
        id: "acceptance",
        title: "验收什么",
        description: "验收当前已产出的素材、缺失文件类型、问题分类、最近进展和恢复后状态是否回到排队中或生成中。",
      },
      {
        id: "do-not",
        title: "不要做什么",
        description: "不要只凭失败文案猜原因，不要没看素材就恢复生成，不要把内容质量问题当成接入方故障。",
      },
    ],
    decisionPoints: [
      "接入方超时可在确认素材缺口后恢复生成。",
      "文件缺失先确认文件是否真实缺失，再决定恢复或重新生成。",
      "方案内容问题先回任务审核修正，不要直接恢复。",
    ],
    relatedFeatureIds: ["batch-dashboard", "asset-center", "task-review"],
  },
  {
    id: "partial-retry-sop",
    title: "局部重试选择 SOP",
    summary: "用于判断应该恢复失败任务、恢复卡住任务，还是回到审核环节重做方案。",
    audienceNote: "适合需要控制成本、避免整条流程重跑的运营场景。",
    stages: [
      {
        id: "when",
        title: "何时操作",
        description: "当任务失败、卡住，或素材与交付显示部分素材已经就绪但最终发布文件缺失时，再考虑局部重试。",
      },
      {
        id: "where",
        title: "点哪里",
        description: "先在生产看板点「查看素材文件」；确认可恢复后，再点「恢复生成」或「恢复卡住任务」。",
        notes: ["方案待审或已驳回时点「进入任务审核」，不要从看板硬恢复。"],
      },
      {
        id: "acceptance",
        title: "验收什么",
        description: "验收恢复后任务回到排队中或生成中、重试次数合理增长、最近进展恢复、已存在素材没有被误判为缺失。",
      },
      {
        id: "do-not",
        title: "不要做什么",
        description: "不要在没确认缺口前连续点恢复，不要为了省时间跳过任务审核，不要把局部重试当成内容返工工具。",
      },
    ],
    decisionPoints: [
      "保守顺序是：素材排查 -> 判断缺口 -> 再恢复。",
      "如果失败点在内容方案，局部重试通常不会解决质量问题。",
      "如果容量已经降级，先处理现有队列，不追加新的重试压力。",
    ],
    relatedFeatureIds: ["batch-dashboard", "asset-center", "task-review"],
  },
  {
    id: "delivery-acceptance-sop",
    title: "交付验收 SOP",
    summary: "用于已完成任务的最终视频、字幕、脚本和下载交付确认。",
    audienceNote: "适合交付前最后一轮检查。",
    stages: [
      {
        id: "when",
        title: "何时操作",
        description: "当生产看板显示任务已完成，或交付负责人需要确认可发给客户/渠道时执行。",
      },
      {
        id: "where",
        title: "点哪里",
        description: "在已完成任务点「查看素材文件」，进入素材与交付先看成片视频，再看字幕、脚本和中间素材。",
      },
      {
        id: "acceptance",
        title: "验收什么",
        description: "验收成片视频能预览或下载、字幕和音频对齐、时长偏差在可接受范围、关键画面与视频内容一致。",
      },
      {
        id: "do-not",
        title: "不要做什么",
        description: "不要只看到已完成就交付，不要先翻中间素材忽略成片视频，不要把下载成功当成内容验收通过。",
      },
    ],
    decisionPoints: [
      "成片视频优先级高于中间素材。",
      "时长、字幕、音频、主体一致性都通过后，才算交付可用。",
      "交付缺失回素材与交付排查，不在生产看板直接猜原因。",
    ],
    relatedFeatureIds: ["batch-dashboard", "asset-center"],
  },
  {
    id: "blueprint-review-sop",
    title: "任务审核 SOP",
    summary: "用于待审核任务的方案通过、驳回和继续生成正片判断。",
    audienceNote: "适合高质量流程的内容审核和继续生成。",
    stages: [
      {
        id: "when",
        title: "何时操作",
        description: "当生产看板出现待审核任务，或任务审核页显示方案待审、已通过待继续、已驳回待处理时执行。",
      },
      {
        id: "where",
        title: "点哪里",
        description: "在待审核卡片点「进入任务审核」，逐段查看生成方案、关键画面、画面说明、视频说明和终端尺寸。",
      },
      {
        id: "acceptance",
        title: "验收什么",
        description: "验收视频内容没有跑偏、视频分段连续、关键画面可用、生成说明不互相矛盾、通过后任务能继续生成正片。",
      },
      {
        id: "do-not",
        title: "不要做什么",
        description: "不要只看单张关键画面，不要把审核通过当成自动生成完成，不要在方案明显跑偏时直接继续生成。",
      },
    ],
    decisionPoints: [
      "内容方案可用才通过审核。",
      "方案已通过后仍要显式继续生成正片。",
      "方案驳回后先重做方案，再考虑重新生产视频。",
    ],
    relatedFeatureIds: ["task-review", "batch-dashboard", "project-library"],
  },
]
