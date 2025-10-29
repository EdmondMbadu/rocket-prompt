export interface Prompt {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly tag: string;
  readonly customUrl?: string;
  readonly views: number;
  readonly likes: number;
  readonly createdAt?: Date;
  readonly updatedAt?: Date;
}

export interface CreatePromptInput {
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
