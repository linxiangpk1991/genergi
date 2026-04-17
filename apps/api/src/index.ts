import fs from "node:fs/promises"
import { serve } from "@hono/node-server"
import { zValidator } from "@hono/zod-validator"
import { Hono, type Context } from "hono"
import { cors } from "hono/cors"
import { z } from "zod"
import {
  BRAND,
  CHANNELS,
  GENERATION_PREFERENCES,
  MODE_MODELS,
  VIDEO_DURATION_PRESETS,
  resolveVideoModelCapability,
} from "@genergi/config"
import {
  createTaskInputSchema,
  createUserInputSchema,
  readRuntimeStatus,
  resetUserPasswordInputSchema,
  updateRuntimeStatus,
  updateUserInputSchema,
} from "@genergi/shared"
import { clearSession, getAuthStatus, getSessionUser, loginWithPassword, requireAuth } from "./lib/auth.js"
import { enqueueTask } from "./lib/queue/enqueue.js"
import { createTask, getTaskAsset, getTaskAssets, getTaskDetail, listTasks } from "./lib/task-store.js"
import {
  createStoredUser,
  getEnvFallbackUser,
  findStoredUserById,
  listUsers,
  toPublicUser,
  updateStoredUser,
  updateStoredUserPassword,
} from "./lib/user-store.js"

const app = new Hono()
app.use("*", cors())
const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})

type TaskPlanningSnapshot = {
  generationPreference: "user_locked" | "system_enhanced"
  generationPreferenceLabel: string
  generationRoute: "single_shot" | "multi_scene"
  generationRouteLabel: string
  targetDurationSec: number
  sceneCount: number
  planningSummary: string
  planningKeywords: string[]
  planningSourceLabel: string
  routeReason: string
}

const taskPlanningState = new Map<string, TaskPlanningSnapshot>()

function getSceneCountHint(targetDurationSec: number) {
  if (targetDurationSec <= 15) {
    return 3
  }

  if (targetDurationSec <= 30) {
    return 5
  }

  if (targetDurationSec <= 45) {
    return 7
  }

  return 8
}

function getGenerationPreferenceMeta(generationPreference: "user_locked" | "system_enhanced") {
  return (
    GENERATION_PREFERENCES.find((item) => item.id === generationPreference) ?? GENERATION_PREFERENCES[0]
  )
}

function getGenerationRouteLabel(route: "single_shot" | "multi_scene") {
  return route === "single_shot" ? "单段直出" : "多分镜编排"
}

function buildPlanningSummary(
  generationRoute: "single_shot" | "multi_scene",
  generationPreference: "user_locked" | "system_enhanced",
  routeReason: string,
) {
  const routeSummary =
    generationRoute === "single_shot"
      ? "当前按单段直出预判，优先保证内容连贯性。"
      : "当前按多分镜编排预判，优先保证节奏展开与镜头切换。"

  const preferenceMeta = getGenerationPreferenceMeta(generationPreference)

  return `${routeSummary} · ${preferenceMeta.description} · ${routeReason}`
}

function buildPlanningSnapshot(
  targetDurationSec: number,
  sceneCount: number,
  generationPreference: "user_locked" | "system_enhanced",
  generationRoute: "single_shot" | "multi_scene",
  routeReason: string,
  sourceLabel = "任务持久化",
): TaskPlanningSnapshot {
  const generationPreferenceMeta = getGenerationPreferenceMeta(generationPreference)
  return {
    generationPreference,
    generationPreferenceLabel: generationPreferenceMeta.label,
    generationRoute,
    generationRouteLabel: getGenerationRouteLabel(generationRoute),
    targetDurationSec,
    sceneCount,
    planningSummary: buildPlanningSummary(generationRoute, generationPreference, routeReason),
    planningKeywords: generationPreferenceMeta.keywords,
    planningSourceLabel: sourceLabel,
    routeReason,
  }
}

function enrichSummary(task: Awaited<ReturnType<typeof listTasks>>[number]) {
  const cached = taskPlanningState.get(task.id)
  const planning =
    cached ??
    buildPlanningSnapshot(
      task.targetDurationSec,
      getSceneCountHint(task.targetDurationSec),
      task.generationMode,
      task.generationRoute,
      task.routeReason,
    )
  return { ...task, planning }
}

