import { Injectable } from '@angular/core';
import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import type { Auth, User, UserCredential } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import { Observable, defer, from, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { environment } from '../../../environments/environments';
import type { UserProfile } from '../models/user-profile.model';

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
    await firestoreModule.setDoc(firestoreModule.doc(firestore, 'users', credential.user.uid), {
      firstName: input.firstName,
      lastName: input.lastName,
      email: credential.user.email ?? input.email,
      createdAt: firestoreModule.serverTimestamp()
    });

    await authModule.sendEmailVerification(credential.user);

    return credential;
  }

  async signIn(email: string, password: string): Promise<UserCredential> {
    const { auth, authModule } = await this.getAuthContext();
    return authModule.signInWithEmailAndPassword(auth, email, password);
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

    const { authModule } = await this.getAuthContext();
    await authModule.sendEmailVerification(user);
  }

  userProfile$(uid: string) {
    return defer(() => this.getFirestoreContext()).pipe(
      switchMap(({ firestore, firestoreModule }) =>
        from(firestoreModule.getDoc(firestoreModule.doc(firestore, 'users', uid)))
      ),
      map(snapshot => {
        if (!snapshot.exists()) {
          return undefined;
        }

        return {
          id: snapshot.id,
          ...(snapshot.data() as Omit<UserProfile, 'id'>)
        };
      }),
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
    return {
      id: snapshot.id,
      ...data
    };
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
