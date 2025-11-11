import { Injectable } from '@angular/core';
import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import type { Firestore, DocumentSnapshot } from 'firebase/firestore';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environments';
import type { HomeContent, UpdateHomeContentInput, DailyTip } from '../models/home-content.model';

@Injectable({
  providedIn: 'root'
})
export class HomeContentService {
  private readonly app: FirebaseApp = this.ensureApp();
  private readonly COLLECTION_NAME = 'homeContent';
  private readonly DOCUMENT_ID = 'current';

  private firestore: Firestore | null = null;
  private firestoreModule?: typeof import('firebase/firestore');

  /**
   * Get current home content (observable)
   */
  homeContent$(): Observable<HomeContent | null> {
    return new Observable<HomeContent | null>((subscriber) => {
      let unsubscribe: (() => void) | undefined;

      this.getFirestoreContext()
        .then(({ firestore, firestoreModule }) => {
          const docRef = firestoreModule.doc(firestore, this.COLLECTION_NAME, this.DOCUMENT_ID);

          unsubscribe = firestoreModule.onSnapshot(
            docRef,
            (snapshot) => {
              if (snapshot.exists()) {
                const content = this.mapHomeContent(snapshot, firestoreModule);
                subscriber.next(content);
              } else {
                subscriber.next(null);
              }
            },
            (error) => subscriber.error(error)
          );
        })
        .catch((error) => subscriber.error(error));

      return () => unsubscribe?.();
    });
  }

  /**
   * Get current home content (promise)
   */
  async getHomeContent(): Promise<HomeContent | null> {
    const { firestore, firestoreModule } = await this.getFirestoreContext();
    const docRef = firestoreModule.doc(firestore, this.COLLECTION_NAME, this.DOCUMENT_ID);
    const snapshot = await firestoreModule.getDoc(docRef);

    if (!snapshot.exists()) {
      return null;
    }

    return this.mapHomeContent(snapshot, firestoreModule);
  }

  /**
   * Get the daily tip for today, or the most recent one if today's doesn't exist
   */
  async getDailyTip(): Promise<DailyTip | null> {
    const content = await this.getHomeContent();
    if (!content?.dailyTip || !content.dailyTip.text) {
      return null;
    }

    // Return the stored tip (it will be today's if set today, or previous if not)
    // The date field tells us when it was set, but we always show the stored tip
    return content.dailyTip;
  }

  /**
   * Get prompt of the day for today, or the most recent one if today's doesn't exist
   */
  async getPromptOfTheDay(): Promise<string | null> {
    const content = await this.getHomeContent();
    if (!content?.promptOfTheDayId) {
      return null;
    }

    // Return the stored prompt (it will be today's if set today, or previous if not)
    return content.promptOfTheDayId;
  }

  /**
   * Update home content (daily tip and/or prompt of the day)
   */
  async updateHomeContent(input: UpdateHomeContentInput, updatedBy: string): Promise<void> {
    const { firestore, firestoreModule } = await this.getFirestoreContext();
    const docRef = firestoreModule.doc(firestore, this.COLLECTION_NAME, this.DOCUMENT_ID);
    const snapshot = await firestoreModule.getDoc(docRef);

    const today = this.getTodayDateString();
    const timestamp = firestoreModule.serverTimestamp();
    const now = new Date();

    let updateData: Record<string, unknown> = {};

    // Update daily tip if provided
    if (input.dailyTip !== undefined) {
      if (input.dailyTip.text.trim()) {
        // Admin entered a tip for today
        updateData['dailyTip'] = {
          text: input.dailyTip.text.trim(),
          author: input.dailyTip.author?.trim() || null,
          date: today,
          updatedAt: timestamp,
          updatedBy: updatedBy
        };
      } else {
        // If text is empty and explicitly provided, clear/delete the tip
        // Check if we're explicitly clearing (text is empty string, not undefined)
        if (input.dailyTip.text === '') {
          updateData['dailyTip'] = null;
        }
        // If text is undefined, don't update the tip field at all
        // This means the previous tip will continue to be shown
      }
    }

    // Update prompt of the day if provided
    if (input.promptOfTheDayId !== undefined) {
      if (input.promptOfTheDayId.trim()) {
        updateData['promptOfTheDayId'] = input.promptOfTheDayId.trim();
        updateData['promptOfTheDayDate'] = today;
        updateData['promptOfTheDayUpdatedAt'] = timestamp;
        updateData['promptOfTheDayUpdatedBy'] = updatedBy;
      } else {
        // If empty, clear it
        updateData['promptOfTheDayId'] = null;
        updateData['promptOfTheDayDate'] = null;
        updateData['promptOfTheDayUpdatedAt'] = null;
        updateData['promptOfTheDayUpdatedBy'] = null;
      }
    }

    if (Object.keys(updateData).length === 0) {
      return; // Nothing to update
    }

    if (snapshot.exists()) {
      await firestoreModule.updateDoc(docRef, updateData);
    } else {
      // Create document if it doesn't exist
      await firestoreModule.setDoc(docRef, {
        ...updateData,
        createdAt: timestamp
      });
    }
  }

