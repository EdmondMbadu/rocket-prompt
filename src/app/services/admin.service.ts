import { Injectable } from '@angular/core';
import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import type { Firestore, QueryDocumentSnapshot } from 'firebase/firestore';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environments';
import type { UserProfile } from '../models/user-profile.model';

export interface AdminStats {
    totalUsers: number;
    totalPrompts: number;
    totalCollections: number;
    promptsByTag: Array<{ tag: string; count: number }>;
    collectionsByTag: Array<{ tag: string; count: number }>;
    usersByMonth: Array<{ month: string; count: number }>;
    promptsByMonth: Array<{ month: string; count: number }>;
}

export interface LaunchBaseline {
    totalLaunches: number;
    launchGpt: number;
    launchGemini: number;
    launchClaude: number;
    launchGrok: number;
    launchRocket: number;
    copied: number;
    setAt: Date;
    setBy: string;
}

@Injectable({
    providedIn: 'root'
})
export class AdminService {
    private readonly app: FirebaseApp = this.ensureApp();

    private firestore: Firestore | null = null;
    private firestoreModule?: typeof import('firebase/firestore');

    async fetchAllUsers(): Promise<UserProfile[]> {
        const { firestore, firestoreModule } = await this.getFirestoreContext();
        const usersCollection = firestoreModule.collection(firestore, 'users');
        const snapshot = await firestoreModule.getDocs(usersCollection);

        return snapshot.docs.map(doc => {
            const data = doc.data() as Omit<UserProfile, 'id'>;
            return {
                id: doc.id,
                ...data
            };
        });
    }

    users$(): Observable<UserProfile[]> {
        return new Observable<UserProfile[]>((subscriber) => {
            let unsubscribe: (() => void) | undefined;

            this.getFirestoreContext()
                .then(({ firestore, firestoreModule }) => {
                    const collectionRef = firestoreModule.collection(firestore, 'users');
                    const queryRef = firestoreModule.query(collectionRef, firestoreModule.orderBy('createdAt', 'desc'));

                    unsubscribe = firestoreModule.onSnapshot(
                        queryRef,
                        (snapshot) => {
                            const users = snapshot.docs.map((doc) => {
                                const data = doc.data() as Omit<UserProfile, 'id'>;
                                return {
                                    id: doc.id,
                                    ...data
                                };
                            });
                            subscriber.next(users);
                        },
                        (error) => subscriber.error(error)
                    );
                })
                .catch((error) => subscriber.error(error));

            return () => unsubscribe?.();
        });
    }

