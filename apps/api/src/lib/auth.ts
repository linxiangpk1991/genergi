import { createHmac, timingSafeEqual } from "node:crypto"
import type { Context, Next } from "hono"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"
import {
  getAuthConfigStatus,
  getSessionSecret,
  resolveLoginCredentials,
  findUserByUsername,
} from "./user-store.js"

const SESSION_COOKIE = "genergi_session"

function buildSignature(username: string, secret: string) {
  return createHmac("sha256", secret).update(username).digest("hex")
}

export function buildSessionValue(username: string, secret: string) {
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

function verifySessionSignature(username: string, signature: string, secret: string) {
  const expected = Buffer.from(buildSignature(username, secret), "utf8")
  const actual = Buffer.from(signature, "utf8")
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export async function getSessionUserFromCookieValue(value: string | undefined) {
  const secret = getSessionSecret()
  if (!secret) {
    return null
  }

  const session = parseSessionValue(value)
  if (!session || !verifySessionSignature(session.username, session.signature, secret)) {
    return null
  }

  const user = await findUserByUsername(session.username)
  if (!user || user.status !== "active") {
    return null
  }

  return user
}

export async function getSessionUser(c: Context) {
  return getSessionUserFromCookieValue(getCookie(c, SESSION_COOKIE))
}

export async function loginWithPassword(c: Context, username: string, password: string) {
  const result = await resolveLoginCredentials(username, password)
  if (!result.ok) {
    return { ok: false as const, reason: result.reason }
  }

  const secret = getSessionSecret()
  if (!secret) {
    return { ok: false as const, reason: "AUTH_NOT_CONFIGURED" as const }
  }

  setCookie(c, SESSION_COOKIE, buildSessionValue(result.user.username, secret), {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secure: false,
    maxAge: 60 * 60 * 12,
  })

  return { ok: true as const, user: result.user }
}

export function clearSession(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: "/" })
}

export function requireAuth() {
  return async (c: Context, next: Next) => {
    const user = await getSessionUser(c)
    if (!user) {
      return c.json({ message: "UNAUTHORIZED" }, 401)
    }

    c.set("operator", user.username)
    await next()
  }
}

export function getAuthStatus() {
  return getAuthConfigStatus()
}

export { resolveLoginCredentials }
