import type { DirectLaunchTarget } from './user-profile.model';

export interface PromptCollection {
  readonly id: string;
  readonly name: string;
  readonly tag: string;
  readonly promptIds: readonly string[];
  readonly bookmarkCount: number;
  readonly createdAt?: Date;
  readonly updatedAt?: Date;
  readonly authorId?: string;
  readonly organizationId?: string;
  readonly collectionId?: string;
  readonly heroImageUrl?: string;
  readonly customUrl?: string;
  readonly blurb?: string;
  readonly brandLogoUrl?: string;
  readonly brandLink?: string;
  readonly brandSubtext?: string;
  readonly defaultAi?: DirectLaunchTarget;
  readonly isPrivate?: boolean;
}

export interface CreateCollectionInput {
  readonly name: string;
  readonly tag: string;
  readonly promptIds: readonly string[];
  readonly customUrl?: string;
  readonly blurb?: string;
  readonly brandLogoUrl?: string;
  readonly brandLink?: string;
  readonly brandSubtext?: string;
  readonly organizationId?: string;
  readonly defaultAi?: DirectLaunchTarget;
}

export interface UpdateCollectionInput {
  readonly name?: string;
  readonly tag?: string;
  readonly promptIds?: readonly string[];
  readonly heroImageUrl?: string;
  readonly customUrl?: string;
  readonly blurb?: string;
  readonly brandLogoUrl?: string;
  readonly brandLink?: string;
  readonly brandSubtext?: string;
  readonly defaultAi?: DirectLaunchTarget | null;
  readonly isPrivate?: boolean;
}

