import { Queue, Worker } from "bullmq"
import Redis from "ioredis"
import { TASK_QUEUE_NAME } from "@genergi/shared"

const redisUrl = process.env.REDIS_URL

if (!redisUrl) {
  console.log("GENERGI worker started without REDIS_URL. Queue processing is disabled in local bootstrap mode.")
  process.exit(0)
}

const connection = new Redis(redisUrl, { maxRetriesPerRequest: null })
const queue = new Queue(TASK_QUEUE_NAME, { connection })

const worker = new Worker(
  TASK_QUEUE_NAME,
  async (job: { id?: string; data: { taskId: string } }) => {
    console.log(`Processing task ${job.data.taskId}`)
    return { ok: true, taskId: job.data.taskId }
  },
  { connection },
)

worker.on("completed", (job) => {
  console.log(`Job ${job.id} completed`)
})

worker.on("failed", (job, error) => {
  console.error(`Job ${job?.id} failed`, error)
})

console.log(`GENERGI worker listening on queue ${TASK_QUEUE_NAME}`)
void queue.waitUntilReady()