function enrichDetail(detail: NonNullable<Awaited<ReturnType<typeof getTaskDetail>>>) {
  const cached = taskPlanningState.get(detail.taskId)
  const planning =
    cached ??
    buildPlanningSnapshot(
      detail.taskRunConfig.targetDurationSec,
      detail.scenes.length,
      detail.taskRunConfig.generationMode,
      detail.taskRunConfig.generationRoute,
      detail.taskRunConfig.routeReason,
    )
  return { ...detail, planning }
}

app.get("/api/health", (c) => {
  return c.json({
    status: "ok",
    service: "genergi-api",
    version: "0.1.0",
  })
})

app.get("/api/system/status", async (c) => {
  const runtime = await readRuntimeStatus()
  const next = await updateRuntimeStatus((current) => ({
    ...current,
    api: {
      name: "api",
      status: "healthy",
      updatedAt: new Date().toISOString(),
      message: "API online",
    },
  }))

  return c.json({ runtime: next })
})

app.get("/api/auth/session", async (c) => {
  const user = await getSessionUser(c)
  return c.json({
    authenticated: Boolean(user),
    operator: user?.username ?? null,
    user: user ?? null,
    auth: getAuthStatus(),
  })
})

app.post("/api/auth/login", zValidator("json", loginSchema), async (c) => {
  const payload = c.req.valid("json")
  const result = await loginWithPassword(c, payload.username, payload.password)
  if (!result.ok) {
    return c.json({ message: result.reason }, result.reason === "AUTH_NOT_CONFIGURED" ? 503 : 401)
  }

  return c.json({
    authenticated: true,
    operator: result.user.username,
    user: result.user,
  })
})

app.post("/api/auth/logout", (c) => {
  clearSession(c)
  return c.json({ authenticated: false })
})

app.use("/api/users", requireAuth())

app.get("/api/users", async (c) => {
  const users = await listUsers()
  return c.json({ users })
})

app.post("/api/users", zValidator("json", createUserInputSchema), async (c) => {
  const payload = c.req.valid("json")
  try {
    const user = await createStoredUser(payload)
    return c.json({ user: toPublicUser(user, "file") }, 201)
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR"
    if (message === "USERNAME_TAKEN") {
      return c.json({ message }, 409)
    }

    throw error
  }
})

app.patch("/api/users/:userId", zValidator("json", updateUserInputSchema), async (c) => {
  const payload = c.req.valid("json")
  const userId = c.req.param("userId")
  const currentUser = await findStoredUserById(userId)
  if (!currentUser) {
    const envUser = getEnvFallbackUser()
    if (envUser?.id === userId) {
      return c.json({ message: "USER_READ_ONLY" }, 409)
    }

    return c.json({ message: "USER_NOT_FOUND" }, 404)
  }

  try {
    const user = await updateStoredUser(userId, payload)
    if (!user) {
      return c.json({ message: "USER_NOT_FOUND" }, 404)
    }

    return c.json({ user: toPublicUser(user, "file") })
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR"
    if (message === "USERNAME_TAKEN") {
      return c.json({ message }, 409)
    }

    throw error
  }
})

app.post("/api/users/:userId/reset-password", zValidator("json", resetUserPasswordInputSchema), async (c) => {
  const userId = c.req.param("userId")
  const payload = c.req.valid("json")
  const user = await updateStoredUserPassword(userId, payload.password)
  if (!user) {
    const envUser = getEnvFallbackUser()
    if (envUser?.id === userId) {
      return c.json({ message: "USER_READ_ONLY" }, 409)
    }

    return c.json({ message: "USER_NOT_FOUND" }, 404)
  }

  return c.json({ user: toPublicUser(user, "file") })
})

