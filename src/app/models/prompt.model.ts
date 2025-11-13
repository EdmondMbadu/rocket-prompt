export interface Prompt {
  readonly id: string;
  readonly authorId: string;
  readonly title: string;
  readonly content: string;
  readonly tag: string;
  readonly customUrl?: string;
  readonly views: number;
  readonly likes: number;
  readonly launchGpt: number;
  readonly launchGemini: number;
  readonly launchClaude: number;
  readonly copied: number;
  readonly totalLaunch: number;
  readonly isInvisible?: boolean;
  readonly isPrivate?: boolean;
  readonly createdAt?: Date;
  readonly updatedAt?: Date;
  // Fork-related fields
  readonly forkedFromPromptId?: string;
  readonly forkedFromAuthorId?: string;
  readonly forkedFromTitle?: string;
  readonly forkedFromCustomUrl?: string;
  readonly forkCount?: number;
  // Organization-related fields
  readonly organizationId?: string;
}

export interface CreatePromptInput {
  readonly authorId: string;
  readonly title: string;
  readonly content: string;
  readonly tag: string;
  readonly customUrl?: string;
  readonly views?: number;
  readonly likes?: number;
  readonly launchGpt?: number;
  readonly launchGemini?: number;
  readonly launchClaude?: number;
  readonly copied?: number;
  // Fork-related fields
  readonly forkedFromPromptId?: string;
  readonly forkedFromAuthorId?: string;
  readonly forkedFromTitle?: string;
  readonly forkedFromCustomUrl?: string;
  readonly isPrivate?: boolean;
  // Organization-related fields
  readonly organizationId?: string;
}

export interface UpdatePromptInput {
  readonly title: string;
  readonly content: string;
  readonly tag: string;
  readonly customUrl?: string;
  readonly isPrivate?: boolean;
}