  /**
   * Get today's date as YYYY-MM-DD string
   */
  private getTodayDateString(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Map Firestore document to HomeContent model
   */
  private mapHomeContent(
    snapshot: DocumentSnapshot,
    firestoreModule: typeof import('firebase/firestore')
  ): HomeContent {
    const data = snapshot.data();

    let dailyTip: DailyTip | undefined;
    if (data?.['dailyTip']) {
      const tipData = data['dailyTip'];
      let updatedAt: Date | undefined;
      if (tipData['updatedAt']) {
        if (tipData['updatedAt'] instanceof firestoreModule.Timestamp) {
          updatedAt = tipData['updatedAt'].toDate();
        } else if (tipData['updatedAt'] && typeof tipData['updatedAt'] === 'object' && 'toDate' in tipData['updatedAt']) {
          updatedAt = (tipData['updatedAt'] as { toDate: () => Date }).toDate();
        }
      }

      dailyTip = {
        text: tipData['text'] || '',
        author: tipData['author'] || undefined,
        date: tipData['date'] || '',
        updatedAt,
        updatedBy: tipData['updatedBy'] || undefined
      };
    }

    let promptOfTheDayUpdatedAt: Date | undefined;
    if (data?.['promptOfTheDayUpdatedAt']) {
      if (data['promptOfTheDayUpdatedAt'] instanceof firestoreModule.Timestamp) {
        promptOfTheDayUpdatedAt = data['promptOfTheDayUpdatedAt'].toDate();
      } else if (data['promptOfTheDayUpdatedAt'] && typeof data['promptOfTheDayUpdatedAt'] === 'object' && 'toDate' in data['promptOfTheDayUpdatedAt']) {
        promptOfTheDayUpdatedAt = (data['promptOfTheDayUpdatedAt'] as { toDate: () => Date }).toDate();
      }
    }

    return {
      id: snapshot.id,
      dailyTip,
      promptOfTheDayId: data?.['promptOfTheDayId'] || undefined,
      promptOfTheDayDate: data?.['promptOfTheDayDate'] || undefined,
      promptOfTheDayUpdatedAt,
      promptOfTheDayUpdatedBy: data?.['promptOfTheDayUpdatedBy'] || undefined
    };
  }

  private async getFirestoreContext() {
    const firestoreModule = await this.importFirestoreModule();

    if (!this.firestore) {
      this.firestore = firestoreModule.getFirestore(this.app);
    }

    return {
      firestore: this.firestore,
      firestoreModule
    };
  }

  private async importFirestoreModule() {
    if (!this.firestoreModule) {
      this.firestoreModule = await import('firebase/firestore');
    }

    return this.firestoreModule;
  }

  private ensureApp(): FirebaseApp {
    if (getApps().length) {
      return getApp();
    }

    return initializeApp(environment.firebase);
  }
}

