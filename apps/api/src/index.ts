import { serve } from "@hono/node-server"
import { zValidator } from "@hono/zod-validator"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { z } from "zod"
import { BRAND, CHANNELS, MODE_MODELS } from "@genergi/config"
import { createTaskInputSchema, readRuntimeStatus, updateRuntimeStatus } from "@genergi/shared"
import { clearSession, getAuthStatus, getSessionUser, loginWithPassword, requireAuth } from "./lib/auth.js"
import { enqueueTask } from "./lib/queue/enqueue.js"
import { createTask, getTaskDetail, listTasks } from "./lib/task-store.js"

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

app.get("/api/auth/session", (c) => {
  const username = getSessionUser(c)
  return c.json({
    authenticated: Boolean(username),
    operator: username ?? null,
    auth: getAuthStatus(),
  })
})

app.post("/api/auth/login", zValidator("json", loginSchema), (c) => {
  const payload = c.req.valid("json")
  const result = loginWithPassword(c, payload.username, payload.password)
  if (!result.ok) {
    return c.json({ message: result.reason }, result.reason === "AUTH_NOT_CONFIGURED" ? 503 : 401)
  }

  return c.json({
    authenticated: true,
    operator: result.username,
  })
})

app.post("/api/auth/logout", (c) => {
  clearSession(c)
  return c.json({ authenticated: false })
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

app.post("/api/tasks", zValidator("json", createTaskInputSchema), async (c) => {
  const payload = c.req.valid("json")
  const result = await createTask(payload)
  const queue = await enqueueTask(result.task.id)
  return c.json({ ...result, queue }, 201)
})

const port = Number(process.env.PORT || 8787)
serve({ fetch: app.fetch, port })
console.log(`GENERGI API listening on http://localhost:${port}`)
