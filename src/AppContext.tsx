import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

interface AppContextType {
  user: User | null;
  isAuthReady: boolean;
  flatId: string | null;
  setFlatId: (id: string | null) => void;
  userProfile: any | null;
  refreshProfile: () => Promise<void>;
}

const AppContext = createContext<AppContextType>({
  user: null,
  isAuthReady: false,
  flatId: null,
  setFlatId: () => {},
  userProfile: null,
  refreshProfile: async () => {},
});

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [flatId, setFlatId] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<any | null>(null);

  const refreshProfile = async () => {
    if (!user) return;
    try {
      const userRef = doc(db, 'users', user.uid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        const data = userSnap.data();
        setUserProfile(data);
        if (data.flatId) {
          setFlatId(data.flatId);
        }
      } else {
        // Create profile if it doesn't exist
        const newProfile = {
          uid: user.uid,
          displayName: user.displayName || 'Anonymous',
          email: user.email || '',
          photoURL: user.photoURL || '',
          karma: 0,
          flatId: null
        };
        await setDoc(userRef, newProfile);
        setUserProfile(newProfile);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        try {
          const userRef = doc(db, 'users', currentUser.uid);
          const userSnap = await getDoc(userRef);
          if (userSnap.exists()) {
            const data = userSnap.data();
            setUserProfile(data);
            if (data.flatId) {
              setFlatId(data.flatId);
            }
          } else {
            const newProfile = {
              uid: currentUser.uid,
              displayName: currentUser.displayName || 'Anonymous',
              email: currentUser.email || '',
              photoURL: currentUser.photoURL || '',
              karma: 0,
              flatId: null
            };
            await setDoc(userRef, newProfile);
            setUserProfile(newProfile);
          }
        } catch (error) {
          console.error("Error fetching user profile", error);
        }
      } else {
        setUserProfile(null);
        setFlatId(null);
      }
      setIsAuthReady(true);
    });

    return () => unsubscribe();
  }, []);

  return (
    <AppContext.Provider value={{ user, isAuthReady, flatId, setFlatId, userProfile, refreshProfile }}>
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => useContext(AppContext);
