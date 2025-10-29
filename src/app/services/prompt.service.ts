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

  private ensureApp(): FirebaseApp {
    if (getApps().length) {
      return getApp();
    }

    return initializeApp(environment.firebase);
  }
}
