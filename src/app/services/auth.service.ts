import { Injectable } from '@angular/core';
import {
  Auth,
  User,
  authState,
  createUserWithEmailAndPassword,
  reload,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
  updateProfile
} from '@angular/fire/auth';
import { doc, docData, Firestore, getDoc, serverTimestamp, setDoc } from '@angular/fire/firestore';
import { catchError, map } from 'rxjs/operators';
import { Observable, of } from 'rxjs';

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
  readonly currentUser$: Observable<User | null>;

  constructor(private auth: Auth, private firestore: Firestore) {
    this.currentUser$ = authState(this.auth);
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
    return docData(doc(this.firestore, 'users', uid), { idField: 'id' }).pipe(
      map(data => (data ? (data as UserProfile) : undefined)),
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
}
