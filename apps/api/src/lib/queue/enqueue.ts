import { Queue } from "bullmq"
import Redis from "ioredis"
import { TASK_QUEUE_NAME } from "@genergi/shared"

export async function enqueueTask(taskId: string) {
  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) {
    return { queued: false, reason: "REDIS_URL missing" }
  }

  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null })
  const queue = new Queue(TASK_QUEUE_NAME, { connection })
  await queue.add("process-task", { taskId })
  await queue.close()
  await connection.quit()

  return { queued: true }
}
