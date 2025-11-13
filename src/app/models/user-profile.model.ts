export interface UserPreferences {
  sidebarCollapsed?: boolean;
}

export interface UserProfile {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  username?: string; // Display username for URLs (e.g., "JohnDoeA3b")
  profilePictureUrl?: string; // URL to the user's profile picture
  createdAt?: unknown;
  preferences?: UserPreferences;
  admin?: boolean; // Deprecated, use role instead
  role?: string; // 'admin' or undefined/other roles
  subscriptionStatus?: string; // 'free', 'pro', or 'team'
}
