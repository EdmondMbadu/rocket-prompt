import { Injectable } from '@angular/core';
import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import type { Firestore, QueryDocumentSnapshot } from 'firebase/firestore';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environments';
import type { CreateOrganizationInput, Organization, UpdateOrganizationInput } from '../models/organization.model';

@Injectable({
  providedIn: 'root'
})
export class OrganizationService {
  private readonly app: FirebaseApp = this.ensureApp();

  private firestore: Firestore | null = null;
  private firestoreModule?: typeof import('firebase/firestore');

  /**
   * Get organization by ID
   */
  organization$(id: string): Observable<Organization | undefined> {
    return new Observable<Organization | undefined>((subscriber) => {
      let unsubscribe: (() => void) | undefined;

      const trimmedId = id?.trim();
      if (!trimmedId) {
        subscriber.next(undefined);
        return () => unsubscribe?.();
      }

      this.getFirestoreContext()
        .then(({ firestore, firestoreModule }) => {
          const docRef = firestoreModule.doc(firestore, 'organizations', trimmedId);

          unsubscribe = firestoreModule.onSnapshot(
            docRef,
            (snapshot) => {
              if (!snapshot.exists()) {
                subscriber.next(undefined);
                return;
              }
              const organization = this.mapOrganization(snapshot as QueryDocumentSnapshot, firestoreModule);
              subscriber.next(organization);
            },
            (error) => subscriber.error(error)
          );
        })
        .catch((error) => subscriber.error(error));

      return () => unsubscribe?.();
    });
  }

  /**
   * Get organization by username
   */
  organizationByUsername$(username: string): Observable<Organization | undefined> {
    return new Observable<Organization | undefined>((subscriber) => {
      let unsubscribe: (() => void) | undefined;

      const trimmedUsername = username?.trim();
      if (!trimmedUsername) {
        subscriber.next(undefined);
        return () => unsubscribe?.();
      }

      this.getFirestoreContext()
        .then(({ firestore, firestoreModule }) => {
          const collectionRef = firestoreModule.collection(firestore, 'organizations');
          const queryRef = firestoreModule.query(
            collectionRef,
            firestoreModule.where('username', '==', trimmedUsername),
            firestoreModule.limit(1)
          );

          unsubscribe = firestoreModule.onSnapshot(
            queryRef,
            (snapshot) => {
              if (snapshot.empty) {
                subscriber.next(undefined);
                return;
              }
              const organization = this.mapOrganization(snapshot.docs[0], firestoreModule);
              subscriber.next(organization);
            },
            (error) => subscriber.error(error)
          );
        })
        .catch((error) => subscriber.error(error));

      return () => unsubscribe?.();
    });
  }

  /**
   * Get organizations created by a user
   */
  organizationsByCreator$(userId: string): Observable<Organization[]> {
    return new Observable<Organization[]>((subscriber) => {
      let unsubscribe: (() => void) | undefined;

      const trimmedUserId = userId?.trim();
      if (!trimmedUserId) {
        subscriber.next([]);
        return () => unsubscribe?.();
      }

      this.getFirestoreContext()
        .then(({ firestore, firestoreModule }) => {
          const collectionRef = firestoreModule.collection(firestore, 'organizations');
          const queryRef = firestoreModule.query(
            collectionRef,
            firestoreModule.where('createdBy', '==', trimmedUserId),
            firestoreModule.orderBy('createdAt', 'desc')
          );

          unsubscribe = firestoreModule.onSnapshot(
            queryRef,
            (snapshot) => {
              const organizations = snapshot.docs.map((doc) => this.mapOrganization(doc, firestoreModule));
              subscriber.next(organizations);
            },
            (error) => subscriber.error(error)
          );
        })
        .catch((error) => subscriber.error(error));

      return () => unsubscribe?.();
    });
  }

