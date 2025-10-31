export interface PromptCollection {
  readonly id: string;
  readonly name: string;
  readonly tag: string;
  readonly promptIds: readonly string[];
  readonly createdAt?: Date;
  readonly updatedAt?: Date;
}

export interface CreateCollectionInput {
  readonly name: string;
  readonly tag: string;
  readonly promptIds: readonly string[];
}

export interface UpdateCollectionInput {
  readonly name?: string;
  readonly tag?: string;
  readonly promptIds?: readonly string[];
}

