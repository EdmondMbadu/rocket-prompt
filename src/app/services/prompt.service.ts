import { Injectable } from '@angular/core';
import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import type { Firestore, QueryDocumentSnapshot } from 'firebase/firestore';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environments';
import type { CreatePromptInput, Prompt, UpdatePromptInput } from '../models/prompt.model';

@Injectable({
  providedIn: 'root'
})
export class PromptService {
  private readonly app: FirebaseApp = this.ensureApp();

  private firestore: Firestore | null = null;
  private firestoreModule?: typeof import('firebase/firestore');

  prompts$(): Observable<Prompt[]> {
    return new Observable<Prompt[]>((subscriber) => {
      let unsubscribe: (() => void) | undefined;

      this.getFirestoreContext()
        .then(({ firestore, firestoreModule }) => {
          const collectionRef = firestoreModule.collection(firestore, 'prompts');
          const queryRef = firestoreModule.query(collectionRef, firestoreModule.orderBy('createdAt', 'desc'));

          unsubscribe = firestoreModule.onSnapshot(
            queryRef,
            (snapshot) => {
              const prompts = snapshot.docs.map((doc) => this.mapPrompt(doc, firestoreModule));
              subscriber.next(prompts);
            },
            (error) => subscriber.error(error)
          );
        })
        .catch((error) => subscriber.error(error));

      return () => unsubscribe?.();
    });
  }

