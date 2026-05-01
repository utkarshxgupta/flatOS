import React, { useState, useEffect, useRef } from 'react';
import { useAppContext } from '../AppContext';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, addDoc, doc, updateDoc, arrayUnion, getDoc, query, where, getDocs, writeBatch, deleteDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { parseSplitwiseScreenshot } from '../lib/gemini';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { toast } from 'sonner';
import { Upload } from 'lucide-react';

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

export default function OnboardingPage() {
  const { user, userProfile, refreshProfile } = useAppContext();
  const [isCreating, setIsCreating] = useState(true);
  const [flatName, setFlatName] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [joinCode, setJoinCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [userName, setUserName] = useState('');

  
  const [dummyUsers, setDummyUsers] = useState<any[]>([]);
  const [showClaimScreen, setShowClaimScreen] = useState(false);
  const [flatToJoin, setFlatToJoin] = useState<any>(null);

  const [pendingRequest, setPendingRequest] = useState<any>(null);
  
  const [createdFlatId, setCreatedFlatId] = useState<string | null>(null);
  
  // Splitwise Import State
  const [splitwiseResult, setSplitwiseResult] = useState<{ personas: string[], debts: any[] } | null>(null);
  const [selectedPersonas, setSelectedPersonas] = useState<string[]>([]);
  const splitwiseInputRef = useRef<HTMLInputElement>(null);

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
        if (!window.localStorage.getItem('isCreatingFlat')) {
          refreshProfile(); 
        }
      }
    });

    return () => {
      unsub();
      unsubUser();
    };
  }, [user]);

  const handleSaveName = async () => {
    if (!user || !userName.trim()) return;
    setLoading(true);
    try {
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, { displayName: userName.trim() });
      await refreshProfile();
      toast.success("Name updated!");
    } catch(err) {
       console.error("Error updating name", err);
       toast.error("Failed to update name");
    } finally {
      setLoading(false);
    }
  }

  const handleCreateFlat = async () => {
    if (!flatName || !user) return;
    setLoading(true);
    window.localStorage.setItem('isCreatingFlat', 'true');
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
      
      setCreatedFlatId(flatRef.id);
      toast.success('Flat created successfully!');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'flats');
      toast.error('Failed to create flat');
      window.localStorage.removeItem('isCreatingFlat');
    } finally {
      setLoading(false);
    }
  };

  const handleSplitwiseUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    toast.info('Analyzing Splitwise screenshot...');
    
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64String = (reader.result as string).split(',')[1];
        const result = await parseSplitwiseScreenshot(base64String, file.type);
        
        setSplitwiseResult(result);
        setSelectedPersonas(result.personas);
        toast.success('Screenshot parsed successfully!');
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error(error);
      toast.error('Failed to parse screenshot');
    } finally {
      setLoading(false);
    }
  };

  const submitSplitwiseImport = async () => {
    if (!user || !createdFlatId || !splitwiseResult) return;
    setLoading(true);
    try {
      const personaToIdMap: Record<string, string> = {};
      
      // Since it's a new flat, the user is the only member. We'll map the current user if possible, and rest to dummy users.
      for (const personaName of selectedPersonas) {
        const isSelf = user.displayName?.toLowerCase().includes(personaName.toLowerCase()) || personaName.toLowerCase().includes(user.displayName?.toLowerCase() || 'unknown_placeholder_never_match');
        
        if (isSelf) {
          personaToIdMap[personaName] = user.uid;
        } else {
          const dummyId = `dummy_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
          await setDoc(doc(db, 'users', dummyId), {
            uid: dummyId,
            displayName: personaName,
            email: `${dummyId}@dummy.flatos`,
            photoURL: `https://api.dicebear.com/7.x/avataaars/svg?seed=${personaName}`,
            karma: 0,
            flatId: createdFlatId,
            isDummy: true
          });
          personaToIdMap[personaName] = dummyId;
        }
      }

      const getPersonaId = (name: string) => {
        const key = Object.keys(personaToIdMap).find(k => k.toLowerCase() === name.toLowerCase() || k.includes(name) || name.includes(k));
        return key ? personaToIdMap[key] : null;
      };

      for (const debt of splitwiseResult.debts) {
        // Only process if both payer and borrower were selected for import
        const payerKey = selectedPersonas.find(p => p.toLowerCase() === debt.payer.toLowerCase() || p.includes(debt.payer) || debt.payer.includes(p));
        const borrowerKey = selectedPersonas.find(p => p.toLowerCase() === debt.borrower.toLowerCase() || p.includes(debt.borrower) || debt.borrower.includes(p));

        if (payerKey && borrowerKey) {
          const payerId = getPersonaId(debt.payer);
          const borrowerId = getPersonaId(debt.borrower);
          
          if (payerId && borrowerId) {
            await addDoc(collection(db, 'expenses'), {
              flatId: createdFlatId,
              title: `Imported Balance (${debt.borrower} owes ${debt.payer})`,
              amount: Number(debt.amount) || 0,
              paidBy: payerId,
              splitBetween: [borrowerId],
              date: new Date().toISOString(),
              settled: false
            });
          }
        }
      }

      toast.success('Splitwise balances imported!');
      finishOnboarding();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'expenses');
      toast.error('Failed to import balances');
    } finally {
      setLoading(false);
    }
  };

  const finishOnboarding = async () => {
    window.localStorage.removeItem('isCreatingFlat');
    await refreshProfile();
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

  if (createdFlatId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md rounded-3xl shadow-xl border-0 overflow-hidden">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Import from Splitwise</CardTitle>
            <CardDescription>
              Bring in your existing balances from Splitwise instantly! Upload a screenshot to migrate debts.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <input 
              type="file" 
              accept="image/*" 
              className="hidden" 
              ref={splitwiseInputRef}
              onChange={handleSplitwiseUpload}
            />
            <Button 
              variant="outline" 
              className="w-full h-24 border-dashed rounded-2xl flex flex-col items-center justify-center gap-2 hover:bg-muted/50" 
              onClick={() => splitwiseInputRef.current?.click()} 
              disabled={loading}
            >
              <Upload size={24} className="text-muted-foreground" />
              <span className="text-muted-foreground">Upload Screenshot</span>
            </Button>

            {splitwiseResult && (
              <div className="bg-muted p-4 rounded-2xl text-sm">
                <h4 className="font-semibold mb-2">Select Profiles to Import:</h4>
                <div className="flex flex-wrap gap-2 mb-4">
                  {splitwiseResult.personas.map((persona, idx) => {
                    const isSelected = selectedPersonas.includes(persona);
                    return (
                      <div 
                        key={idx} 
                        onClick={() => {
                          if (isSelected) setSelectedPersonas(prev => prev.filter(p => p !== persona));
                          else setSelectedPersonas(prev => [...prev, persona]);
                        }}
                        className={`px-3 py-1.5 rounded-full border cursor-pointer transition-colors ${
                          isSelected ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted font-medium cursor-pointer'
                        }`}
                      >
                        {persona}
                      </div>
                    );
                  })}
                </div>
                <Button className="w-full rounded-full" onClick={submitSplitwiseImport} disabled={loading || selectedPersonas.length === 0}>
                  {loading ? 'Importing...' : `Import Data for ${selectedPersonas.length} People`}
                </Button>
              </div>
            )}

            <Button 
              variant="ghost" 
              className="w-full rounded-full mt-4" 
              onClick={finishOnboarding}
              disabled={loading}
            >
              Skip and go to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!userProfile?.displayName || userProfile?.displayName === 'Anonymous' || userProfile?.displayName === '') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md rounded-3xl shadow-xl border-0 overflow-hidden">
          <CardHeader className="text-center pt-8">
            <div className="mx-auto bg-primary/10 w-16 h-16 rounded-full flex items-center justify-center mb-4">
              <span className="text-2xl">👋</span>
            </div>
            <CardTitle className="text-3xl font-bold tracking-tight">Welcome to FlatOS</CardTitle>
            <CardDescription className="text-base mt-2">
              Before we get started, what should your flatmates call you?
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pb-8">
            <div className="space-y-2">
              <Label htmlFor="userName" className="text-sm font-medium text-muted-foreground ml-1">Your Name</Label>
              <Input 
                id="userName" 
                placeholder="E.g. John Doe" 
                value={userName} 
                onChange={(e) => setUserName(e.target.value)} 
                className="rounded-2xl h-14 px-4 shadow-sm text-lg"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveName();
                }}
              />
            </div>
            <Button 
               size="lg" 
               className="w-full rounded-2xl h-14 text-lg font-semibold shadow-md active:scale-[0.98] transition-transform" 
               onClick={handleSaveName} 
               disabled={loading || !userName.trim()}
            >
              {loading ? 'Saving...' : 'Continue'}
            </Button>
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
            <TabsList className="grid w-full grid-cols-2 bg-muted/70 rounded-2xl p-1 shadow-inner border border-border/40 min-h-[44px] backdrop-blur-md">
              <TabsTrigger value="create" className="rounded-xl text-xs font-semibold data-active:shadow-md data-active:bg-background transition-all">Create a Flat</TabsTrigger>
              <TabsTrigger value="join" className="rounded-xl text-xs font-semibold data-active:shadow-md data-active:bg-background transition-all">Join a Flat</TabsTrigger>
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
