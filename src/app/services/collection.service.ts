import { Injectable } from '@angular/core';
import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import type { DocumentSnapshot, Firestore, QueryDocumentSnapshot } from 'firebase/firestore';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environments';
import type {
  CreateCollectionInput,
  PromptCollection,
  UpdateCollectionInput
} from '../models/collection.model';

@Injectable({
  providedIn: 'root'
})
export class CollectionService {
  private readonly app: FirebaseApp = this.ensureApp();

  private firestore: Firestore | null = null;
  private firestoreModule?: typeof import('firebase/firestore');

  collections$(): Observable<PromptCollection[]> {
    return new Observable<PromptCollection[]>((subscriber) => {
      let unsubscribe: (() => void) | undefined;

      this.getFirestoreContext()
        .then(({ firestore, firestoreModule }) => {
          const collectionRef = firestoreModule.collection(firestore, 'collections');
          const queryRef = firestoreModule.query(
            collectionRef,
            firestoreModule.orderBy('createdAt', 'desc')
          );

          unsubscribe = firestoreModule.onSnapshot(
            queryRef,
            (snapshot) => {
              const collections = snapshot.docs.map((doc) => this.mapCollection(doc, firestoreModule));
              subscriber.next(collections);
            },
            (error) => subscriber.error(error)
          );
        })
        .catch((error) => subscriber.error(error));

      return () => unsubscribe?.();
    });
  }

  collection$(id: string): Observable<PromptCollection | undefined> {
    const trimmedId = id?.trim();

    return new Observable<PromptCollection | undefined>((subscriber) => {
      if (!trimmedId) {
        subscriber.next(undefined);
        subscriber.complete();
        return;
      }

      let unsubscribe: (() => void) | undefined;

      this.getFirestoreContext()
        .then(({ firestore, firestoreModule }) => {
          const docRef = firestoreModule.doc(firestore, 'collections', trimmedId);

          unsubscribe = firestoreModule.onSnapshot(
            docRef,
            (snapshot) => {
              subscriber.next(
                snapshot.exists()
                  ? this.mapDocumentSnapshot(snapshot, firestoreModule)
                  : undefined
              );
            },
            (error) => subscriber.error(error)
          );
        })
        .catch((error) => subscriber.error(error));

      return () => unsubscribe?.();
    });
  }