    async fetchAdminStats(): Promise<AdminStats> {
        const { firestore, firestoreModule } = await this.getFirestoreContext();

        // Fetch all collections in parallel
        const [usersSnapshot, promptsSnapshot, collectionsSnapshot] = await Promise.all([
            firestoreModule.getDocs(firestoreModule.collection(firestore, 'users')),
            firestoreModule.getDocs(firestoreModule.collection(firestore, 'prompts')),
            firestoreModule.getDocs(firestoreModule.collection(firestore, 'collections'))
        ]);

        const users = usersSnapshot.docs.map(doc => doc.data() as Record<string, unknown>);
        const prompts = promptsSnapshot.docs.map(doc => doc.data() as Record<string, unknown>);
        const collections = collectionsSnapshot.docs.map(doc => doc.data() as Record<string, unknown>);

        // Count prompts by tag
        const promptsByTag = new Map<string, number>();
        prompts.forEach(prompt => {
            const tag = typeof prompt['tag'] === 'string' ? prompt['tag'].toLowerCase() : 'general';
            promptsByTag.set(tag, (promptsByTag.get(tag) || 0) + 1);
        });

        // Count collections by tag
        const collectionsByTag = new Map<string, number>();
        collections.forEach(collection => {
            const tag = typeof collection['tag'] === 'string' ? collection['tag'].toLowerCase() : 'general';
            collectionsByTag.set(tag, (collectionsByTag.get(tag) || 0) + 1);
        });

        // Count users by month
        const usersByMonth = new Map<string, number>();
        users.forEach(user => {
            const createdAt = user['createdAt'];
            if (createdAt) {
                let date: Date | null = null;

                // Handle Firestore Timestamp (instance or object with seconds)
                if (createdAt && typeof createdAt === 'object') {
                    if (createdAt instanceof firestoreModule.Timestamp) {
                        date = createdAt.toDate();
                    } else if ('toDate' in createdAt && typeof (createdAt as any).toDate === 'function') {
                        date = (createdAt as any).toDate();
                    } else if ('seconds' in createdAt) {
                        // Handle raw Timestamp object { seconds: number, nanoseconds: number }
                        date = new Date((createdAt as any).seconds * 1000);
                    }
                }
                // Handle string or number
                else if (typeof createdAt === 'string' || typeof createdAt === 'number') {
                    date = new Date(createdAt);
                }

                if (date && !isNaN(date.getTime())) {
                    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                    usersByMonth.set(monthKey, (usersByMonth.get(monthKey) || 0) + 1);
                }
            }
        });

        // Count prompts by month
        const promptsByMonth = new Map<string, number>();
        prompts.forEach(prompt => {
            const createdAt = prompt['createdAt'];
            if (createdAt) {
                let date: Date | null = null;

                // Handle Firestore Timestamp (instance or object with seconds)
                if (createdAt && typeof createdAt === 'object') {
                    if (createdAt instanceof firestoreModule.Timestamp) {
                        date = createdAt.toDate();
                    } else if ('toDate' in createdAt && typeof (createdAt as any).toDate === 'function') {
                        date = (createdAt as any).toDate();
                    } else if ('seconds' in createdAt) {
                        // Handle raw Timestamp object { seconds: number, nanoseconds: number }
                        date = new Date((createdAt as any).seconds * 1000);
                    }
                }
                // Handle string or number
                else if (typeof createdAt === 'string' || typeof createdAt === 'number') {
                    date = new Date(createdAt);
                }

                if (date && !isNaN(date.getTime())) {
                    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                    promptsByMonth.set(monthKey, (promptsByMonth.get(monthKey) || 0) + 1);
                }
            }
        });

        return {
            totalUsers: users.length,
            totalPrompts: prompts.length,
            totalCollections: collections.length,
            promptsByTag: Array.from(promptsByTag.entries())
                .map(([tag, count]) => ({ tag, count }))
                .sort((a, b) => b.count - a.count),
            collectionsByTag: Array.from(collectionsByTag.entries())
                .map(([tag, count]) => ({ tag, count }))
                .sort((a, b) => b.count - a.count),
            usersByMonth: Array.from(usersByMonth.entries())
                .map(([month, count]) => ({ month, count }))
                .sort((a, b) => a.month.localeCompare(b.month)),
            promptsByMonth: Array.from(promptsByMonth.entries())
                .map(([month, count]) => ({ month, count }))
                .sort((a, b) => a.month.localeCompare(b.month))
        };
    }

