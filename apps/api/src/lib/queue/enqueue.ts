import { Queue } from "bullmq"
import { Redis } from "ioredis"
import { TASK_QUEUE_NAME } from "@genergi/shared"

const QUEUE_CONNECT_TIMEOUT_MS = 1500

export class QueueUnavailableError extends Error {
  readonly code = "TASK_QUEUE_UNAVAILABLE"

  constructor(message: string) {
    super(message)
    this.name = "QueueUnavailableError"
  }
}

function getRedisUrl() {
  const redisUrl = process.env.REDIS_URL?.trim()
  if (!redisUrl) {
    throw new QueueUnavailableError("REDIS_URL missing")
  }

  return redisUrl
}

function createQueueConnection() {
  return new Redis(getRedisUrl(), {
    connectTimeout: QUEUE_CONNECT_TIMEOUT_MS,
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: null,
    retryStrategy: () => null,
  })
}

function toQueueUnavailableError(error: unknown) {
  if (error instanceof QueueUnavailableError) {
    return error
  }

  const message = error instanceof Error ? error.message : String(error)
  return new QueueUnavailableError(message)
}

async function closeQueueResources(queue: Queue, connection: Redis) {
  await Promise.allSettled([
    queue.close(),
    connection.quit().catch(() => {
      connection.disconnect()
      return "disconnected"
    }),
  ])
}

async function withQueue<T>(run: (queue: Queue) => Promise<T>) {
  const connection = createQueueConnection()
  const queue = new Queue(TASK_QUEUE_NAME, { connection })

  try {
    await queue.waitUntilReady()
    return await run(queue)
  } catch (error) {
    throw toQueueUnavailableError(error)
  } finally {
    await closeQueueResources(queue, connection)
  }
}

export async function assertQueueAvailable() {
  await withQueue(async () => undefined)
}

export async function enqueueTask(
  taskId: string,
  options: {
    reason?: string
    continueExecution?: boolean
    blueprintVersion?: number
    stage?: string
    resumeFrom?: string
  } = {},
) {
  return withQueue(async (queue) => {
    const reason = options.reason ?? options.resumeFrom ?? "initial_create"
    const jobId = `${taskId}:${reason}:${Date.now()}`
    await queue.add("process-task", {
      taskId,
      reason,
      continueExecution: options.continueExecution ?? false,
      blueprintVersion: options.blueprintVersion ?? null,
      stage: options.stage ?? null,
      resumeFrom: options.resumeFrom ?? null,
      enqueuedAt: new Date().toISOString(),
    }, {
      jobId,
    })
    return {
      queued: true as const,
      jobId,
      reason,
      continueExecution: options.continueExecution ?? false,
      blueprintVersion: options.blueprintVersion ?? null,
      stage: options.stage ?? null,
      resumeFrom: options.resumeFrom ?? null,
    }
  })
}
