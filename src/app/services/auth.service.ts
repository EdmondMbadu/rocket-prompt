import { Injectable } from '@angular/core';
import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import {
  Auth,
  User,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
  updateProfile
} from 'firebase/auth';
import {
  Firestore,
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc
} from 'firebase/firestore';
import { Observable, from, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../environments/environments';

export interface UserProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly app: FirebaseApp;
  private readonly auth: Auth;
  private readonly firestore: Firestore;

  readonly currentUser$: Observable<User | null>;

  constructor() {
    this.app = this.ensureApp();
    this.auth = getAuth(this.app);
    this.firestore = getFirestore(this.app);
    this.currentUser$ = new Observable<User | null>((subscriber) => {
      const unsubscribe = onAuthStateChanged(
        this.auth,
        (user) => subscriber.next(user),
        (error) => subscriber.error(error)
      );

      return () => unsubscribe();
    });
  }

  async signUp(input: { firstName: string; lastName: string; email: string; password: string }) {
    const credential = await createUserWithEmailAndPassword(this.auth, input.email, input.password);

    await updateProfile(credential.user, {
      displayName: `${input.firstName} ${input.lastName}`.trim()
    });

    await setDoc(doc(this.firestore, 'users', credential.user.uid), {
      firstName: input.firstName,
      lastName: input.lastName,
      email: credential.user.email ?? input.email,
      createdAt: serverTimestamp()
    });

    await sendEmailVerification(credential.user);

    return credential;
  }

  signIn(email: string, password: string) {
    return signInWithEmailAndPassword(this.auth, email, password);
  }

  signOut() {
    return signOut(this.auth);
  }

  async reloadCurrentUser() {
    if (this.auth.currentUser) {
      await reload(this.auth.currentUser);
    }
  }

  async resendVerificationEmail() {
    if (!this.auth.currentUser) {
      throw new Error('User is not signed in.');
    }

    await sendEmailVerification(this.auth.currentUser);
  }

  userProfile$(uid: string): Observable<UserProfile | undefined> {
    return from(getDoc(doc(this.firestore, 'users', uid))).pipe(
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
    const snapshot = await getDoc(doc(this.firestore, 'users', uid));
    if (!snapshot.exists()) {
      return undefined;
    }

    const data = snapshot.data() as Omit<UserProfile, 'id'>;
    return {
      id: snapshot.id,
      ...data
    };
  }

  get currentUser() {
    return this.auth.currentUser;
  }

  private ensureApp(): FirebaseApp {
    if (getApps().length) {
      return getApp();
    }

    return initializeApp(environment.firebase);
  }
}