    /**
     * Fetch the launch baseline from Firestore.
     * Returns null if no baseline has been set.
     */
    async fetchLaunchBaseline(): Promise<LaunchBaseline | null> {
        const { firestore, firestoreModule } = await this.getFirestoreContext();
        const docRef = firestoreModule.doc(firestore, 'adminConfig', 'launchBaseline');
        const docSnap = await firestoreModule.getDoc(docRef);

        if (!docSnap.exists()) {
            return null;
        }

        const data = docSnap.data() as Record<string, unknown>;
        const setAtValue = data['setAt'];
        let setAt: Date | undefined;

        if (setAtValue && typeof setAtValue === 'object') {
            if ('toDate' in setAtValue && typeof (setAtValue as any).toDate === 'function') {
                setAt = (setAtValue as any).toDate();
            } else if ('seconds' in setAtValue) {
                setAt = new Date((setAtValue as any).seconds * 1000);
            }
        }

        return {
            totalLaunches: typeof data['totalLaunches'] === 'number' ? data['totalLaunches'] : 0,
            launchGpt: typeof data['launchGpt'] === 'number' ? data['launchGpt'] : 0,
            launchGemini: typeof data['launchGemini'] === 'number' ? data['launchGemini'] : 0,
            launchClaude: typeof data['launchClaude'] === 'number' ? data['launchClaude'] : 0,
            launchGrok: typeof data['launchGrok'] === 'number' ? data['launchGrok'] : 0,
            launchRocket: typeof data['launchRocket'] === 'number' ? data['launchRocket'] : 0,
            copied: typeof data['copied'] === 'number' ? data['copied'] : 0,
            setAt: setAt || new Date(),
            setBy: typeof data['setBy'] === 'string' ? data['setBy'] : ''
        };
    }

    /**
     * Observable for launch baseline changes
     */
    launchBaseline$(): Observable<LaunchBaseline | null> {
        return new Observable<LaunchBaseline | null>((subscriber) => {
            let unsubscribe: (() => void) | undefined;

            this.getFirestoreContext()
                .then(({ firestore, firestoreModule }) => {
                    const docRef = firestoreModule.doc(firestore, 'adminConfig', 'launchBaseline');

                    unsubscribe = firestoreModule.onSnapshot(
                        docRef,
                        (docSnap) => {
                            if (!docSnap.exists()) {
                                subscriber.next(null);
                                return;
                            }

                            const data = docSnap.data() as Record<string, unknown>;
                            const setAtValue = data['setAt'];
                            let setAt: Date | undefined;

                            if (setAtValue && typeof setAtValue === 'object') {
                                if ('toDate' in setAtValue && typeof (setAtValue as any).toDate === 'function') {
                                    setAt = (setAtValue as any).toDate();
                                } else if ('seconds' in setAtValue) {
                                    setAt = new Date((setAtValue as any).seconds * 1000);
                                }
                            }

                            subscriber.next({
                                totalLaunches: typeof data['totalLaunches'] === 'number' ? data['totalLaunches'] : 0,
                                launchGpt: typeof data['launchGpt'] === 'number' ? data['launchGpt'] : 0,
                                launchGemini: typeof data['launchGemini'] === 'number' ? data['launchGemini'] : 0,
                                launchClaude: typeof data['launchClaude'] === 'number' ? data['launchClaude'] : 0,
                                launchGrok: typeof data['launchGrok'] === 'number' ? data['launchGrok'] : 0,
                                launchRocket: typeof data['launchRocket'] === 'number' ? data['launchRocket'] : 0,
                                copied: typeof data['copied'] === 'number' ? data['copied'] : 0,
                                setAt: setAt || new Date(),
                                setBy: typeof data['setBy'] === 'string' ? data['setBy'] : ''
                            });
                        },
                        (error) => subscriber.error(error)
                    );
                })
                .catch((error) => subscriber.error(error));

            return () => unsubscribe?.();
        });
    }

    /**
     * Save the current launch totals as the baseline.
     * This effectively "resets" the real launch count to 0.
     */
    async saveLaunchBaseline(
        baseline: Omit<LaunchBaseline, 'setAt'>,
        userId: string
    ): Promise<void> {
        const { firestore, firestoreModule } = await this.getFirestoreContext();
        const docRef = firestoreModule.doc(firestore, 'adminConfig', 'launchBaseline');

        await firestoreModule.setDoc(docRef, {
            totalLaunches: baseline.totalLaunches,
            launchGpt: baseline.launchGpt,
            launchGemini: baseline.launchGemini,
            launchClaude: baseline.launchClaude,
            launchGrok: baseline.launchGrok,
            launchRocket: baseline.launchRocket,
            copied: baseline.copied,
            setAt: firestoreModule.serverTimestamp(),
            setBy: userId
        });
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

