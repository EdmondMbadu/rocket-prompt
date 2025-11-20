export type SubscriptionTier = 'pro' | 'team';

interface SubscriptionInfo {
  key: SubscriptionTier;
  label: string;
  shortLabel: string;
}

const SUBSCRIPTION_MAP: Record<SubscriptionTier, SubscriptionInfo> = {
  pro: {
    key: 'pro',
    label: 'Plus Member',
    shortLabel: 'Plus'
  },
  team: {
    key: 'team',
    label: 'Team Member',
    shortLabel: 'Team'
  }
};

export function getSubscriptionDetails(status?: string | null): SubscriptionInfo | null {
  if (!status) {
    return null;
  }

  const normalized = status.toLowerCase() as SubscriptionTier;
  return SUBSCRIPTION_MAP[normalized] ?? null;
}

/**
 * Determines if the upgrade banner should be shown for a user.
 * 
 * Rules:
 * - "plus" users have lifetime access, never show banner
 * - "pro" and "team" users have 1-year subscriptions, show banner if expired
 * - All other users should see the banner
 * 
 * @param subscriptionStatus - The user's subscription status ('pro', 'team', 'plus', or undefined)
 * @param subscriptionExpiresAt - The expiration timestamp (Firestore Timestamp or Date)
 * @returns true if the upgrade banner should be shown, false otherwise
 */
export function shouldShowUpgradeBanner(
  subscriptionStatus?: string | null,
  subscriptionExpiresAt?: unknown
): boolean {
  // If no subscription status, show banner
  if (!subscriptionStatus) {
    return true;
  }

  const status = subscriptionStatus.toLowerCase();

  // "plus" users have lifetime access, never show banner
  if (status === 'plus') {
    return false;
  }

  // "pro" and "team" users have 1-year subscriptions
  if (status === 'pro' || status === 'team') {
    // If no expiration date, show banner (shouldn't happen, but be safe)
    if (!subscriptionExpiresAt) {
      return true;
    }

    // Convert Firestore Timestamp to Date if needed
    // Firestore Timestamps can be:
    // 1. Date instance (already converted)
    // 2. Firestore Timestamp object with toDate() method
    // 3. Plain object with seconds (and optionally nanoseconds) properties
    let expirationDate: Date | null = null;
    
    if (subscriptionExpiresAt instanceof Date) {
      expirationDate = subscriptionExpiresAt;
    } else if (subscriptionExpiresAt && typeof subscriptionExpiresAt === 'object') {
      // Handle Firestore Timestamp - try toDate() first (Firebase SDK format)
      const timestamp = subscriptionExpiresAt as { 
        seconds?: number; 
        nanoseconds?: number;
        toDate?: () => Date 
      };
      
      if (timestamp.toDate && typeof timestamp.toDate === 'function') {
        expirationDate = timestamp.toDate();
      } else if (typeof timestamp.seconds === 'number') {
        // Handle plain object format: { seconds: number, nanoseconds?: number }
        // Convert seconds to milliseconds (nanoseconds precision not needed for date comparison)
        expirationDate = new Date(timestamp.seconds * 1000);
      }
    }

    // If we couldn't parse the date, show banner to be safe
    if (!expirationDate) {
      return true;
    }

    // Show banner if subscription has expired (current time is past expiration)
    return new Date() > expirationDate;
  }

  // For any other status, show banner
  return true;
}
