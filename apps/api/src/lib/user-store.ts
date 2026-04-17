import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto"
import type { PublicUser, StoredUser, UserStatus } from "@genergi/shared"
import { readUserRecords, replaceUserRecords } from "@genergi/shared"

const PASSWORD_ALGORITHM = "pbkdf2-sha512"
const PASSWORD_ITERATIONS = 210_000
const PASSWORD_KEY_LENGTH = 64

type AuthConfig = {
  secret: string
  fallbackUser: {
    username: string
    password: string
  } | null
}

export type LoginResult =
  | { ok: true; user: PublicUser }
  | {
      ok: false
      reason: "AUTH_NOT_CONFIGURED" | "INVALID_CREDENTIALS" | "USER_DISABLED" | "USER_NOT_FOUND"
    }

function now() {
  return new Date().toISOString()
}

function normalizeUsername(username: string) {
  const value = username.trim()
  if (!value) {
    throw new Error("USERNAME_REQUIRED")
  }
  return value
}

function normalizeDisplayName(displayName: string | undefined, username: string) {
  const value = displayName?.trim()
  return value && value.length ? value : username
}

function resolveAuthConfig(): AuthConfig | null {
  const secret = process.env.GENERGI_SESSION_SECRET
  const hasEnvFallback = Boolean(process.env.GENERGI_ADMIN_USERNAME && process.env.GENERGI_ADMIN_PASSWORD)

  if (secret && hasEnvFallback) {
    return {
      secret,
      fallbackUser: {
        username: normalizeUsername(process.env.GENERGI_ADMIN_USERNAME ?? ""),
        password: process.env.GENERGI_ADMIN_PASSWORD ?? "",
      },
    }
  }

  if (secret) {
    return {
      secret,
      fallbackUser: null,
    }
  }

  if (process.env.NODE_ENV !== "production") {
    return {
      secret: "genergi-local-dev-secret",
      fallbackUser: {
        username: "admin",
        password: "genergi-local-only",
      },
    }
  }

  return null
}

function buildPasswordHash(password: string) {
  const salt = randomBytes(16).toString("hex")
  const digest = pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, PASSWORD_KEY_LENGTH, "sha512").toString("hex")
  return `${PASSWORD_ALGORITHM}$${PASSWORD_ITERATIONS}$${salt}$${digest}`
}

function verifyPasswordHash(password: string, passwordHash: string) {
  const [algorithm, iterationsRaw, salt, digest] = passwordHash.split("$")
  if (algorithm !== PASSWORD_ALGORITHM || !iterationsRaw || !salt || !digest) {
    return false
  }

  const iterations = Number(iterationsRaw)
  if (!Number.isFinite(iterations) || iterations <= 0) {
    return false
  }

  const actual = pbkdf2Sync(password, salt, iterations, Buffer.from(digest, "hex").length, "sha512")
  const expected = Buffer.from(digest, "hex")
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function toPublicUser(user: StoredUser, source: "file" | "env"): PublicUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    status: user.status,
    source,
  }
}

function createStoredUserId(username: string) {
  return `user_${username}_${Date.now()}`
}

export function getEnvFallbackUser(): PublicUser | null {
  const config = resolveAuthConfig()
  const fallbackUser = config?.fallbackUser
  if (!fallbackUser) {
    return null
  }

  return {
    id: `env_${fallbackUser.username}`,
    username: fallbackUser.username,
    displayName: fallbackUser.username,
    status: "active",
    source: "env",
  }
}

