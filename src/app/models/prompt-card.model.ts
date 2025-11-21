import { UserProfile } from './user-profile.model';
import { Organization } from './organization.model';

export interface PromptCard {
  readonly id: string;
  readonly authorId: string;
  readonly title: string;
  readonly content: string;
  readonly preview: string;
  readonly tag: string;
  readonly tagLabel: string;
  readonly customUrl?: string;
  readonly views: number;
  readonly likes: number;
  readonly launchGpt: number;
  readonly launchGemini: number;
  readonly launchClaude: number;
  readonly launchGrok: number;
  readonly copied: number;
  readonly totalLaunch: number;
  readonly createdAt?: Date;
  readonly updatedAt?: Date;
  readonly authorProfile?: UserProfile;
  // Organization-related fields
  readonly organizationId?: string;
  readonly organizationProfile?: Organization;
  // Fork-related fields
  readonly forkedFromPromptId?: string;
  readonly forkedFromAuthorId?: string;
  readonly forkedFromTitle?: string;
  readonly forkedFromCustomUrl?: string;
  readonly forkCount?: number;
  readonly isPrivate?: boolean;
}

