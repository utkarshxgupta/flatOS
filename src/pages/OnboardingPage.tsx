import { useState, useEffect } from 'react';
import { useAppContext } from '../AppContext';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, addDoc, doc, updateDoc, arrayUnion, getDoc, query, where, getDocs, writeBatch, deleteDoc, onSnapshot } from 'firebase/firestore';
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

  const [pendingRequest, setPendingRequest] = useState<any>(null);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'joinRequests'), where('userId', '==', user.uid), where('status', '==', 'pending'));
    const unsub = onSnapshot(q, (snap) => {
      if (!snap.empty) {
        setPendingRequest({ id: snap.docs[0].id, ...snap.docs[0].data() });
      } else {
        setPendingRequest(null);
      }
    });

    const unsubUser = onSnapshot(doc(db, 'users', user.uid), (snap) => {
      if (snap.exists() && snap.data().flatId) {
        refreshProfile(); 
      }
    });

    return () => {
      unsub();
      unsubUser();
    };
  }, [user]);

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

      await submitJoinRequest(joinCode, flatSnap.data().name);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `flats/${joinCode}`);
      toast.error('Failed to verify flat');
      setLoading(false);
    }
  };

  const submitJoinRequest = async (flatIdToJoin: string, flatName: string, dummyIdToClaim?: string) => {
    if (!user) return;
    setLoading(true);
    try {
      await addDoc(collection(db, 'joinRequests'), {
        flatId: flatIdToJoin,
        flatName,
        userId: user.uid,
        userDisplayName: user.displayName || 'Anonymous',
        userPhotoURL: user.photoURL || '',
        userEmail: user.email || '',
        dummyIdToClaim: dummyIdToClaim || null,
        status: 'pending',
        createdAt: Date.now()
      });
      toast.success('Join request sent!');
    } catch (error) {
      console.error(error);
      toast.error('Failed to send join request');
    } finally {
      setLoading(false);
      setShowClaimScreen(false);
    }
  };

  if (pendingRequest) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md rounded-3xl shadow-xl border-0 overflow-hidden">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Awaiting Approval</CardTitle>
            <CardDescription>
              Your request is pending flat admin approval.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center pb-8 pt-4">
            <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
              <div className="w-12 h-12 bg-primary rounded-full animate-pulse" />
            </div>
            <p className="font-medium text-lg">Requested to join</p>
            <p className="text-xl font-bold text-primary mt-1">{pendingRequest.flatName || 'a flat'}</p>
            <p className="text-sm text-muted-foreground mt-4">Hang tight! You'll be let in once an admin approves your request.</p>
            <Button 
              variant="outline" 
              className="mt-8 rounded-full" 
              onClick={async () => {
                await deleteDoc(doc(db, 'joinRequests', pendingRequest.id));
                setPendingRequest(null);
              }}
            >
              Cancel Request
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

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
                  onClick={() => submitJoinRequest(flatToJoin.id, flatToJoin.name, dummy.id)}
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
                onClick={() => submitJoinRequest(flatToJoin.id, flatToJoin.name)}
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
