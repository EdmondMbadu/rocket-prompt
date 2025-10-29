import { Injectable } from '@angular/core';
import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import type { Firestore, QueryDocumentSnapshot } from 'firebase/firestore';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environments';
import type { CreatePromptInput, Prompt } from '../models/prompt.model';

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

  private ensureApp(): FirebaseApp {
    if (getApps().length) {
      return getApp();
    }

    return initializeApp(environment.firebase);
  }
}
