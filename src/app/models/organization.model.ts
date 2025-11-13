export interface Organization {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly logoUrl?: string;
  readonly coverImageUrl?: string;
  readonly createdBy: string; // userId of the creator
  readonly members: readonly string[]; // array of userIds
  readonly username?: string; // Display username for URLs (e.g., "AcmeCorp")
  readonly allowOpenJoin?: boolean; // If true, anyone can join without invitation
  readonly createdAt?: Date;
  readonly updatedAt?: Date;
}

export interface CreateOrganizationInput {
  readonly name: string;
  readonly description?: string;
  readonly logoUrl?: string;
  readonly coverImageUrl?: string;
  readonly username?: string;
}

export interface UpdateOrganizationInput {
  readonly name?: string;
  readonly description?: string;
  readonly logoUrl?: string;
  readonly coverImageUrl?: string;
  readonly username?: string;
  readonly members?: readonly string[];
  readonly allowOpenJoin?: boolean;
}