  async createCollection(input: CreateCollectionInput): Promise<string> {
    const name = input.name?.trim();
    const tag = input.tag?.trim();
    const promptIds = Array.isArray(input.promptIds) ? input.promptIds.filter(Boolean) : [];

    if (!name) {
      throw new Error('A name is required to create a collection.');
    }

    if (!tag) {
      throw new Error('A tag is required to create a collection.');
    }

    if (promptIds.length === 0) {
      throw new Error('Select at least one prompt to create a collection.');
    }

    const { firestore, firestoreModule } = await this.getFirestoreContext();

    const normalizedTag = tag.toLowerCase();
    const uniquePromptIds = Array.from(new Set(promptIds.map((id) => id.trim()).filter(Boolean)));
    const timestamp = firestoreModule.serverTimestamp();

    const payload: Record<string, unknown> = {
      name,
      tag: normalizedTag,
      promptIds: uniquePromptIds,
      likes: 0,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    const docRef = await firestoreModule.addDoc(
      firestoreModule.collection(firestore, 'collections'),
      payload
    );

    return docRef.id;
  }

  async updateCollection(id: string, input: UpdateCollectionInput): Promise<void> {
    const trimmedId = id?.trim();

    if (!trimmedId) {
      throw new Error('A collection id is required to update a collection.');
    }

    const updatePayload: Record<string, unknown> = {};

    if (typeof input.name === 'string') {
      const name = input.name.trim();
      if (!name) {
        throw new Error('Collection name cannot be empty.');
      }
      updatePayload['name'] = name;
    }

    if (typeof input.tag === 'string') {
      const tag = input.tag.trim();
      if (!tag) {
        throw new Error('Collection tag cannot be empty.');
      }
      updatePayload['tag'] = tag.toLowerCase();
    }

    if (Array.isArray(input.promptIds)) {
      const prompts = input.promptIds.map((id) => id.trim()).filter(Boolean);
      if (prompts.length === 0) {
        throw new Error('Collection must contain at least one prompt.');
      }
      updatePayload['promptIds'] = Array.from(new Set(prompts));
    }

    if (Object.keys(updatePayload).length === 0) {
      return;
    }

    const { firestore, firestoreModule } = await this.getFirestoreContext();

    updatePayload['updatedAt'] = firestoreModule.serverTimestamp();

    await firestoreModule.updateDoc(
      firestoreModule.doc(firestore, 'collections', trimmedId),
      updatePayload
    );
  }

  async deleteCollection(id: string): Promise<void> {
    const trimmedId = id?.trim();

    if (!trimmedId) {
      throw new Error('A collection id is required to delete a collection.');
    }

    const { firestore, firestoreModule } = await this.getFirestoreContext();
    const docRef = firestoreModule.doc(firestore, 'collections', trimmedId);
    await firestoreModule.deleteDoc(docRef);
  }

  private mapCollection(
    doc: QueryDocumentSnapshot,
    firestoreModule: typeof import('firebase/firestore')
  ): PromptCollection {
    const data = doc.data() as Record<string, unknown>;

    return this.mapData(doc.id, data, firestoreModule);
  }

  private mapDocumentSnapshot(
    doc: DocumentSnapshot,
    firestoreModule: typeof import('firebase/firestore')
  ): PromptCollection {
    return this.mapData(doc.id, (doc.data() ?? {}) as Record<string, unknown>, firestoreModule);
  }

  private mapData(
    id: string,
    data: Record<string, unknown>,
    firestoreModule: typeof import('firebase/firestore')
  ): PromptCollection {
    const nameValue = data['name'];
    const tagValue = data['tag'];
    const promptIdsValue = data['promptIds'];
    const likesValue = data['likes'];
    const createdAtValue = data['createdAt'];
    const updatedAtValue = data['updatedAt'];

    return {
      id,
      name: typeof nameValue === 'string' ? nameValue : '',
      tag: typeof tagValue === 'string' ? tagValue : 'general',
      promptIds: Array.isArray(promptIdsValue)
        ? (promptIdsValue.filter((item): item is string => typeof item === 'string') as string[])
        : [],
      likes: typeof likesValue === 'number' ? likesValue : 0,
      createdAt: this.toDate(createdAtValue, firestoreModule),
      updatedAt: this.toDate(updatedAtValue, firestoreModule)
    };
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

  async hasLiked(collectionId: string, actorId: string): Promise<boolean> {
    const trimmedCollectionId = collectionId?.trim();
    const trimmedActorId = actorId?.trim();

    if (!trimmedCollectionId || !trimmedActorId) {
      return false;
    }

    const { firestore, firestoreModule } = await this.getFirestoreContext();
    const likeDocId = `${trimmedCollectionId}_${trimmedActorId}`;
    const likeDocRef = firestoreModule.doc(firestore, 'collectionLikes', likeDocId);
    const snap = await firestoreModule.getDoc(likeDocRef);
    return snap.exists();
  }

  async toggleLike(collectionId: string, actorId: string): Promise<{ liked: boolean; likes: number }> {
    const trimmedCollectionId = collectionId?.trim();
    const trimmedActorId = actorId?.trim();

    if (!trimmedCollectionId || !trimmedActorId) {
      throw new Error('Invalid like request.');
    }

    const { firestore, firestoreModule } = await this.getFirestoreContext();

    const likeDocId = `${trimmedCollectionId}_${trimmedActorId}`;
    const likeDocRef = firestoreModule.doc(firestore, 'collectionLikes', likeDocId);
    const collectionDocRef = firestoreModule.doc(firestore, 'collections', trimmedCollectionId);

    const result = await firestoreModule.runTransaction(firestore, async tx => {
      const likeSnap = await tx.get(likeDocRef as any);
      const collectionSnap = await tx.get(collectionDocRef as any);

      if (!collectionSnap.exists()) {
        throw new Error('Collection not found');
      }

      const collectionData = collectionSnap.data() as Record<string, unknown> | undefined;
      const likesVal = collectionData ? collectionData['likes'] : undefined;
      const currentLikes = typeof likesVal === 'number' ? likesVal : 0;

      if (likeSnap.exists()) {
        tx.delete(likeDocRef as any);
        const newLikes = Math.max(0, currentLikes - 1);
        tx.update(collectionDocRef as any, {
          likes: firestoreModule.increment ? firestoreModule.increment(-1) : newLikes
        });
        return { liked: false, likes: newLikes };
      }

      tx.set(likeDocRef as any, {
        collectionId: trimmedCollectionId,
        actorId: trimmedActorId,
        createdAt: firestoreModule.serverTimestamp()
      });
      tx.update(collectionDocRef as any, {
        likes: firestoreModule.increment ? firestoreModule.increment(1) : currentLikes + 1
      });
      return { liked: true, likes: currentLikes + 1 };
    });

    return result as { liked: boolean; likes: number };
  }
}

