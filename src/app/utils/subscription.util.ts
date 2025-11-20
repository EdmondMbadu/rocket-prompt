export type SubscriptionTier = 'pro' | 'team' | 'plus';

interface SubscriptionInfo {
  key: SubscriptionTier;
  label: string;
  shortLabel: string;
}

const SUBSCRIPTION_MAP: Record<SubscriptionTier, SubscriptionInfo> = {
  plus: {
    key: 'plus',
    label: 'Plus Member',
    shortLabel: 'Plus'
  },
  pro: {
    key: 'pro',
    label: 'Pro Member',
    shortLabel: 'Pro'
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
 * - "pro" users have 1-year subscriptions, show banner if expired
 * - "team" users have 1-year subscriptions, show banner if expired
 * - All other users should see the banner
 * 
 * Note: Backend sets subscriptionStatus: "plus" for Plus plan (lifetime, no expiration)
 *       Backend sets subscriptionStatus: "pro" for Team/Pro plan (1-year, with expiration)
 * 
 * @param subscriptionStatus - The user's subscription status ('pro', 'team', 'plus', or undefined)
 * @param subscriptionExpiresAt - The expiration timestamp (Firestore Timestamp or Date, or null/undefined for lifetime)
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

  // "pro" users: check if they have an expiration date
  // If no expiration date, they're legacy plus users (lifetime), never show banner
  if (status === 'pro') {
    if (!subscriptionExpiresAt) {
      return false; // Legacy plus user (lifetime access)
    }
    // Has expiration date, so it's a 1-year subscription - check expiration below
  }

  // "team" users and "pro" users with expiration dates have 1-year subscriptions
  if (status === 'pro' || status === 'team') {
    // If no expiration date at this point, show banner (shouldn't happen for team, but be safe)
    if (!subscriptionExpiresAt) {
      return true;
    }

    // Convert Firestore Timestamp to Date if needed
    // Firestore Timestamps can be:
    // 1. Date instance (already converted)
    // 2. Firestore Timestamp object with toDate() method
    // 3. Plain object with seconds (and optionally nanoseconds) properties
    // 4. String date (manually entered or from database)
    let expirationDate: Date | null = null;
    
    if (subscriptionExpiresAt instanceof Date) {
      expirationDate = subscriptionExpiresAt;
    } else if (typeof subscriptionExpiresAt === 'string') {
      // Handle string dates - try parsing the date string
      try {
        expirationDate = new Date(subscriptionExpiresAt);
        // Check if the date is valid
        if (isNaN(expirationDate.getTime())) {
          expirationDate = null;
        }
      } catch (e) {
        console.warn('Failed to parse expiration date string', e);
        expirationDate = null;
      }
    } else if (subscriptionExpiresAt && typeof subscriptionExpiresAt === 'object') {
      // Handle Firestore Timestamp - try toDate() first (Firebase SDK format)
      const timestamp = subscriptionExpiresAt as { 
        seconds?: number; 
        nanoseconds?: number;
        toDate?: () => Date 
      };
      
      if (timestamp.toDate && typeof timestamp.toDate === 'function') {
        try {
          expirationDate = timestamp.toDate();
        } catch (e) {
          console.warn('Failed to call toDate() on timestamp', e);
        }
      } else if (typeof timestamp.seconds === 'number') {
        // Handle plain object format: { seconds: number, nanoseconds?: number }
        // Convert seconds to milliseconds (nanoseconds precision not needed for date comparison)
        expirationDate = new Date(timestamp.seconds * 1000);
      }
    }

    // If we couldn't parse the date, don't show banner (assume valid subscription)
    // This is safer than showing banner for users who might have valid subscriptions
    if (!expirationDate || isNaN(expirationDate.getTime())) {
      console.warn('Could not parse expiration date, assuming subscription is valid', { 
        subscriptionStatus: status, 
        subscriptionExpiresAt 
      });
      return false; // Don't show banner if we can't verify expiration
    }

    // Show banner only if subscription has expired (current time is past expiration)
    const now = new Date();
    const isExpired = now > expirationDate;
    
    return isExpired;
  }

  // For any other status, show banner
  return true;
}

/**
 * Checks if a subscription has expired.
 * 
 * @param subscriptionStatus - The user's subscription status ('pro', 'team', 'plus', or undefined)
 * @param subscriptionExpiresAt - The expiration timestamp (Firestore Timestamp, Date, string, or null/undefined)
 * @returns true if the subscription has expired, false otherwise
 */
export function isSubscriptionExpired(
  subscriptionStatus?: string | null,
  subscriptionExpiresAt?: unknown
): boolean {
  // Plus users never expire
  if (subscriptionStatus?.toLowerCase() === 'plus') {
    return false;
  }

  // If no expiration date, assume it doesn't expire (legacy plus users)
  if (!subscriptionExpiresAt) {
    return false;
  }

  // Parse the expiration date
  let expirationDate: Date | null = null;
  
  if (subscriptionExpiresAt instanceof Date) {
    expirationDate = subscriptionExpiresAt;
  } else if (typeof subscriptionExpiresAt === 'string') {
    try {
      expirationDate = new Date(subscriptionExpiresAt);
      if (isNaN(expirationDate.getTime())) {
        return false; // Invalid date, assume not expired
      }
    } catch (e) {
      return false; // Can't parse, assume not expired
    }
  } else if (subscriptionExpiresAt && typeof subscriptionExpiresAt === 'object') {
    const timestamp = subscriptionExpiresAt as { 
      seconds?: number; 
      nanoseconds?: number;
      toDate?: () => Date 
    };
    
    if (timestamp.toDate && typeof timestamp.toDate === 'function') {
      try {
        expirationDate = timestamp.toDate();
      } catch (e) {
        return false;
      }
    } else if (typeof timestamp.seconds === 'number') {
      expirationDate = new Date(timestamp.seconds * 1000);
    }
  }

  if (!expirationDate || isNaN(expirationDate.getTime())) {
    return false; // Can't determine expiration, assume not expired
  }

  // Check if current time is past expiration
  return new Date() > expirationDate;
}
