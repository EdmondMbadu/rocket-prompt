import { Injectable } from '@angular/core';
import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import type { Auth, User, UserCredential } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import { Observable, defer, from, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { environment } from '../../../environments/environments';
import type { UserPreferences, UserProfile } from '../models/user-profile.model';
import { generateDisplayUsername } from '../utils/username.util';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly app: FirebaseApp = this.ensureApp();

  private auth: Auth | null = null;
  private firestore: Firestore | null = null;
  private authModule?: typeof import('firebase/auth');
  private firestoreModule?: typeof import('firebase/firestore');

  readonly currentUser$ = new Observable<User | null>((subscriber) => {
    let unsubscribe: (() => void) | undefined;

    this.getAuthContext()
      .then(({ auth, authModule }) => {
        unsubscribe = authModule.onAuthStateChanged(
          auth,
          (user) => subscriber.next(user),
          (error) => subscriber.error(error)
        );
      })
      .catch((error) => subscriber.error(error));

    return () => unsubscribe?.();
  });

  async signUp(input: { firstName: string; lastName: string; email: string; password: string }): Promise<UserCredential> {
    const { auth, authModule } = await this.getAuthContext();
    const credential = await authModule.createUserWithEmailAndPassword(auth, input.email, input.password);

    await authModule.updateProfile(credential.user, {
      displayName: `${input.firstName} ${input.lastName}`.trim()
    });

    const { firestore, firestoreModule } = await this.getFirestoreContext();
    const username = generateDisplayUsername(input.firstName, input.lastName, credential.user.uid);
    await firestoreModule.setDoc(firestoreModule.doc(firestore, 'users', credential.user.uid), {
      userId: credential.user.uid,
      firstName: input.firstName,
      lastName: input.lastName,
      email: credential.user.email ?? input.email,
      username,
      createdAt: firestoreModule.serverTimestamp(),
      preferences: {
        sidebarCollapsed: false,
        defaultChatbot: 'chatgpt'
      }
    });

    await this.sendCustomVerificationEmail();

    return credential;
  }

  async signIn(email: string, password: string): Promise<UserCredential> {
    const { auth, authModule } = await this.getAuthContext();
    return authModule.signInWithEmailAndPassword(auth, email, password);
  }

  async signInWithGoogle(): Promise<UserCredential> {
    const { auth, authModule } = await this.getAuthContext();
    const provider = new authModule.GoogleAuthProvider();
    const credential = await authModule.signInWithPopup(auth, provider);

    // Check if user profile exists, if not create one
    const { firestore, firestoreModule } = await this.getFirestoreContext();
    const userDocRef = firestoreModule.doc(firestore, 'users', credential.user.uid);
    const userDoc = await firestoreModule.getDoc(userDocRef);

    if (!userDoc.exists()) {
      // Extract first and last name from display name
      const displayName = credential.user.displayName || '';
      const nameParts = displayName.trim().split(/\s+/);
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';
      const username = generateDisplayUsername(firstName, lastName, credential.user.uid);

      await firestoreModule.setDoc(userDocRef, {
        userId: credential.user.uid,
        firstName,
        lastName,
        email: credential.user.email ?? '',
        username,
        createdAt: firestoreModule.serverTimestamp(),
        preferences: {
          sidebarCollapsed: false,
          defaultChatbot: 'chatgpt'
        }
      });
    } else {
      // Update username if missing (for existing users)
      const userData = userDoc.data() as Omit<UserProfile, 'id'>;
      if (!userData.username) {
        const username = generateDisplayUsername(userData.firstName, userData.lastName, credential.user.uid);
        await firestoreModule.updateDoc(userDocRef, { username });
      }
    }

    return credential;
  }

  async sendPasswordResetEmail(email: string): Promise<void> {
    const { auth, authModule } = await this.getAuthContext();
    await authModule.sendPasswordResetEmail(auth, email);
  }

  async signOut(): Promise<void> {
    const { auth, authModule } = await this.getAuthContext();
    await authModule.signOut(auth);
  }

  async reloadCurrentUser(): Promise<void> {
    const user = this.currentUser;
    if (!user) {
      return;
    }

    const { authModule } = await this.getAuthContext();
    await authModule.reload(user);
  }

  async resendVerificationEmail(): Promise<void> {
    const user = this.currentUser;
    if (!user) {
      throw new Error('User is not signed in.');
    }

    await this.sendCustomVerificationEmail();
  }

  private async sendCustomVerificationEmail(): Promise<void> {
    const { auth } = await this.getAuthContext();
    if (!auth.currentUser) {
      throw new Error('User is not signed in.');
    }
    const functionsModule = await import('firebase/functions');
    const functions = functionsModule.getFunctions(this.app, 'us-central1');
    const sendVerification = functionsModule.httpsCallable(functions, 'sendVerificationEmail');
    await sendVerification({});
  }

  userProfile$(uid: string) {
    return new Observable<UserProfile | undefined>((subscriber) => {
      let unsubscribe: (() => void) | undefined;
      let usernameUpdateInProgress = false;

      this.getFirestoreContext()
        .then(({ firestore, firestoreModule }) => {
          const docRef = firestoreModule.doc(firestore, 'users', uid);
          
          unsubscribe = firestoreModule.onSnapshot(
            docRef,
            (snapshot) => {
              if (!snapshot.exists()) {
                subscriber.next(undefined);
                return;
              }

              const data = snapshot.data() as Omit<UserProfile, 'id'>;
              const profile = {
                id: snapshot.id,
                ...data
              };

              // Ensure username exists - generate and store if missing
              if (!profile.username && profile.firstName && profile.lastName && !usernameUpdateInProgress) {
                usernameUpdateInProgress = true;
                const username = generateDisplayUsername(profile.firstName, profile.lastName, profile.userId || profile.id);
                firestoreModule.updateDoc(docRef, { username })
                  .then(() => {
                    usernameUpdateInProgress = false;
                  })
                  .catch((error) => {
                    console.warn('Failed to update username:', error);
                    usernameUpdateInProgress = false;
                  });
                // Still emit the profile, username will be updated on next snapshot
                subscriber.next({ ...profile, username });
              } else {
                subscriber.next(profile);
              }
            },
            (error) => {
              console.error('Error in userProfile$:', error);
              subscriber.error(error);
            }
          );
        })
        .catch((error) => {
          console.error('Failed to get Firestore context:', error);
          subscriber.error(error);
        });

      return () => {
        if (unsubscribe) {
          unsubscribe();
        }
      };
    }).pipe(
      catchError(() => of(undefined))
    );
  }

  async fetchUserProfile(uid: string): Promise<UserProfile | undefined> {
    const { firestore, firestoreModule } = await this.getFirestoreContext();
    const snapshot = await firestoreModule.getDoc(firestoreModule.doc(firestore, 'users', uid));

    if (!snapshot.exists()) {
      return undefined;
    }

    const data = snapshot.data() as Omit<UserProfile, 'id'>;
    const profile = {
      id: snapshot.id,
      ...data
    };

    // Ensure username exists - generate and store if missing
    if (!profile.username && profile.firstName && profile.lastName) {
      const username = generateDisplayUsername(profile.firstName, profile.lastName, profile.userId || profile.id);
      const docRef = firestoreModule.doc(firestore, 'users', uid);
      await firestoreModule.updateDoc(docRef, { username });
      profile.username = username;
    }

    return profile;
  }

  async findUserByUsername(username: string): Promise<UserProfile | undefined> {
    const trimmed = username?.trim();
    if (!trimmed) {
      return undefined;
    }

    const { firestore, firestoreModule } = await this.getFirestoreContext();
    
    // Query for user with this username
    const queryRef = firestoreModule.query(
      firestoreModule.collection(firestore, 'users'),
      firestoreModule.where('username', '==', trimmed),
      firestoreModule.limit(1)
    );

    const snapshot = await firestoreModule.getDocs(queryRef);

    if (snapshot.empty) {
      return undefined;
    }

    const doc = snapshot.docs[0];
    const data = doc.data() as Omit<UserProfile, 'id'>;
    return {
      id: doc.id,
      ...data
    };
  }

  userProfileByUsername$(username: string) {
    return defer(() => this.findUserByUsername(username));
  }

  async updateUserPreferences(uid: string, preferences: Partial<UserPreferences>): Promise<void> {
    const trimmedUid = uid?.trim();

    if (!trimmedUid) {
      throw new Error('A user id is required to update preferences.');
    }

    if (!preferences || typeof preferences !== 'object' || Object.keys(preferences).length === 0) {
      return;
    }

    const { firestore, firestoreModule } = await this.getFirestoreContext();
    const docRef = firestoreModule.doc(firestore, 'users', trimmedUid);

    await firestoreModule.setDoc(
      docRef,
      {
        preferences
      },
      { merge: true }
    );
  }

  async updateSubscriptionStatus(uid: string, status: 'plus' | 'team'): Promise<void> {
    const trimmedUid = uid?.trim();

    if (!trimmedUid) {
      throw new Error('A user id is required to update subscription status.');
    }

    const { firestore, firestoreModule } = await this.getFirestoreContext();
    const docRef = firestoreModule.doc(firestore, 'users', trimmedUid);

    const updateData: Record<string, unknown> = {
      subscriptionStatus: status,
      subscriptionPaidAt: firestoreModule.serverTimestamp()
    };

    // For team/pro plan, set expiration to 1 year from now
    if (status === 'team') {
      const oneYearFromNow = new Date();
      oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
      updateData['subscriptionExpiresAt'] = firestoreModule.Timestamp.fromDate(oneYearFromNow);
    }

    await firestoreModule.updateDoc(docRef, updateData);
  }

  async uploadProfilePicture(uid: string, file: File): Promise<string> {
    const trimmedUid = uid?.trim();

    if (!trimmedUid) {
      throw new Error('A user id is required to upload a profile picture.');
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

    // Check if user is authenticated and matches the uid
    const currentUser = this.currentUser;
    if (!currentUser) {
      throw new Error('You must be logged in to upload a profile picture.');
    }

    if (currentUser.uid !== trimmedUid) {
      throw new Error('You can only upload a profile picture for your own account.');
    }

    // Import Firebase Storage
    const storageModule = await import('firebase/storage');
    const storage = storageModule.getStorage(this.app);

    // Delete old profile picture if it exists
    const { firestore, firestoreModule } = await this.getFirestoreContext();
    const docRef = firestoreModule.doc(firestore, 'users', trimmedUid);
    const docSnap = await firestoreModule.getDoc(docRef);

    if (docSnap.exists()) {
      const userData = docSnap.data() as UserProfile;
      if (userData.profilePictureUrl) {
        try {
          // Extract the path from the download URL
          const url = new URL(userData.profilePictureUrl);
          const pathMatch = url.pathname.match(/\/o\/(.+)/);
          if (pathMatch) {
            const encodedPath = pathMatch[1];
            const decodedPath = decodeURIComponent(encodedPath);
            const oldStorageRef = storageModule.ref(storage, decodedPath);
            await storageModule.deleteObject(oldStorageRef);
          }
        } catch (error) {
          // Ignore errors when deleting old image (might not exist)
          console.warn('Failed to delete old profile picture:', error);
        }
      }
    }

    // Create a unique filename
    const fileExtension = file.name.split('.').pop() || 'jpg';
    const fileName = `profile-pictures/${trimmedUid}/profile-${Date.now()}.${fileExtension}`;
    const storageRef = storageModule.ref(storage, fileName);

    // Upload the file
    await storageModule.uploadBytes(storageRef, file);

    // Get the download URL
    const downloadURL = await storageModule.getDownloadURL(storageRef);

    // Update the user profile with the new image URL
    await firestoreModule.updateDoc(docRef, {
      profilePictureUrl: downloadURL
    });

    return downloadURL;
  }

  async deleteProfilePicture(uid: string): Promise<void> {
    const trimmedUid = uid?.trim();

    if (!trimmedUid) {
      throw new Error('A user id is required to delete a profile picture.');
    }

    // Check if user is authenticated and matches the uid
    const currentUser = this.currentUser;
    if (!currentUser) {
      throw new Error('You must be logged in to delete a profile picture.');
    }

    if (currentUser.uid !== trimmedUid) {
      throw new Error('You can only delete a profile picture for your own account.');
    }

    const { firestore, firestoreModule } = await this.getFirestoreContext();
    const docRef = firestoreModule.doc(firestore, 'users', trimmedUid);
    const docSnap = await firestoreModule.getDoc(docRef);

    if (!docSnap.exists()) {
      throw new Error('User profile not found.');
    }

    const userData = docSnap.data() as UserProfile;
    const profilePictureUrl = userData.profilePictureUrl;

    if (!profilePictureUrl) {
      // No profile picture to delete
      return;
    }

    // Delete from Storage
    try {
      const storageModule = await import('firebase/storage');
      const storage = storageModule.getStorage(this.app);
      
      // Extract the path from the download URL
      // URL format: https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{encodedPath}?alt=media&token=...
      const url = new URL(profilePictureUrl);
      const pathMatch = url.pathname.match(/\/o\/(.+)/);
      if (pathMatch) {
        const encodedPath = pathMatch[1];
        const decodedPath = decodeURIComponent(encodedPath);
        const storageRef = storageModule.ref(storage, decodedPath);
        await storageModule.deleteObject(storageRef);
      }
    } catch (error) {
      console.warn('Failed to delete profile picture from storage:', error);
      // Continue to remove the URL from Firestore even if storage deletion fails
    }

    // Remove the URL from Firestore
    await firestoreModule.updateDoc(docRef, {
      profilePictureUrl: firestoreModule.deleteField()
    });
  }

  get currentUser(): User | null {
    return this.auth?.currentUser ?? null;
  }

  private async getAuthContext() {
    const authModule = await this.importAuthModule();

    if (!this.auth) {
      this.auth = authModule.getAuth(this.app);
    }

    return {
      auth: this.auth,
      authModule
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

  private async importAuthModule() {
    if (!this.authModule) {
      this.authModule = await import('firebase/auth');
    }

    return this.authModule;
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
