import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import type {
  ProjectApprovedBlueprintRecord,
  ProjectRecord,
  TaskBlueprintRecord,
  TaskBlueprintReviewRecord,
} from "./index.js"

function resolveDataDir() {
  return process.env.GENERGI_DATA_DIR
    ? path.resolve(process.env.GENERGI_DATA_DIR)
    : path.resolve(process.cwd(), ".data")
}

function resolveFiles() {
  const dataDir = resolveDataDir()
  return {
    dataDir,
    projectsFile: path.join(dataDir, "projects.json"),
    tempProjectsFile: path.join(dataDir, "projects.tmp.json"),
    taskBlueprintsFile: path.join(dataDir, "task-blueprints.json"),
    tempTaskBlueprintsFile: path.join(dataDir, "task-blueprints.tmp.json"),
    taskBlueprintReviewsFile: path.join(dataDir, "task-blueprint-reviews.json"),
    tempTaskBlueprintReviewsFile: path.join(dataDir, "task-blueprint-reviews.tmp.json"),
    approvedBlueprintLibraryFile: path.join(dataDir, "project-approved-blueprints.json"),
    tempApprovedBlueprintLibraryFile: path.join(dataDir, "project-approved-blueprints.tmp.json"),
  }
}

async function commitTempFile(tempPath: string, finalPath: string, content: string) {
  await writeFile(tempPath, content, "utf8")
  try {
    await rename(tempPath, finalPath)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes("ENOENT")) {
      throw error
    }
    await writeFile(finalPath, content, "utf8")
  }
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const content = await readFile(filePath, "utf8")
    if (!content.trim()) {
      return fallback
    }
    return JSON.parse(content) as T
  } catch {
    return fallback
  }
}

async function writeJsonFile(filePath: string, tempPath: string, payload: unknown) {
  const { dataDir } = resolveFiles()
  await mkdir(dataDir, { recursive: true })
  await commitTempFile(tempPath, filePath, JSON.stringify(payload, null, 2))
}

export async function readProjects(): Promise<ProjectRecord[]> {
  const { projectsFile } = resolveFiles()
  return readJsonFile(projectsFile, [] as ProjectRecord[])
}

export async function writeProjects(records: ProjectRecord[]) {
  const { projectsFile, tempProjectsFile } = resolveFiles()
  await writeJsonFile(projectsFile, tempProjectsFile, records)
}

export async function readTaskBlueprintRecords(): Promise<Record<string, TaskBlueprintRecord[]>> {
  const { taskBlueprintsFile } = resolveFiles()
  return readJsonFile(taskBlueprintsFile, {} as Record<string, TaskBlueprintRecord[]>)
}

export async function writeTaskBlueprintRecords(records: Record<string, TaskBlueprintRecord[]>) {
  const { taskBlueprintsFile, tempTaskBlueprintsFile } = resolveFiles()
  await writeJsonFile(taskBlueprintsFile, tempTaskBlueprintsFile, records)
}

export async function readTaskBlueprintReviewRecords(): Promise<Record<string, TaskBlueprintReviewRecord[]>> {
  const { taskBlueprintReviewsFile } = resolveFiles()
  return readJsonFile(taskBlueprintReviewsFile, {} as Record<string, TaskBlueprintReviewRecord[]>)
}

export async function writeTaskBlueprintReviewRecords(records: Record<string, TaskBlueprintReviewRecord[]>) {
  const { taskBlueprintReviewsFile, tempTaskBlueprintReviewsFile } = resolveFiles()
  await writeJsonFile(taskBlueprintReviewsFile, tempTaskBlueprintReviewsFile, records)
}

export async function readProjectApprovedBlueprintLibrary(): Promise<Record<string, ProjectApprovedBlueprintRecord[]>> {
  const { approvedBlueprintLibraryFile } = resolveFiles()
  return readJsonFile(approvedBlueprintLibraryFile, {} as Record<string, ProjectApprovedBlueprintRecord[]>)
}

export async function writeProjectApprovedBlueprintLibrary(records: Record<string, ProjectApprovedBlueprintRecord[]>) {
  const { approvedBlueprintLibraryFile, tempApprovedBlueprintLibraryFile } = resolveFiles()
  await writeJsonFile(approvedBlueprintLibraryFile, tempApprovedBlueprintLibraryFile, records)
}
