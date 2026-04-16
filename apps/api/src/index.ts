import { serve } from "@hono/node-server"
import { zValidator } from "@hono/zod-validator"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { BRAND, CHANNELS, MODE_MODELS } from "@genergi/config"
import { createTaskInputSchema } from "@genergi/shared"
import { enqueueTask } from "./lib/queue/enqueue"
import { createTask, listTasks } from "./lib/task-store"

const app = new Hono()
app.use("*", cors())

app.get("/api/health", (c) => {
  return c.json({
    status: "ok",
    service: "genergi-api",
    version: "0.1.0",
  })
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

app.get("/api/tasks", async (c) => {
  const tasks = await listTasks()
  return c.json({ tasks })
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