  async createPrompt(input: CreatePromptInput): Promise<string> {
    const title = input.title?.trim();
    const content = input.content?.trim();
    const tag = input.tag?.trim();

    if (!title) {
      throw new Error('A title is required to create a prompt.');
    }

    if (!content) {
      throw new Error('Content is required to create a prompt.');
    }

    if (!tag) {
      throw new Error('A tag is required to create a prompt.');
    }

    const { firestore, firestoreModule } = await this.getFirestoreContext();

    const customUrl = input.customUrl?.trim() || undefined;
    const normalizedTag = tag.toLowerCase();
    const views = typeof input.views === 'number' && input.views >= 0 ? input.views : 0;
    const likes = typeof input.likes === 'number' && input.likes >= 0 ? input.likes : 0;
    const timestamp = firestoreModule.serverTimestamp();

    const payload: Record<string, unknown> = {
      title,
      content,
      tag: normalizedTag,
      views,
      likes,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    if (customUrl) {
      payload['customUrl'] = customUrl;
    }

    const docRef = await firestoreModule.addDoc(firestoreModule.collection(firestore, 'prompts'), payload);

    return docRef.id;
  }

  async updatePrompt(id: string, input: UpdatePromptInput): Promise<void> {
    const trimmedId = id?.trim();

    if (!trimmedId) {
      throw new Error('A prompt id is required to update a prompt.');
    }

    const title = input.title?.trim();
    const content = input.content?.trim();
    const tag = input.tag?.trim();

    if (!title) {
      throw new Error('A title is required to update a prompt.');
    }

    if (!content) {
      throw new Error('Content is required to update a prompt.');
    }

    if (!tag) {
      throw new Error('A tag is required to update a prompt.');
    }

    const { firestore, firestoreModule } = await this.getFirestoreContext();
    const normalizedTag = tag.toLowerCase();
    const customUrlRaw = input.customUrl ?? '';
    const customUrl = customUrlRaw.trim();

    const updatePayload: Record<string, unknown> = {
      title,
      content,
      tag: normalizedTag,
      updatedAt: firestoreModule.serverTimestamp()
    };

    if (customUrl) {
      updatePayload['customUrl'] = customUrl;
    } else {
      updatePayload['customUrl'] = firestoreModule.deleteField();
    }

    await firestoreModule.updateDoc(
      firestoreModule.doc(firestore, 'prompts', trimmedId),
      updatePayload
    );
  }

  private mapPrompt(
    doc: QueryDocumentSnapshot,
    firestoreModule: typeof import('firebase/firestore')
  ): Prompt {
    const data = doc.data() as Record<string, unknown>;

    const titleValue = data['title'];
    const contentValue = data['content'];
    const tagValue = data['tag'];
    const customUrlValue = data['customUrl'];
    const viewsValue = data['views'];
    const likesValue = data['likes'];
    const createdAtValue = data['createdAt'];
    const updatedAtValue = data['updatedAt'];

    return {
      id: doc.id,
      title: typeof titleValue === 'string' ? titleValue : '',
      content: typeof contentValue === 'string' ? contentValue : '',
      tag: typeof tagValue === 'string' ? tagValue : 'general',
      customUrl: typeof customUrlValue === 'string' ? customUrlValue : undefined,
      views: typeof viewsValue === 'number' ? viewsValue : 0,
      likes: typeof likesValue === 'number' ? likesValue : 0,
      createdAt: this.toDate(createdAtValue, firestoreModule),
      updatedAt: this.toDate(updatedAtValue, firestoreModule)
    };
  }

  async deletePrompt(id: string): Promise<void> {
    const trimmedId = id?.trim();

    if (!trimmedId) {
      throw new Error('A prompt id is required to delete a prompt.');
    }

    const { firestore, firestoreModule } = await this.getFirestoreContext();
    const docRef = firestoreModule.doc(firestore, 'prompts', trimmedId);
    await firestoreModule.deleteDoc(docRef);
  }

  private toDate(
    value: unknown,
    firestoreModule: typeof import('firebase/firestore')
  ): Date | undefined {
    if (value instanceof firestoreModule.Timestamp) {
      return value.toDate();
    }

    if (value && typeof value === 'object' && 'toDate' in (value as { toDate?: () => Date })) {
      const possibleDate = (value as { toDate?: () => Date }).toDate;
      return typeof possibleDate === 'function' ? possibleDate() : undefined;
    }

    return undefined;
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

  /**
   * Check whether an actor (user or client) has liked a prompt.
   * actorId should be a stable string identifying the actor (for users use `u_<uid>`, for clients `c_<clientId>`).
   */
  async hasLiked(promptId: string, actorId: string): Promise<boolean> {
    const { firestore, firestoreModule } = await this.getFirestoreContext();
    const likeDocId = `${promptId}_${actorId}`;
    const likeDocRef = firestoreModule.doc(firestore, 'promptLikes', likeDocId);
    const snap = await firestoreModule.getDoc(likeDocRef);
    return snap.exists();
  }

  async fetchLikedPrompts(actorId: string): Promise<Prompt[]> {
    const trimmedActorId = actorId?.trim();

    if (!trimmedActorId) {
      return [];
    }

    const { firestore, firestoreModule } = await this.getFirestoreContext();

    const likesQuery = firestoreModule.query(
      firestoreModule.collection(firestore, 'promptLikes'),
      firestoreModule.where('actorId', '==', trimmedActorId),
      firestoreModule.orderBy('createdAt', 'desc'),
      firestoreModule.limit(200)
    );

    const likeSnapshot = await firestoreModule.getDocs(likesQuery);

    if (likeSnapshot.empty) {
      return [];
    }

    const likedEntries = likeSnapshot.docs
      .map((doc, index) => {
        const data = doc.data() as Record<string, unknown> | undefined;
        const promptId = typeof data?.['promptId'] === 'string' ? data?.['promptId'].trim() : undefined;

        if (!promptId) {
          return null;
        }

        return { promptId, order: index };
      })
      .filter((entry): entry is { promptId: string; order: number } => !!entry);

    if (!likedEntries.length) {
      return [];
    }

    const orderMap = new Map<string, number>();
    const promptIds: string[] = [];

    likedEntries.forEach(entry => {
      if (!orderMap.has(entry.promptId)) {
        orderMap.set(entry.promptId, entry.order);
        promptIds.push(entry.promptId);
      }
    });

    const prompts: Prompt[] = [];
    const chunkSize = 10;

    for (let i = 0; i < promptIds.length; i += chunkSize) {
      const chunk = promptIds.slice(i, i + chunkSize);

      const promptQuery = firestoreModule.query(
        firestoreModule.collection(firestore, 'prompts'),
        firestoreModule.where(firestoreModule.documentId(), 'in', chunk)
      );

      const promptSnapshot = await firestoreModule.getDocs(promptQuery);

      promptSnapshot.docs.forEach(doc => {
        prompts.push(this.mapPrompt(doc as QueryDocumentSnapshot, firestoreModule));
      });
    }

    prompts.sort((a, b) => {
      const aOrder = orderMap.get(a.id ?? '') ?? Number.MAX_SAFE_INTEGER;
      const bOrder = orderMap.get(b.id ?? '') ?? Number.MAX_SAFE_INTEGER;
      return aOrder - bOrder;
    });

    return prompts;
  }

  /**
   * Toggle a like for an actor on a prompt. Uses a transaction to ensure likes count stays consistent.
   * Returns the new liked state and the resulting likes count.
   */
  async toggleLike(promptId: string, actorId: string): Promise<{ liked: boolean; likes: number }> {
    const { firestore, firestoreModule } = await this.getFirestoreContext();

    const likeDocId = `${promptId}_${actorId}`;
    const likeDocRef = firestoreModule.doc(firestore, 'promptLikes', likeDocId);
    const promptDocRef = firestoreModule.doc(firestore, 'prompts', promptId);

    const result = await firestoreModule.runTransaction(firestore, async (tx) => {
      const likeSnap = await tx.get(likeDocRef as any);
      const promptSnap = await tx.get(promptDocRef as any);

      if (!promptSnap.exists()) {
        throw new Error('Prompt not found');
      }

  const promptData = promptSnap.data() as Record<string, unknown> | undefined;
  const likesVal = promptData ? promptData['likes'] : undefined;
  const currentLikes = typeof likesVal === 'number' ? likesVal : 0;

      if (likeSnap.exists()) {
        // remove like
        tx.delete(likeDocRef as any);
        const newLikes = Math.max(0, currentLikes - 1);
        tx.update(promptDocRef as any, { likes: firestoreModule.increment ? firestoreModule.increment(-1) : newLikes });
        return { liked: false, likes: newLikes };
      } else {
        // add like
        tx.set(likeDocRef as any, { promptId, actorId, createdAt: firestoreModule.serverTimestamp() });
        tx.update(promptDocRef as any, { likes: firestoreModule.increment ? firestoreModule.increment(1) : currentLikes + 1 });
        return { liked: true, likes: currentLikes + 1 };
      }
    });

    return result as { liked: boolean; likes: number };
  }

  /**
   * Get a prompt by its custom URL. This is efficient and works for public access.
   * @param customUrl The custom URL to look up
   * @returns The prompt if found, undefined otherwise
   */
  async getPromptByCustomUrl(customUrl: string): Promise<Prompt | undefined> {
    const trimmed = customUrl?.trim();
    if (!trimmed) {
      return undefined;
    }

    const { firestore, firestoreModule } = await this.getFirestoreContext();

    // Query for prompt with this custom URL
    const queryRef = firestoreModule.query(
      firestoreModule.collection(firestore, 'prompts'),
      firestoreModule.where('customUrl', '==', trimmed),
      firestoreModule.limit(1)
    );

    const snapshot = await firestoreModule.getDocs(queryRef);

    if (snapshot.empty) {
      return undefined;
    }

    const doc = snapshot.docs[0];
    return this.mapPrompt(doc, firestoreModule);
  }

  /**
   * Get a prompt by its ID. Supports full ID or short prefix match.
   * @param id The prompt ID or short prefix
   * @returns The prompt if found, undefined otherwise
   */
  async getPromptById(id: string): Promise<Prompt | undefined> {
    const trimmed = id?.trim();
    if (!trimmed) {
      return undefined;
    }

    const { firestore, firestoreModule } = await this.getFirestoreContext();

    // First try exact match
    try {
      const docRef = firestoreModule.doc(firestore, 'prompts', trimmed);
      const docSnap = await firestoreModule.getDoc(docRef);
      
      if (docSnap.exists()) {
        return this.mapPrompt(docSnap as QueryDocumentSnapshot, firestoreModule);
      }
    } catch (error) {
      // If exact match fails, try prefix match
    }

    // If exact match not found, try prefix match by querying all prompts
    // This is less efficient but necessary for short ID prefixes
    // In production, you might want to store a shortId field for better performance
    const collectionRef = firestoreModule.collection(firestore, 'prompts');
    const snapshot = await firestoreModule.getDocs(collectionRef);
    
    const found = snapshot.docs
      .map(doc => this.mapPrompt(doc, firestoreModule))
      .find(p => p.id === trimmed || p.id.startsWith(trimmed));

    return found;
  }

  /**
   * Check if a custom URL is already taken by another prompt.
   * This uses a Firestore query which should be fast with a proper index on customUrl.
   * @param customUrl The custom URL to check (should already be trimmed and normalized)
   * @param excludePromptId Optional prompt ID to exclude from the check (useful when editing)
   * @returns true if the custom URL is taken, false otherwise
   */
  async isCustomUrlTaken(customUrl: string, excludePromptId?: string | null): Promise<boolean> {
    const trimmed = customUrl?.trim();
    if (!trimmed) {
      return false;
    }

    const { firestore, firestoreModule } = await this.getFirestoreContext();

    // Query for prompts with this custom URL
    const queryRef = firestoreModule.query(
      firestoreModule.collection(firestore, 'prompts'),
      firestoreModule.where('customUrl', '==', trimmed),
      firestoreModule.limit(1)
    );

    const snapshot = await firestoreModule.getDocs(queryRef);

    if (snapshot.empty) {
      return false;
    }

    // If we're editing a prompt, check if the found prompt is the one being edited
    if (excludePromptId) {
      const foundDoc = snapshot.docs[0];
      return foundDoc.id !== excludePromptId;
    }

    return true;
  }

  private ensureApp(): FirebaseApp {
    if (getApps().length) {
      return getApp();
    }

    return initializeApp(environment.firebase);
  }
}
