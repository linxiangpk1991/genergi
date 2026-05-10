import process from "node:process"

const baseUrl = (process.env.GENERGI_SMOKE_BASE_URL ?? "https://ai.genergius.com").replace(/\/+$/, "")
const username = process.env.GENERGI_SMOKE_USERNAME ?? ""
const password = process.env.GENERGI_SMOKE_PASSWORD ?? ""
const expectedRelease = process.env.GENERGI_EXPECTED_RELEASE ?? ""
const allowAuthSkip = process.env.GENERGI_SMOKE_ALLOW_AUTH_SKIP === "1"

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: "manual",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers ?? {}),
    },
  })
  return response
}

async function readJson(response, label) {
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${label} did not return JSON: ${text.slice(0, 200)}`)
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

async function checkPublicSurface() {
  const healthResponse = await request("/api/health")
  assert(healthResponse.ok, `health failed: ${healthResponse.status}`)
  const health = await readJson(healthResponse, "health")
  assert(health.status === "ok", `health status is ${health.status}`)
  if (expectedRelease) {
    assert(
      health.release?.id === expectedRelease,
      `release mismatch: expected ${expectedRelease}, got ${health.release?.id ?? "missing"}`,
    )
  }

  const homeResponse = await request("/")
  assert(homeResponse.ok, `home failed: ${homeResponse.status}`)
  const homeHtml = await homeResponse.text()
  assert(homeHtml.includes("GENERGI 自动化视频平台"), "home title missing")
  assert(/\/assets\/index-[^"]+\.js/.test(homeHtml), "home js asset missing")
  assert(/\/assets\/index-[^"]+\.css/.test(homeHtml), "home css asset missing")
  assert(homeHtml.includes("/favicon.ico"), "favicon link missing")

  const faviconResponse = await request("/favicon.ico", { method: "HEAD" })
  assert(faviconResponse.ok, `favicon failed: ${faviconResponse.status}`)

  const routingPageResponse = await request("/model-control-center/routing")
  assert(routingPageResponse.ok, `routing page failed: ${routingPageResponse.status}`)
  const routingHtml = await routingPageResponse.text()
  assert(routingHtml.includes("GENERGI 自动化视频平台"), "routing page did not serve app shell")

  return {
    release: health.release ?? null,
    assets: {
      js: homeHtml.match(/\/assets\/index-[^"]+\.js/)?.[0] ?? null,
      css: homeHtml.match(/\/assets\/index-[^"]+\.css/)?.[0] ?? null,
    },
  }
}

async function checkAuthenticatedSurface() {
  if (!username || !password) {
    if (!allowAuthSkip) {
      throw new Error("Authenticated smoke requires GENERGI_SMOKE_USERNAME and GENERGI_SMOKE_PASSWORD. Set GENERGI_SMOKE_ALLOW_AUTH_SKIP=1 only for public-only checks.")
    }
    return {
      skipped: true,
      reason: "Set GENERGI_SMOKE_USERNAME and GENERGI_SMOKE_PASSWORD to run authenticated checks.",
    }
  }

  const loginResponse = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  })
  assert(loginResponse.ok, `login failed: ${loginResponse.status}`)
  const cookie = loginResponse.headers.get("set-cookie")?.split(";")[0] ?? ""
  assert(cookie, "login did not set session cookie")

  const routingResponse = await request("/api/model-control/routing", {
    headers: { Cookie: cookie },
  })
  assert(routingResponse.ok, `routing API failed: ${routingResponse.status}`)
  const routing = await readJson(routingResponse, "routing API")
  assert(Boolean(routing.policies), "routing API missing policies")
  assert(
    Array.isArray(routing.strategyOptions) && routing.strategyOptions.length >= 4,
    "routing API missing strategy options",
  )

  const routePreviewResponse = await request("/api/model-control/route-preview?modeId=high_quality", {
    headers: { Cookie: cookie },
  })
  assert(routePreviewResponse.ok, `route preview API failed: ${routePreviewResponse.status}`)
  const routePreview = await readJson(routePreviewResponse, "route preview API")
  assert(Array.isArray(routePreview.slots) && routePreview.slots.length === 4, "route preview API missing four slots")

  const qualitySummaryResponse = await request("/api/model-control/quality-summary", {
    headers: { Cookie: cookie },
  })
  assert(qualitySummaryResponse.ok, `quality summary API failed: ${qualitySummaryResponse.status}`)
  const qualitySummary = await readJson(qualitySummaryResponse, "quality summary API")
  assert(Array.isArray(qualitySummary.items), "quality summary API missing items")

  const tasksResponse = await request("/api/tasks", {
    headers: { Cookie: cookie },
  })
  assert(tasksResponse.ok, `tasks API failed: ${tasksResponse.status}`)
  const tasks = await readJson(tasksResponse, "tasks API")
  assert(Array.isArray(tasks.tasks), "tasks API missing task list")

  return {
    skipped: false,
    routingSlots: Object.keys(routing.resolved?.high_quality ?? {}),
    routePreviewSlots: routePreview.slots.length,
    qualitySummaryItems: qualitySummary.items.length,
    taskCount: tasks.tasks.length,
  }
}

const publicSurface = await checkPublicSurface()
const authenticatedSurface = await checkAuthenticatedSurface()

console.log(JSON.stringify({
  ok: true,
  baseUrl,
  publicSurface,
  authenticatedSurface,
}, null, 2))
