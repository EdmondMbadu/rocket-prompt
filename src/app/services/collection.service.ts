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

  collectionsByAuthor$(authorId: string): Observable<PromptCollection[]> {
    const trimmedAuthorId = authorId?.trim();
    
    return new Observable<PromptCollection[]>((subscriber) => {
      if (!trimmedAuthorId) {
        subscriber.next([]);
        subscriber.complete();
        return;
      }

      let unsubscribe: (() => void) | undefined;

      this.getFirestoreContext()
        .then(({ firestore, firestoreModule }) => {
          const collectionRef = firestoreModule.collection(firestore, 'collections');
          const queryRef = firestoreModule.query(
            collectionRef,
            firestoreModule.where('authorId', '==', trimmedAuthorId),
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

  async createCollection(input: CreateCollectionInput, authorId?: string): Promise<string> {
    const name = input.name?.trim();
    const tag = input.tag?.trim();
    const promptIds = Array.isArray(input.promptIds) ? input.promptIds.filter(Boolean) : [];
    const customUrl = input.customUrl?.trim();
    const blurb = input.blurb?.trim();

    if (!name) {
      throw new Error('A name is required to create a collection.');
    }

    if (!tag) {
      throw new Error('A tag is required to create a collection.');
    }

    if (promptIds.length === 0) {
      throw new Error('Select at least one prompt to create a collection.');
    }

    // Validate customUrl if provided
    if (customUrl) {
      if (!/^[a-z0-9-]+$/.test(customUrl)) {
        throw new Error('Custom URL can only contain lowercase letters, numbers, and hyphens.');
      }
      
      // Check if customUrl is taken (by prompt or collection)
      const isTaken = await this.isCustomUrlTaken(customUrl);
      if (isTaken) {
        throw new Error('This custom URL is already taken. Please choose a different one.');
      }
    }

    const { firestore, firestoreModule } = await this.getFirestoreContext();

    const normalizedTag = tag.toLowerCase();
    const uniquePromptIds = Array.from(new Set(promptIds.map((id) => id.trim()).filter(Boolean)));
    const timestamp = firestoreModule.serverTimestamp();

    const payload: Record<string, unknown> = {
      name,
      tag: normalizedTag,
      promptIds: uniquePromptIds,
      bookmarkCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    if (authorId) {
      payload['authorId'] = authorId.trim();
    }

    if (customUrl) {
      payload['customUrl'] = customUrl;
    }

    if (blurb) {
      payload['blurb'] = blurb;
    }

    const docRef = await firestoreModule.addDoc(
      firestoreModule.collection(firestore, 'collections'),
      payload
    );

    // Update the document with its own ID (collectionId)
    await firestoreModule.updateDoc(docRef, {
      collectionId: docRef.id
    });

    return docRef.id;
  }

  async updateCollection(id: string, input: UpdateCollectionInput, userId?: string): Promise<void> {
    const trimmedId = id?.trim();

    if (!trimmedId) {
      throw new Error('A collection id is required to update a collection.');
    }

    const { firestore, firestoreModule } = await this.getFirestoreContext();
    const docRef = firestoreModule.doc(firestore, 'collections', trimmedId);
    const docSnap = await firestoreModule.getDoc(docRef);

    if (!docSnap.exists()) {
      throw new Error('Collection not found.');
    }

    const collectionData = docSnap.data() as Record<string, unknown>;
    const authorId = collectionData['authorId'] as string | undefined;

    // Check if user is the author
    if (authorId) {
      if (!userId) {
        throw new Error('You must be logged in to edit collections.');
      }
      if (authorId !== userId) {
        throw new Error('You can only edit collections you created.');
      }
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

    if (typeof input.heroImageUrl === 'string') {
      updatePayload['heroImageUrl'] = input.heroImageUrl.trim() || null;
    }

    if (typeof input.customUrl === 'string') {
      const customUrl = input.customUrl.trim();
      if (customUrl) {
        if (!/^[a-z0-9-]+$/.test(customUrl)) {
          throw new Error('Custom URL can only contain lowercase letters, numbers, and hyphens.');
        }
        
        // Check if customUrl is taken (by prompt or another collection)
        const isTaken = await this.isCustomUrlTaken(customUrl, trimmedId);
        if (isTaken) {
          throw new Error('This custom URL is already taken. Please choose a different one.');
        }
        updatePayload['customUrl'] = customUrl;
      } else {
        // Remove customUrl if empty string
        updatePayload['customUrl'] = firestoreModule.deleteField();
      }
    }

    if (typeof input.blurb === 'string') {
      const blurb = input.blurb.trim();
      if (blurb) {
        updatePayload['blurb'] = blurb;
      } else {
        // Remove blurb if empty string
        updatePayload['blurb'] = firestoreModule.deleteField();
      }
    }

    if (Object.keys(updatePayload).length === 0) {
      return;
    }

    updatePayload['updatedAt'] = firestoreModule.serverTimestamp();

    await firestoreModule.updateDoc(docRef, updatePayload);
  }

  async deleteCollection(id: string, userId?: string): Promise<void> {
    const trimmedId = id?.trim();

    if (!trimmedId) {
      throw new Error('A collection id is required to delete a collection.');
    }

    const { firestore, firestoreModule } = await this.getFirestoreContext();
    const docRef = firestoreModule.doc(firestore, 'collections', trimmedId);
    const docSnap = await firestoreModule.getDoc(docRef);

    if (!docSnap.exists()) {
      throw new Error('Collection not found.');
    }

    const collectionData = docSnap.data() as Record<string, unknown>;
    const authorId = collectionData['authorId'] as string | undefined;

    // Check if user is the author
    if (authorId) {
      if (!userId) {
        throw new Error('You must be logged in to delete collections.');
      }
      if (authorId !== userId) {
        throw new Error('You can only delete collections you created.');
      }
    }

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
    const bookmarkCountValue = data['bookmarkCount'];
    const createdAtValue = data['createdAt'];
    const updatedAtValue = data['updatedAt'];
    const authorIdValue = data['authorId'];
    const collectionIdValue = data['collectionId'];
    const heroImageUrlValue = data['heroImageUrl'];
    const customUrlValue = data['customUrl'];
    const blurbValue = data['blurb'];

    return {
      id,
      name: typeof nameValue === 'string' ? nameValue : '',
      tag: typeof tagValue === 'string' ? tagValue : 'general',
      promptIds: Array.isArray(promptIdsValue)
        ? (promptIdsValue.filter((item): item is string => typeof item === 'string') as string[])
        : [],
      bookmarkCount: typeof bookmarkCountValue === 'number' ? bookmarkCountValue : 0,
      createdAt: this.toDate(createdAtValue, firestoreModule),
      updatedAt: this.toDate(updatedAtValue, firestoreModule),
      authorId: typeof authorIdValue === 'string' ? authorIdValue : undefined,
      collectionId: typeof collectionIdValue === 'string' ? collectionIdValue : undefined,
      heroImageUrl: typeof heroImageUrlValue === 'string' ? heroImageUrlValue : undefined,
      customUrl: typeof customUrlValue === 'string' ? customUrlValue : undefined,
      blurb: typeof blurbValue === 'string' ? blurbValue : undefined
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

  async hasBookmarked(collectionId: string, actorId: string): Promise<boolean> {
    const trimmedCollectionId = collectionId?.trim();
    const trimmedActorId = actorId?.trim();

    if (!trimmedCollectionId || !trimmedActorId) {
      return false;
    }

    const { firestore, firestoreModule } = await this.getFirestoreContext();
    const bookmarkDocId = `${trimmedCollectionId}_${trimmedActorId}`;
    const bookmarkDocRef = firestoreModule.doc(firestore, 'collectionBookmarks', bookmarkDocId);
    const snap = await firestoreModule.getDoc(bookmarkDocRef);
    return snap.exists();
  }

  async toggleBookmark(collectionId: string, actorId: string): Promise<{ bookmarked: boolean; bookmarkCount: number }> {
    const trimmedCollectionId = collectionId?.trim();
    const trimmedActorId = actorId?.trim();

    if (!trimmedCollectionId || !trimmedActorId) {
      throw new Error('Invalid bookmark request.');
    }

    const { firestore, firestoreModule } = await this.getFirestoreContext();

    const bookmarkDocId = `${trimmedCollectionId}_${trimmedActorId}`;
    const bookmarkDocRef = firestoreModule.doc(firestore, 'collectionBookmarks', bookmarkDocId);
    const collectionDocRef = firestoreModule.doc(firestore, 'collections', trimmedCollectionId);

    const result = await firestoreModule.runTransaction(firestore, async tx => {
      const bookmarkSnap = await tx.get(bookmarkDocRef as any);
      const collectionSnap = await tx.get(collectionDocRef as any);

      if (!collectionSnap.exists()) {
        throw new Error('Collection not found');
      }

      const collectionData = collectionSnap.data() as Record<string, unknown> | undefined;
      const bookmarkCountVal = collectionData ? collectionData['bookmarkCount'] : undefined;
      const currentBookmarkCount = typeof bookmarkCountVal === 'number' ? bookmarkCountVal : 0;

      if (bookmarkSnap.exists()) {
        tx.delete(bookmarkDocRef as any);
        const newBookmarkCount = Math.max(0, currentBookmarkCount - 1);
        tx.update(collectionDocRef as any, {
          bookmarkCount: firestoreModule.increment
            ? firestoreModule.increment(-1)
            : newBookmarkCount
        });
        return { bookmarked: false, bookmarkCount: newBookmarkCount };
      }

      tx.set(bookmarkDocRef as any, {
        collectionId: trimmedCollectionId,
        actorId: trimmedActorId,
        createdAt: firestoreModule.serverTimestamp()
      });
      tx.update(collectionDocRef as any, {
        bookmarkCount: firestoreModule.increment
          ? firestoreModule.increment(1)
          : currentBookmarkCount + 1
      });
      return { bookmarked: true, bookmarkCount: currentBookmarkCount + 1 };
    });

    return result as { bookmarked: boolean; bookmarkCount: number };
  }

  async uploadHeroImage(collectionId: string, file: File, userId: string): Promise<string> {
    const trimmedId = collectionId?.trim();

    if (!trimmedId) {
      throw new Error('A collection id is required to upload a hero image.');
    }

    if (!file) {
      throw new Error('A file is required to upload.');
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      throw new Error('Only image files are allowed.');
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      throw new Error('Image size must be less than 5MB.');
    }

    const { firestore, firestoreModule } = await this.getFirestoreContext();
    const docRef = firestoreModule.doc(firestore, 'collections', trimmedId);
    const docSnap = await firestoreModule.getDoc(docRef);

    if (!docSnap.exists()) {
      throw new Error('Collection not found.');
    }

    const collectionData = docSnap.data() as Record<string, unknown>;
    const authorId = collectionData['authorId'] as string | undefined;

    // Check if user is the author
    if (authorId) {
      if (!userId) {
        throw new Error('You must be logged in to upload images.');
      }
      if (authorId !== userId) {
        throw new Error('You can only upload images for collections you created.');
      }
    }

    // Import Firebase Storage
    const storageModule = await import('firebase/storage');
    const storage = storageModule.getStorage(this.app);

    // Create a unique filename
    const fileExtension = file.name.split('.').pop() || 'jpg';
    const fileName = `collections/${trimmedId}/hero-${Date.now()}.${fileExtension}`;
    const storageRef = storageModule.ref(storage, fileName);

    // Upload the file
    await storageModule.uploadBytes(storageRef, file);

    // Get the download URL
    const downloadURL = await storageModule.getDownloadURL(storageRef);

    // Update the collection with the new image URL
    await firestoreModule.updateDoc(docRef, {
      heroImageUrl: downloadURL,
      updatedAt: firestoreModule.serverTimestamp()
    });

    return downloadURL;
  }

  async deleteHeroImage(collectionId: string, userId: string): Promise<void> {
    const trimmedId = collectionId?.trim();

    if (!trimmedId) {
      throw new Error('A collection id is required to delete a hero image.');
    }

    const { firestore, firestoreModule } = await this.getFirestoreContext();
    const docRef = firestoreModule.doc(firestore, 'collections', trimmedId);
    const docSnap = await firestoreModule.getDoc(docRef);

    if (!docSnap.exists()) {
      throw new Error('Collection not found.');
    }

    const collectionData = docSnap.data() as Record<string, unknown>;
    const authorId = collectionData['authorId'] as string | undefined;
    const heroImageUrl = collectionData['heroImageUrl'] as string | undefined;

    // Check if user is the author
    if (authorId) {
      if (!userId) {
        throw new Error('You must be logged in to delete images.');
      }
      if (authorId !== userId) {
        throw new Error('You can only delete images for collections you created.');
      }
    }

    // Delete from Storage if URL exists
    if (heroImageUrl) {
      try {
        const storageModule = await import('firebase/storage');
        const storage = storageModule.getStorage(this.app);
        
        // Extract the path from the URL
        // Firebase Storage URLs format: https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{encodedPath}?alt=media
        try {
          const url = new URL(heroImageUrl);
          const pathMatch = url.pathname.match(/\/o\/(.+)\?/);
          if (pathMatch && pathMatch[1]) {
            const decodedPath = decodeURIComponent(pathMatch[1]);
            const imageRef = storageModule.ref(storage, decodedPath);
            await storageModule.deleteObject(imageRef);
          } else {
            console.warn('Could not extract path from storage URL:', heroImageUrl);
          }
        } catch (urlError) {
          // If URL parsing fails, log the error
          console.warn('Failed to parse storage URL:', urlError);
        }
      } catch (error) {
        // If deletion from storage fails, continue to remove from Firestore
        console.warn('Failed to delete image from storage:', error);
      }
    }

    // Remove the heroImageUrl from Firestore
    await firestoreModule.updateDoc(docRef, {
      heroImageUrl: null,
      updatedAt: firestoreModule.serverTimestamp()
    });
  }

  /**
   * Get a collection by its custom URL.
   * @param customUrl The custom URL to look up
   * @returns The collection if found, undefined otherwise
   */
  async getCollectionByCustomUrl(customUrl: string): Promise<PromptCollection | undefined> {
    const trimmed = customUrl?.trim();
    if (!trimmed) {
      return undefined;
    }

    const { firestore, firestoreModule } = await this.getFirestoreContext();

    // Query for collection with this custom URL
    const queryRef = firestoreModule.query(
      firestoreModule.collection(firestore, 'collections'),
      firestoreModule.where('customUrl', '==', trimmed),
      firestoreModule.limit(1)
    );

    const snapshot = await firestoreModule.getDocs(queryRef);

    if (snapshot.empty) {
      return undefined;
    }

    const doc = snapshot.docs[0];
    return this.mapCollection(doc, firestoreModule);
  }

  /**
   * Check if a custom URL is already taken by a prompt or another collection.
   * This checks both prompts and collections to avoid collisions.
   * @param customUrl The custom URL to check (should already be trimmed and normalized)
   * @param excludeCollectionId Optional collection ID to exclude from the check (useful when editing)
   * @returns true if the custom URL is taken, false otherwise
   */
  async isCustomUrlTaken(customUrl: string, excludeCollectionId?: string | null): Promise<boolean> {
    const trimmed = customUrl?.trim();
    if (!trimmed) {
      return false;
    }

    const { firestore, firestoreModule } = await this.getFirestoreContext();

    // Check collections
    const collectionQueryRef = firestoreModule.query(
      firestoreModule.collection(firestore, 'collections'),
      firestoreModule.where('customUrl', '==', trimmed),
      firestoreModule.limit(1)
    );

    const collectionSnapshot = await firestoreModule.getDocs(collectionQueryRef);

    if (!collectionSnapshot.empty) {
      // If we're editing a collection, check if the found collection is the one being edited
      if (excludeCollectionId) {
        const foundDoc = collectionSnapshot.docs[0];
        if (foundDoc.id !== excludeCollectionId) {
          return true;
        }
      } else {
        return true;
      }
    }

    // Check prompts (import PromptService to check)
    const promptService = await import('./prompt.service').then(m => m.PromptService);
    // We need to create an instance, but since it's a service, we'll check directly
    // For now, let's check prompts directly here
    const promptQueryRef = firestoreModule.query(
      firestoreModule.collection(firestore, 'prompts'),
      firestoreModule.where('customUrl', '==', trimmed),
      firestoreModule.limit(1)
    );

    const promptSnapshot = await firestoreModule.getDocs(promptQueryRef);

    return !promptSnapshot.empty;
  }
}

