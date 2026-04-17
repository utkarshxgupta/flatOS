import { useState } from 'react';
import { useAppContext } from '../AppContext';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, addDoc, doc, updateDoc, arrayUnion, getDoc, query, where, getDocs, writeBatch, deleteDoc } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { toast } from 'sonner';

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

export default function OnboardingPage() {
  const { user, refreshProfile } = useAppContext();
  const [isCreating, setIsCreating] = useState(true);
  const [flatName, setFlatName] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [joinCode, setJoinCode] = useState('');
  const [loading, setLoading] = useState(false);
  
  const [dummyUsers, setDummyUsers] = useState<any[]>([]);
  const [showClaimScreen, setShowClaimScreen] = useState(false);
  const [flatToJoin, setFlatToJoin] = useState<any>(null);

  const handleCreateFlat = async () => {
    if (!flatName || !user) return;
    setLoading(true);
    try {
      const flatData = {
        name: flatName,
        address: '',
        currency,
        creatorId: user.uid,
        adminId: user.uid,
        members: [user.uid]
      };
      const flatRef = await addDoc(collection(db, 'flats'), flatData);
      
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, { flatId: flatRef.id });
      
      await refreshProfile();
      toast.success('Flat created successfully!');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'flats');
      toast.error('Failed to create flat');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinFlat = async () => {
    if (!joinCode || !user) return;
    setLoading(true);
    try {
      const flatRef = doc(db, 'flats', joinCode);
      const flatSnap = await getDoc(flatRef);
      
      if (!flatSnap.exists()) {
        toast.error('Flat not found. Check the code.');
        setLoading(false);
        return;
      }

      // Check for dummy users
      const dummyQuery = query(collection(db, 'users'), where('flatId', '==', joinCode), where('isDummy', '==', true));
      const dummySnap = await getDocs(dummyQuery);
      
      if (!dummySnap.empty) {
        setDummyUsers(dummySnap.docs.map(d => ({ id: d.id, ...d.data() })));
        setFlatToJoin({ id: flatSnap.id, ...flatSnap.data() });
        setShowClaimScreen(true);
        setLoading(false);
        return;
      }

      await completeJoin(joinCode);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `flats/${joinCode}`);
      toast.error('Failed to join flat');
      setLoading(false);
    }
  };

  const completeJoin = async (flatIdToJoin: string, dummyIdToClaim?: string) => {
    if (!user) return;
    setLoading(true);
    try {
      const flatRef = doc(db, 'flats', flatIdToJoin);
      
      if (dummyIdToClaim) {
        // Claiming a dummy persona
        const batch = writeBatch(db);
        
        // 1. Update expenses where dummy paid
        const expPaidQuery = query(collection(db, 'expenses'), where('paidBy', '==', dummyIdToClaim));
        const expPaidSnap = await getDocs(expPaidQuery);
        expPaidSnap.forEach(d => batch.update(d.ref, { paidBy: user.uid }));

        // 2. Update expenses where dummy is in splitBetween
        const expSplitQuery = query(collection(db, 'expenses'), where('splitBetween', 'array-contains', dummyIdToClaim));
        const expSplitSnap = await getDocs(expSplitQuery);
        expSplitSnap.forEach(d => {
          const data = d.data();
          const newSplit = data.splitBetween.filter((id: string) => id !== dummyIdToClaim);
          newSplit.push(user.uid);
          batch.update(d.ref, { splitBetween: newSplit });
        });

        // 3. Update chores
        const choreQuery = query(collection(db, 'chores'), where('assignedTo', '==', dummyIdToClaim));
        const choreSnap = await getDocs(choreQuery);
        choreSnap.forEach(d => batch.update(d.ref, { assignedTo: user.uid }));

        // 4. Update karma logs
        const karmaQuery = query(collection(db, 'karmaLogs'), where('userId', '==', dummyIdToClaim));
        const karmaSnap = await getDocs(karmaQuery);
        karmaSnap.forEach(d => batch.update(d.ref, { userId: user.uid }));

        // 5. Update recurring expenses
        const recPaidQuery = query(collection(db, 'recurringExpenses'), where('paidBy', '==', dummyIdToClaim));
        const recPaidSnap = await getDocs(recPaidQuery);
        recPaidSnap.forEach(d => batch.update(d.ref, { paidBy: user.uid }));

        const recSplitQuery = query(collection(db, 'recurringExpenses'), where('splitBetween', 'array-contains', dummyIdToClaim));
        const recSplitSnap = await getDocs(recSplitQuery);
        recSplitSnap.forEach(d => {
          const data = d.data();
          const newSplit = data.splitBetween.filter((id: string) => id !== dummyIdToClaim);
          newSplit.push(user.uid);
          batch.update(d.ref, { splitBetween: newSplit });
        });

        // 6. Get dummy user data to transfer karma
        const dummyRef = doc(db, 'users', dummyIdToClaim);
        const dummySnap = await getDoc(dummyRef);
        const dummyKarma = dummySnap.exists() ? dummySnap.data().karma || 0 : 0;

        // 7. Delete dummy user
        batch.delete(dummyRef);

        // 8. Update flat members (remove dummy, add real)
        const flatSnap = await getDoc(flatRef);
        if (flatSnap.exists()) {
          const members = flatSnap.data().members || [];
          const newMembers = members.filter((id: string) => id !== dummyIdToClaim);
          if (!newMembers.includes(user.uid)) newMembers.push(user.uid);
          batch.update(flatRef, { members: newMembers });
        }

        // 9. Update real user
        const userRef = doc(db, 'users', user.uid);
        batch.update(userRef, { flatId: flatIdToJoin, karma: dummyKarma });

        await batch.commit();
      } else {
        // Normal join
        await updateDoc(flatRef, {
          members: arrayUnion(user.uid)
        });
        const userRef = doc(db, 'users', user.uid);
        await updateDoc(userRef, { flatId: flatIdToJoin });
      }

      await refreshProfile();
      toast.success('Joined flat successfully!');
    } catch (error) {
      console.error(error);
      toast.error('Failed to join flat');
    } finally {
      setLoading(false);
    }
  };

  if (showClaimScreen) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md rounded-3xl shadow-xl border-0 overflow-hidden">
          <CardHeader>
            <CardTitle className="text-2xl">Are you one of these people?</CardTitle>
            <CardDescription>
              Your flatmates have already added some expenses for these profiles. Claim yours to import your balances!
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              {dummyUsers.map(dummy => (
                <div 
                  key={dummy.id} 
                  className="flex items-center gap-4 p-3 rounded-2xl border bg-card hover:bg-muted/50 cursor-pointer transition-colors"
                  onClick={() => completeJoin(flatToJoin.id, dummy.id)}
                >
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={dummy.photoURL} />
                    <AvatarFallback>{dummy.displayName?.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <p className="font-medium">{dummy.displayName}</p>
                    <p className="text-xs text-muted-foreground">Import existing balances</p>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="pt-4 border-t">
              <Button 
                variant="outline" 
                className="w-full rounded-full" 
                onClick={() => completeJoin(flatToJoin.id)}
                disabled={loading}
              >
                {loading ? 'Joining...' : "None of these, I'm new"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md rounded-3xl shadow-xl border-0 overflow-hidden">
        <CardHeader className="pb-2">
          <Tabs value={isCreating ? 'create' : 'join'} onValueChange={(v) => setIsCreating(v === 'create')} className="w-full mb-4">
            <TabsList className="grid w-full grid-cols-2 bg-muted rounded-full p-1">
              <TabsTrigger value="create" className="rounded-full text-xs">Create a Flat</TabsTrigger>
              <TabsTrigger value="join" className="rounded-full text-xs">Join a Flat</TabsTrigger>
            </TabsList>
          </Tabs>
          <CardTitle className="text-2xl">{isCreating ? 'Set up your Flat' : 'Join your Flatmates'}</CardTitle>
          <CardDescription>
            {isCreating ? 'Create a new digital space for your household.' : 'Enter the invite code from your flatmate.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isCreating ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="flatName">Flat Name</Label>
                <Input id="flatName" placeholder="e.g. The Funhouse" value={flatName} onChange={(e) => setFlatName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="currency">Base Currency</Label>
                <Input id="currency" placeholder="INR, USD, EUR..." value={currency} onChange={(e) => setCurrency(e.target.value)} />
              </div>
              <Button className="w-full rounded-full mt-4" onClick={handleCreateFlat} disabled={loading || !flatName}>
                {loading ? 'Creating...' : 'Create Flat'}
              </Button>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="joinCode">Invite Code</Label>
                <Input id="joinCode" placeholder="Paste the flat ID here" value={joinCode} onChange={(e) => setJoinCode(e.target.value)} />
              </div>
              <Button className="w-full rounded-full mt-4" onClick={handleJoinFlat} disabled={loading || !joinCode}>
                {loading ? 'Joining...' : 'Join Flat'}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