  /**
   * Get organizations where user is a member
   */
  organizationsByMember$(userId: string): Observable<Organization[]> {
    return new Observable<Organization[]>((subscriber) => {
      let unsubscribe: (() => void) | undefined;

      const trimmedUserId = userId?.trim();
      if (!trimmedUserId) {
        subscriber.next([]);
        return () => unsubscribe?.();
      }

      this.getFirestoreContext()
        .then(({ firestore, firestoreModule }) => {
          const collectionRef = firestoreModule.collection(firestore, 'organizations');
          const queryRef = firestoreModule.query(
            collectionRef,
            firestoreModule.where('members', 'array-contains', trimmedUserId),
            firestoreModule.orderBy('createdAt', 'desc')
          );

          unsubscribe = firestoreModule.onSnapshot(
            queryRef,
            (snapshot) => {
              const organizations = snapshot.docs.map((doc) => this.mapOrganization(doc, firestoreModule));
              subscriber.next(organizations);
            },
            (error) => subscriber.error(error)
          );
        })
        .catch((error) => subscriber.error(error));

      return () => unsubscribe?.();
    });
  }

  /**
   * Create a new organization
   */
  async createOrganization(input: CreateOrganizationInput, createdBy: string): Promise<string> {
    const name = input.name?.trim();
    const createdByTrimmed = createdBy?.trim();

    if (!name) {
      throw new Error('A name is required to create an organization.');
    }

    if (!createdByTrimmed) {
      throw new Error('A creator ID is required to create an organization.');
    }

    const { firestore, firestoreModule } = await this.getFirestoreContext();

    // Validate username if provided
    const username = input.username?.trim();
    if (username) {
      if (!/^[a-z0-9-]+$/i.test(username)) {
        throw new Error('Username can only contain letters, numbers, and hyphens.');
      }

      const isTaken = await this.isUsernameTaken(username);
      if (isTaken) {
        throw new Error('This username is already taken. Please choose a different one.');
      }
    }

    const timestamp = firestoreModule.serverTimestamp();
    const members = [createdByTrimmed]; // Creator is automatically a member

    const payload: Record<string, unknown> = {
      name,
      createdBy: createdByTrimmed,
      members,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    if (input.description) {
      payload['description'] = input.description.trim();
    }

    if (input.logoUrl) {
      payload['logoUrl'] = input.logoUrl.trim();
    }

    if (input.coverImageUrl) {
      payload['coverImageUrl'] = input.coverImageUrl.trim();
    }

    if (username) {
      payload['username'] = username;
    }

    const docRef = await firestoreModule.addDoc(firestoreModule.collection(firestore, 'organizations'), payload);

    return docRef.id;
  }

  /**
   * Update an organization
   */
  async updateOrganization(id: string, input: UpdateOrganizationInput, userId: string): Promise<void> {
    const trimmedId = id?.trim();
    const trimmedUserId = userId?.trim();

    if (!trimmedId) {
      throw new Error('An organization id is required to update an organization.');
    }

    if (!trimmedUserId) {
      throw new Error('A user ID is required to update an organization.');
    }

    const { firestore, firestoreModule } = await this.getFirestoreContext();

    // Fetch the existing organization to check permissions
    const docRef = firestoreModule.doc(firestore, 'organizations', trimmedId);
    const docSnap = await firestoreModule.getDoc(docRef);

    if (!docSnap.exists()) {
      throw new Error('Organization not found.');
    }

    const existingData = docSnap.data() as Record<string, unknown>;
    const existingCreatedBy = typeof existingData['createdBy'] === 'string' ? existingData['createdBy'] : '';
    const existingMembers = Array.isArray(existingData['members']) ? existingData['members'] as string[] : [];

    // Check if user is the creator or a member
    if (existingCreatedBy !== trimmedUserId && !existingMembers.includes(trimmedUserId)) {
      throw new Error('You do not have permission to update this organization.');
    }

    const updatePayload: Record<string, unknown> = {
      updatedAt: firestoreModule.serverTimestamp()
    };

    if (input.name) {
      updatePayload['name'] = input.name.trim();
    }

    if (input.description !== undefined) {
      if (input.description) {
        updatePayload['description'] = input.description.trim();
      } else {
        updatePayload['description'] = firestoreModule.deleteField();
      }
    }

    if (input.logoUrl !== undefined) {
      if (input.logoUrl) {
        updatePayload['logoUrl'] = input.logoUrl.trim();
      } else {
        updatePayload['logoUrl'] = firestoreModule.deleteField();
      }
    }

    if (input.coverImageUrl !== undefined) {
      if (input.coverImageUrl) {
        updatePayload['coverImageUrl'] = input.coverImageUrl.trim();
      } else {
        updatePayload['coverImageUrl'] = firestoreModule.deleteField();
      }
    }

    if (input.username !== undefined) {
      const username = input.username?.trim();
      if (username) {
        if (!/^[a-z0-9-]+$/i.test(username)) {
          throw new Error('Username can only contain letters, numbers, and hyphens.');
        }

        const isTaken = await this.isUsernameTaken(username, trimmedId);
        if (isTaken) {
          throw new Error('This username is already taken. Please choose a different one.');
        }

        updatePayload['username'] = username;
      } else {
        updatePayload['username'] = firestoreModule.deleteField();
      }
    }

    if (input.members !== undefined) {
      // Only creator can update members
      if (existingCreatedBy !== trimmedUserId) {
        throw new Error('Only the organization creator can update members.');
      }
      updatePayload['members'] = input.members;
    }

    await firestoreModule.updateDoc(docRef, updatePayload);
  }

  /**
   * Check if a username is already taken
   */
  async isUsernameTaken(username: string, excludeOrganizationId?: string): Promise<boolean> {
    const trimmed = username?.trim();
    if (!trimmed) {
      return false;
    }

    const { firestore, firestoreModule } = await this.getFirestoreContext();

    const collectionRef = firestoreModule.collection(firestore, 'organizations');
    const queryRef = firestoreModule.query(
      collectionRef,
      firestoreModule.where('username', '==', trimmed),
      firestoreModule.limit(1)
    );

    const snapshot = await firestoreModule.getDocs(queryRef);

    if (snapshot.empty) {
      return false;
    }

    // If we're editing an organization, check if the found organization is the one being edited
    if (excludeOrganizationId) {
      const foundDoc = snapshot.docs[0];
      return foundDoc.id !== excludeOrganizationId;
    }

    return true;
  }

  /**
   * Fetch organization by ID (one-time fetch, not observable)
   */
  async fetchOrganization(id: string): Promise<Organization | undefined> {
    const trimmed = id?.trim();
    if (!trimmed) {
      return undefined;
    }

    const { firestore, firestoreModule } = await this.getFirestoreContext();
    const docRef = firestoreModule.doc(firestore, 'organizations', trimmed);
    const docSnap = await firestoreModule.getDoc(docRef);

    if (!docSnap.exists()) {
      return undefined;
    }

    return this.mapOrganization(docSnap as QueryDocumentSnapshot, firestoreModule);
  }

  /**
   * Fetch organization by username (one-time fetch, not observable)
   */
  async fetchOrganizationByUsername(username: string): Promise<Organization | undefined> {
    const trimmed = username?.trim();
    if (!trimmed) {
      return undefined;
    }

    const { firestore, firestoreModule } = await this.getFirestoreContext();
    const collectionRef = firestoreModule.collection(firestore, 'organizations');
    const queryRef = firestoreModule.query(
      collectionRef,
      firestoreModule.where('username', '==', trimmed),
      firestoreModule.limit(1)
    );

    const snapshot = await firestoreModule.getDocs(queryRef);

    if (snapshot.empty) {
      return undefined;
    }

    return this.mapOrganization(snapshot.docs[0], firestoreModule);
  }

  private mapOrganization(
    doc: QueryDocumentSnapshot,
    firestoreModule: typeof import('firebase/firestore')
  ): Organization {
    const data = doc.data() as Record<string, unknown>;

    const nameValue = data['name'];
    const descriptionValue = data['description'];
    const logoUrlValue = data['logoUrl'];
    const coverImageUrlValue = data['coverImageUrl'];
    const createdByValue = data['createdBy'];
    const membersValue = data['members'];
    const usernameValue = data['username'];
    const createdAtValue = data['createdAt'];
    const updatedAtValue = data['updatedAt'];

    return {
      id: doc.id,
      name: typeof nameValue === 'string' ? nameValue : '',
      description: typeof descriptionValue === 'string' ? descriptionValue : undefined,
      logoUrl: typeof logoUrlValue === 'string' ? logoUrlValue : undefined,
      coverImageUrl: typeof coverImageUrlValue === 'string' ? coverImageUrlValue : undefined,
      createdBy: typeof createdByValue === 'string' ? createdByValue : '',
      members: Array.isArray(membersValue) ? membersValue.filter((m): m is string => typeof m === 'string') : [],
      username: typeof usernameValue === 'string' ? usernameValue : undefined,
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
}

