import { Injectable } from '@angular/core';
import { getApp } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';

export type EmailCampaignMode = 'collection' | 'custom';
export type EmailRecipientScope = 'real' | 'all-auth';
export type EmailPlanFilter = 'all' | 'paying' | 'free';
export type EmailActivityFilter = 'all' | 'with-prompts' | 'no-prompts';

export interface EmailAudienceSummary {
  readonly all: number;
  readonly paying: number;
  readonly free: number;
  readonly noPrompts: number;
  readonly withPrompts: number;
  readonly optedOut: number;
  readonly missingEmail: number;
  readonly disabled: number;
  readonly real: number;
}

export interface EmailDirectoryUser {
  readonly id: string;
  readonly email: string;
  readonly firstName: string;
  readonly name: string;
  readonly isPaying: boolean;
  readonly hasPrompts: boolean;
  readonly emailVerified: boolean;
  readonly disabled: boolean;
  readonly optedOut: boolean;
  readonly eligible: boolean;
  readonly isRealUser: boolean;
  readonly eligibility: 'eligible' | 'missing-email' | 'opted-out' | 'disabled' | 'duplicate-email';
  readonly createdAt: string;
}

export interface EmailManagementData {
  readonly summary: EmailAudienceSummary;
  readonly users: EmailDirectoryUser[];
  readonly realUserIds: readonly string[];
  readonly adminEmail: string;
}

export interface SendEmailCampaignInput {
  readonly recipientIds: readonly string[];
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly mode: EmailCampaignMode;
  readonly collectionUrl?: string;
  readonly testOnly: boolean;
  readonly expectedRecipientCount: number;
  readonly testEmail?: string;
  readonly recipientFilters: {
    readonly scope: EmailRecipientScope;
    readonly plan: EmailPlanFilter;
    readonly activity: EmailActivityFilter;
  };
}

export interface SendEmailCampaignResult {
  readonly success: boolean;
  readonly recipientCount: number;
  readonly audienceCount: number;
  readonly testOnly: boolean;
  readonly campaignId: string;
}

@Injectable({ providedIn: 'root' })
export class AdminEmailService {
  private readonly functions = getFunctions(getApp(), 'us-central1');

  async getManagementData(): Promise<EmailManagementData> {
    const callable = httpsCallable<Record<string, never>, EmailManagementData>(
      this.functions,
      'getBulkEmailAudienceSummary'
    );
    const result = await callable({});
    return result.data;
  }

  async sendCampaign(input: SendEmailCampaignInput): Promise<SendEmailCampaignResult> {
    const callable = httpsCallable<SendEmailCampaignInput, SendEmailCampaignResult>(
      this.functions,
      'sendBulkEmailCampaign'
    );
    const result = await callable(input);
    return result.data;
  }
}