app.get("/api/bootstrap", (c) => {
  return c.json({
    brand: BRAND,
    durationOptions: VIDEO_DURATION_PRESETS,
    channels: Object.entries(CHANNELS).map(([id, value]) => ({ id, ...value })),
    generationPreferences: GENERATION_PREFERENCES.map(({ id, label, description }) => ({
      id,
      label,
      description,
    })),
    modes: Object.entries(MODE_MODELS).map(([id, mode]) => ({
      id,
      label: id === "mass_production" ? "量产模式" : "高质量模式",
      description:
        id === "mass_production"
          ? "侧重效率、批量生产与成本控制"
          : "侧重品牌表现、审阅质量与最终画面效果",
      budgetLimitCny: mode.budgetLimitCny,
      maxSingleShotSec: resolveVideoModelCapability(mode.videoDraftModel.id).maxSingleShotSec,
    })),
  })
})

app.use("/api/tasks", requireAuth())

app.get("/api/tasks", async (c) => {
  const tasks = await listTasks()
  return c.json({ tasks: tasks.map(enrichSummary) })
})

app.get("/api/tasks/:taskId", async (c) => {
  const detail = await getTaskDetail(c.req.param("taskId"))
  if (!detail) {
    return c.json({ message: "TASK_NOT_FOUND" }, 404)
  }

  return c.json({ detail: enrichDetail(detail) })
})

app.get("/api/tasks/:taskId/assets", async (c) => {
  const assets = await getTaskAssets(c.req.param("taskId"))
  return c.json({ assets })
})

async function sendAssetFile(
  c: Context,
  asset: Awaited<ReturnType<typeof getTaskAsset>>,
  disposition: "attachment" | "inline",
) {
  if (!asset) {
    return c.json({ message: "ASSET_NOT_FOUND" }, 404)
  }

  if (!asset.exists) {
    return c.json({ message: "ASSET_FILE_NOT_FOUND" }, 404)
  }

  if (asset.isDirectory) {
    return c.json({ message: "ASSET_IS_DIRECTORY", path: asset.displayPath }, 409)
  }

  try {
    const file = await fs.readFile(asset.path)
    c.header("Content-Type", asset.mimeType)
    c.header("Content-Disposition", `${disposition}; filename="${asset.downloadFileName.replace(/"/g, '\\"')}"`)
    if (asset.sizeBytes != null) {
      c.header("Content-Length", String(asset.sizeBytes))
    }
    return c.body(file)
  } catch {
    return c.json({ message: "ASSET_FILE_NOT_FOUND" }, 404)
  }
}

app.get("/api/tasks/:taskId/assets/:assetId/download", async (c) => {
  const asset = await getTaskAsset(c.req.param("taskId"), c.req.param("assetId"))
  return sendAssetFile(c, asset, "attachment")
})

app.get("/api/tasks/:taskId/assets/:assetId/preview", async (c) => {
  const asset = await getTaskAsset(c.req.param("taskId"), c.req.param("assetId"))
  if (asset && !asset.previewable) {
    return c.json({ message: "ASSET_PREVIEW_UNAVAILABLE", previewKind: asset.previewKind }, 409)
  }

  return sendAssetFile(c, asset, "inline")
})

app.post("/api/tasks", async (c) => {
  const rawBody = await c.req.json().catch(() => null)
  const normalizedBody =
    rawBody && typeof rawBody === "object"
      ? {
          ...rawBody,
          generationMode:
            (rawBody as Record<string, unknown>).generationMode ??
            (rawBody as Record<string, unknown>).generationPreference,
        }
      : rawBody
  const parsed = createTaskInputSchema.safeParse(normalizedBody)
  if (!parsed.success) {
    return c.json({ message: "INVALID_TASK_PAYLOAD" }, 400)
  }

  const result = await createTask(parsed.data)
  const queue = await enqueueTask(result.task.id)
  const createdDetail = await getTaskDetail(result.task.id)
  const planning = buildPlanningSnapshot(
    result.task.targetDurationSec,
    createdDetail?.scenes.length ?? getSceneCountHint(result.task.targetDurationSec),
    result.task.generationMode,
    result.task.generationRoute,
    result.task.routeReason,
    "任务持久化",
  )
  taskPlanningState.set(result.task.id, planning)

  return c.json({ ...result, task: { ...result.task, planning }, queue }, 201)
})

const port = Number(process.env.PORT || 8787)
serve({ fetch: app.fetch, port })
console.log(`GENERGI API listening on http://localhost:${port}`)
