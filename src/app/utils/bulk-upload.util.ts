import type { UserProfile } from '../models/user-profile.model';

export interface BulkUploadProgressState {
  processed: number;
  total: number;
  success: number;
  failed: number;
}

export const BULK_UPLOAD_INSTRUCTIONS_URL = 'https://rocketprompt.io/bulk-prompts';

export function createEmptyBulkProgress(): BulkUploadProgressState {
  return { processed: 0, total: 0, success: 0, failed: 0 };
}

export function canUseBulkUploadFeature(profile: UserProfile | null | undefined): boolean {
  if (!profile) {
    return false;
  }

  if (profile.role === 'admin' || profile.admin) {
    return true;
  }

  const status = profile.subscriptionStatus?.toLowerCase();
  return status === 'plus' || status === 'pro' || status === 'team';
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentField += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentField);
      currentField = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      if (currentField || currentRow.length > 0) {
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = '';
      }
    } else {
      currentField += char;
    }
  }

  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows;
}

export function parseCsvNumber(value: string | undefined, defaultValue: number): number {
  if (!value) {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : Math.max(0, parsed);
}

export function parseCsvBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) {
    return defaultValue;
  }
  const lower = value.toLowerCase().trim();
  return lower === 'true' || lower === '1' || lower === 'yes';
}
