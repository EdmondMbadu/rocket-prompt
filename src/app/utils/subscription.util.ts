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
