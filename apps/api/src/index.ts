import fs from "node:fs/promises"
import { serve } from "@hono/node-server"
import { zValidator } from "@hono/zod-validator"
import { Hono, type Context } from "hono"
import { cors } from "hono/cors"
import { z } from "zod"
import { BRAND, CHANNELS, MODE_MODELS } from "@genergi/config"
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
    channels: Object.entries(CHANNELS).map(([id, value]) => ({ id, ...value })),
    modes: Object.entries(MODE_MODELS).map(([id, mode]) => ({
      id,
      label: id === "mass_production" ? "量产模式" : "高质量模式",
      description:
        id === "mass_production"
          ? "侧重效率、批量生产与成本控制"
          : "侧重品牌表现、审阅质量与最终画面效果",
      budgetLimitCny: mode.budgetLimitCny,
    })),
  })
})

app.use("/api/tasks", requireAuth())

app.get("/api/tasks", async (c) => {
  const tasks = await listTasks()
  return c.json({ tasks })
})

app.get("/api/tasks/:taskId", async (c) => {
  const detail = await getTaskDetail(c.req.param("taskId"))
  if (!detail) {
    return c.json({ message: "TASK_NOT_FOUND" }, 404)
  }

  return c.json({ detail })
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

app.post("/api/tasks", zValidator("json", createTaskInputSchema), async (c) => {
  const payload = c.req.valid("json")
  const result = await createTask(payload)
  const queue = await enqueueTask(result.task.id)
  return c.json({ ...result, queue }, 201)
})

const port = Number(process.env.PORT || 8787)
serve({ fetch: app.fetch, port })
console.log(`GENERGI API listening on http://localhost:${port}`)
