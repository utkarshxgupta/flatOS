import { db } from '../firebase';
import { collection, doc, updateDoc, arrayUnion, getDoc, query, where, getDocs, writeBatch } from 'firebase/firestore';

export const completeJoin = async (flatIdToJoin: string, userId: string, dummyIdToClaim?: string) => {
  const flatRef = doc(db, 'flats', flatIdToJoin);
  const userRef = doc(db, 'users', userId);
  
  if (dummyIdToClaim) {
    const batch = writeBatch(db);
    
    // 1. Update expenses where dummy paid
    const expPaidQuery = query(collection(db, 'expenses'), where('flatId', '==', flatIdToJoin), where('paidBy', '==', dummyIdToClaim));
    const expPaidSnap = await getDocs(expPaidQuery);
    expPaidSnap.forEach(d => batch.update(d.ref, { paidBy: userId }));

    // 2. Update expenses where dummy is in splitBetween
    const expSplitQuery = query(collection(db, 'expenses'), where('flatId', '==', flatIdToJoin), where('splitBetween', 'array-contains', dummyIdToClaim));
    const expSplitSnap = await getDocs(expSplitQuery);
    expSplitSnap.forEach(d => {
      const data = d.data();
      const newSplit = data.splitBetween.filter((id: string) => id !== dummyIdToClaim);
      if (!newSplit.includes(userId)) newSplit.push(userId);
      batch.update(d.ref, { splitBetween: newSplit });
    });

    // 3. Update chores
    const choreQuery = query(collection(db, 'chores'), where('flatId', '==', flatIdToJoin), where('assignedTo', '==', dummyIdToClaim));
    const choreSnap = await getDocs(choreQuery);
    choreSnap.forEach(d => batch.update(d.ref, { assignedTo: userId }));

    // 4. Update karma logs
    const karmaQuery = query(collection(db, 'karmaLogs'), where('flatId', '==', flatIdToJoin), where('userId', '==', dummyIdToClaim));
    const karmaSnap = await getDocs(karmaQuery);
    karmaSnap.forEach(d => batch.update(d.ref, { userId: userId }));

    // 5. Update recurring expenses
    const recPaidQuery = query(collection(db, 'recurringExpenses'), where('flatId', '==', flatIdToJoin), where('paidBy', '==', dummyIdToClaim));
    const recPaidSnap = await getDocs(recPaidQuery);
    recPaidSnap.forEach(d => batch.update(d.ref, { paidBy: userId }));

    const recSplitQuery = query(collection(db, 'recurringExpenses'), where('flatId', '==', flatIdToJoin), where('splitBetween', 'array-contains', dummyIdToClaim));
    const recSplitSnap = await getDocs(recSplitQuery);
    recSplitSnap.forEach(d => {
      const data = d.data();
      const newSplit = data.splitBetween.filter((id: string) => id !== dummyIdToClaim);
      if (!newSplit.includes(userId)) newSplit.push(userId);
      batch.update(d.ref, { splitBetween: newSplit });
    });

    // 6. Get dummy user data to transfer karma
    const dummyRef = doc(db, 'users', dummyIdToClaim);
    const dummySnap = await getDoc(dummyRef);
    const dummyKarma = dummySnap.exists() ? dummySnap.data().karma || 0 : 0;

    // 7. Delete dummy user
    batch.delete(dummyRef);

    // 8. Update flat members (remove dummy, ensure real is there)
    const flatSnap = await getDoc(flatRef);
    if (flatSnap.exists()) {
      const members = flatSnap.data().members || [];
      const newMembers = members.filter((id: string) => id !== dummyIdToClaim);
      if (!newMembers.includes(userId)) newMembers.push(userId);
      batch.update(flatRef, { members: newMembers });
    }

    // 9. Update real user karma and flatId
    batch.update(userRef, { karma: dummyKarma, flatId: flatIdToJoin });

    await batch.commit();
  } else {
    // Normal join
    const batch = writeBatch(db);
    batch.update(flatRef, { members: arrayUnion(userId) });
    batch.update(userRef, { flatId: flatIdToJoin });
    await batch.commit();
  }
};
