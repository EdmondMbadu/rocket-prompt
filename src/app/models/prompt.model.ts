export interface Prompt {
  readonly id: string;
  readonly authorId: string;
  readonly title: string;
  readonly content: string;
  readonly tag: string;
  readonly customUrl?: string;
  readonly views: number;
  readonly likes: number;
  readonly isInvisible?: boolean;
  readonly createdAt?: Date;
  readonly updatedAt?: Date;
}

export interface CreatePromptInput {
  readonly authorId: string;
  readonly title: string;
  readonly content: string;
  readonly tag: string;
  readonly customUrl?: string;
  readonly views?: number;
  readonly likes?: number;
}

export interface UpdatePromptInput {
  readonly title: string;
  readonly content: string;
  readonly tag: string;
  readonly customUrl?: string;
}
