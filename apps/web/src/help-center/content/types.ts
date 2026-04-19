export type HelpWorkflowStage = {
  id: string
  title: string
  description: string
  notes?: string[]
}

export type HelpWorkflowGuide = {
  id: string
  title: string
  summary: string
  audienceNote: string
  stages: HelpWorkflowStage[]
  decisionPoints: string[]
  relatedFeatureIds: string[]
}

export type HelpFeatureSection = {
  title: string
  points: string[]
}

export type HelpFeatureGuide = {
  id: string
  title: string
  purpose: string
  whenToUse: string
  sections: HelpFeatureSection[]
  relatedWorkflowIds: string[]
}

export type HelpReleaseEntry = {
  id: string
  versionDate: string
  title: string
  summary: string
  affectedFeatureIds: string[]
  operatorNotes: string[]
  workflowChanges: string[]
}
