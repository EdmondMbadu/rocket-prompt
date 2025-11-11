export interface DailyTip {
  readonly text: string;
  readonly author?: string;
  readonly date: string; // YYYY-MM-DD format
  readonly updatedAt?: Date;
  readonly updatedBy?: string;
}

export interface HomeContent {
  readonly id: string;
  readonly dailyTip?: DailyTip;
  readonly promptOfTheDayId?: string;
  readonly promptOfTheDayDate?: string; // YYYY-MM-DD format
  readonly promptOfTheDayUpdatedAt?: Date;
  readonly promptOfTheDayUpdatedBy?: string;
}

export interface UpdateHomeContentInput {
  readonly dailyTip?: {
    readonly text: string;
    readonly author?: string;
  };
  readonly promptOfTheDayId?: string;
}

