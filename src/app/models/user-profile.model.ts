export interface UserPreferences {
  sidebarCollapsed?: boolean;
}

export interface UserProfile {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  createdAt?: unknown;
  preferences?: UserPreferences;
  admin?: boolean; // Deprecated, use role instead
  role?: string; // 'admin' or undefined/other roles
}