export async function listStoredUsers(): Promise<StoredUser[]> {
  const users = await readUserRecords()
  return users.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function listUsers(): Promise<PublicUser[]> {
  const storedUsers = await listStoredUsers()
  const publicUsers = storedUsers.map((user) => toPublicUser(user, "file"))
  const envUser = getEnvFallbackUser()

  if (envUser && !publicUsers.some((user) => user.username === envUser.username)) {
    publicUsers.unshift(envUser)
  }

  return publicUsers
}

export async function findStoredUserById(userId: string) {
  const users = await listStoredUsers()
  return users.find((user) => user.id === userId) ?? null
}

export async function findStoredUserByUsername(username: string) {
  const normalizedUsername = normalizeUsername(username)
  const users = await listStoredUsers()
  return users.find((user) => user.username === normalizedUsername) ?? null
}

export async function findUserByUsername(username: string): Promise<PublicUser | null> {
  const storedUser = await findStoredUserByUsername(username)
  if (storedUser) {
    return toPublicUser(storedUser, "file")
  }

  const envUser = getEnvFallbackUser()
  if (envUser && envUser.username === normalizeUsername(username)) {
    return envUser
  }

  return null
}

function isUsernameTaken(users: StoredUser[], username: string, excludeId?: string) {
  const normalizedUsername = normalizeUsername(username)
  if (users.some((user) => user.username === normalizedUsername && user.id !== excludeId)) {
    return true
  }

  const envUser = getEnvFallbackUser()
  return Boolean(envUser && envUser.username === normalizedUsername && excludeId !== envUser.id)
}

export async function createStoredUser(input: {
  username: string
  password: string
  displayName?: string
  status?: UserStatus
}) {
  const users = await listStoredUsers()
  const username = normalizeUsername(input.username)

  if (isUsernameTaken(users, username)) {
    throw new Error("USERNAME_TAKEN")
  }

  const timestamp = now()
  const user: StoredUser = {
    id: createStoredUserId(username),
    username,
    displayName: normalizeDisplayName(input.displayName, username),
    passwordHash: buildPasswordHash(input.password),
    status: input.status ?? "active",
    createdAt: timestamp,
    updatedAt: timestamp,
    lastLoginAt: null,
  }

  users.unshift(user)
  await replaceUserRecords(users)
  return user
}

async function updateStoredUserRecord(
  userId: string,
  updater: (user: StoredUser, users: StoredUser[]) => StoredUser,
) {
  const users = await listStoredUsers()
  const index = users.findIndex((user) => user.id === userId)
  if (index < 0) {
    return null
  }

  const nextUser = updater(users[index], users)
  users[index] = nextUser
  await replaceUserRecords(users)
  return nextUser
}

export async function updateStoredUser(
  userId: string,
  patch: {
    username?: string
    displayName?: string
    status?: UserStatus
  },
) {
  return updateStoredUserRecord(userId, (user, users) => {
    const nextUsername = patch.username ? normalizeUsername(patch.username) : user.username
    if (isUsernameTaken(users, nextUsername, user.id)) {
      throw new Error("USERNAME_TAKEN")
    }

    return {
      ...user,
      username: nextUsername,
      displayName: patch.displayName ? normalizeDisplayName(patch.displayName, nextUsername) : user.displayName,
      status: patch.status ?? user.status,
      updatedAt: now(),
    }
  })
}

export async function updateStoredUserPassword(userId: string, password: string) {
  return updateStoredUserRecord(userId, (user) => {
    return {
      ...user,
      passwordHash: buildPasswordHash(password),
      updatedAt: now(),
    }
  })
}

export async function setStoredUserEnabled(userId: string, enabled: boolean) {
  return updateStoredUser(userId, {
    status: enabled ? "active" : "disabled",
  })
}

export async function touchStoredUserLogin(userId: string) {
  return updateStoredUserRecord(userId, (user) => {
    return {
      ...user,
      lastLoginAt: now(),
      updatedAt: now(),
    }
  })
}

export async function verifyStoredUserPassword(username: string, password: string) {
  const user = await findStoredUserByUsername(username)
  if (!user) {
    return null
  }

  if (user.status !== "active") {
    return { reason: "USER_DISABLED" as const, user: toPublicUser(user, "file") }
  }

  if (!verifyPasswordHash(password, user.passwordHash)) {
    return null
  }

  await touchStoredUserLogin(user.id)
  return { user: toPublicUser(user, "file") }
}

export async function resolveLoginCredentials(username: string, password: string): Promise<LoginResult> {
  const config = resolveAuthConfig()
  if (!config) {
    return { ok: false, reason: "AUTH_NOT_CONFIGURED" }
  }

  const normalizedUsername = normalizeUsername(username)
  const storedUser = await findStoredUserByUsername(normalizedUsername)
  if (storedUser) {
    if (storedUser.status !== "active") {
      return { ok: false, reason: "USER_DISABLED" }
    }

    if (!verifyPasswordHash(password, storedUser.passwordHash)) {
      return { ok: false, reason: "INVALID_CREDENTIALS" }
    }

    await touchStoredUserLogin(storedUser.id)
    return { ok: true, user: toPublicUser(storedUser, "file") }
  }

  const fallbackUser = config.fallbackUser
  if (fallbackUser && fallbackUser.username === normalizedUsername && fallbackUser.password === password) {
    return {
      ok: true,
      user: {
        id: `env_${fallbackUser.username}`,
        username: fallbackUser.username,
        displayName: fallbackUser.username,
        status: "active",
        source: "env",
      },
    }
  }

  return { ok: false, reason: "INVALID_CREDENTIALS" }
}

export function getAuthConfigStatus() {
  const config = resolveAuthConfig()
  return {
    configured: Boolean(config),
    localDevFallback: !process.env.GENERGI_ADMIN_USERNAME && process.env.NODE_ENV !== "production",
  }
}

export function getSessionSecret() {
  return resolveAuthConfig()?.secret ?? null
}
