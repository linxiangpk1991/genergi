import { randomUUID } from "node:crypto"
import {
  readProjectApprovedBlueprintLibrary,
  readProjects,
  writeProjects,
  type ProjectApprovedBlueprintRecord,
  type ProjectRecord,
} from "@genergi/shared"

function now() {
  return new Date().toISOString()
}

function buildSeedProject(): ProjectRecord {
  const timestamp = now()
  return {
    id: "project_default",
    name: "默认项目",
    description: "用于承载当前默认内容生产任务。",
    brandDirection: "英语短视频内容生产",
    defaultChannelIds: ["tiktok", "reels", "shorts"],
    reusableStyleConstraints: ["保持主体与产品表达一致", "优先短视频传播节奏"],
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export async function listProjects(): Promise<ProjectRecord[]> {
  const projects = await readProjects()
  if (projects.length > 0) {
    return projects
  }

  const seed = buildSeedProject()
  await writeProjects([seed])
  return [seed]
}

export async function getProjectById(projectId: string): Promise<ProjectRecord | null> {
  const projects = await listProjects()
  return projects.find((project) => project.id === projectId) ?? null
}

export async function createProject(input: {
  name: string
  description?: string
  brandDirection?: string
  defaultChannelIds?: string[]
  reusableStyleConstraints?: string[]
}): Promise<ProjectRecord> {
  const projects = await listProjects()
  const timestamp = now()
  const project: ProjectRecord = {
    id: `project_${randomUUID()}`,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    brandDirection: input.brandDirection?.trim() || null,
    defaultChannelIds: input.defaultChannelIds ?? [],
    reusableStyleConstraints: input.reusableStyleConstraints ?? [],
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  await writeProjects([...projects, project])
  return project
}

export async function listProjectApprovedBlueprints(projectId: string): Promise<ProjectApprovedBlueprintRecord[]> {
  const library = await readProjectApprovedBlueprintLibrary()
  return library[projectId] ?? []
}
