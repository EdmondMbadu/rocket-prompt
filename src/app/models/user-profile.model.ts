export interface UserPreferences {
  sidebarCollapsed?: boolean;
}

export interface UserProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  createdAt?: unknown;
  preferences?: UserPreferences;
}
