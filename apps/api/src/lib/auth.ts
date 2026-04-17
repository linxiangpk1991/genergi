import { createHmac, timingSafeEqual } from "node:crypto"
import type { Context, Next } from "hono"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"

const SESSION_COOKIE = "genergi_session"

type AuthConfig = {
  username: string
  password: string
  secret: string
}

function resolveAuthConfig(): AuthConfig | null {
  const username = process.env.GENERGI_ADMIN_USERNAME
  const password = process.env.GENERGI_ADMIN_PASSWORD
  const secret = process.env.GENERGI_SESSION_SECRET

  if (username && password && secret) {
    return { username, password, secret }
  }

  if (process.env.NODE_ENV !== "production") {
    return {
      username: "admin",
      password: "genergi-local-only",
      secret: "genergi-local-dev-secret",
    }
  }

  return null
}

function buildSignature(username: string, secret: string) {
  return createHmac("sha256", secret).update(username).digest("hex")
}

function buildSessionValue(username: string, secret: string) {
  return `${username}.${buildSignature(username, secret)}`
}

function parseSessionValue(value: string | undefined) {
  if (!value) {
    return null
  }

  const separator = value.indexOf(".")
  if (separator <= 0) {
    return null
  }

  return {
    username: value.slice(0, separator),
    signature: value.slice(separator + 1),
  }
}

export function getSessionUser(c: Context) {
  const config = resolveAuthConfig()
  if (!config) {
    return null
  }

  const session = parseSessionValue(getCookie(c, SESSION_COOKIE))
  if (!session) {
    return null
  }

  const expected = Buffer.from(buildSignature(session.username, config.secret), "utf8")
  const actual = Buffer.from(session.signature, "utf8")
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null
  }

  return session.username === config.username ? session.username : null
}

export function loginWithPassword(c: Context, username: string, password: string) {
  const config = resolveAuthConfig()
  if (!config) {
    return { ok: false as const, reason: "AUTH_NOT_CONFIGURED" }
  }

  if (username !== config.username || password !== config.password) {
    return { ok: false as const, reason: "INVALID_CREDENTIALS" }
  }

  setCookie(c, SESSION_COOKIE, buildSessionValue(username, config.secret), {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secure: false,
    maxAge: 60 * 60 * 12,
  })

  return { ok: true as const, username }
}

export function clearSession(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: "/" })
}

export function requireAuth() {
  return async (c: Context, next: Next) => {
    const username = getSessionUser(c)
    if (!username) {
      return c.json({ message: "UNAUTHORIZED" }, 401)
    }

    c.set("operator", username)
    await next()
  }
}

export function getAuthStatus() {
  const config = resolveAuthConfig()
  return {
    configured: Boolean(config),
    localDevFallback: !process.env.GENERGI_ADMIN_USERNAME && process.env.NODE_ENV !== "production",
  }
}
