import { useState, useEffect } from 'react';
import { useAppContext } from '../AppContext';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, addDoc, query, where, onSnapshot, doc, updateDoc, getDoc, deleteDoc } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { CheckCircle2, Circle, Trash2, Plus, Flame, Handshake, X, Check, Edit2 } from 'lucide-react';
import { toast } from 'sonner';

export default function ChoresPage() {
  const { user, flatId } = useAppContext();
  const [chores, setChores] = useState<any[]>([]);
  const [flatmates, setFlatmates] = useState<any[]>([]);
  
  const [title, setTitle] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [karmaReward, setKarmaReward] = useState('30');
  const [loading, setLoading] = useState(false);

  // Negotiation State
  const [negotiatingChore, setNegotiatingChore] = useState<any>(null);
  const [proposedKarma, setProposedKarma] = useState(0);

  useEffect(() => {
    if (!flatId) return;

    const usersQuery = query(collection(db, 'users'), where('flatId', '==', flatId));
    const unsubUsers = onSnapshot(usersQuery, (snapshot) => {
      setFlatmates(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const choresQuery = query(collection(db, 'chores'), where('flatId', '==', flatId));
    const unsubChores = onSnapshot(choresQuery, (snapshot) => {
      const c = snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) }));
      c.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
      setChores(c);
    });

    return () => {
      unsubUsers();
      unsubChores();
    };
  }, [flatId]);

  const addChore = async () => {
    if (!title || !assignedTo || !flatId) return;
    setLoading(true);
    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      await addDoc(collection(db, 'chores'), {
        flatId,
        title,
        assignedTo,
        dueDate: tomorrow.toISOString(),
        completed: false,
        karmaReward: parseInt(karmaReward) || 30,
        status: 'pending'
      });
      toast.success('Chore added!');
      setTitle('');
      setAssignedTo('');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'chores');
      toast.error('Failed to add chore');
    } finally {
      setLoading(false);
    }
  };

  const toggleChore = async (chore: any) => {
    if (!user || !flatId) return;
    
    if (!chore.completed && chore.assignedTo !== user.uid) {
      toast.error('Only the assigned flatmate can complete this chore.');
      return;
    }

    try {
      await updateDoc(doc(db, 'chores', chore.id), { completed: !chore.completed, status: !chore.completed ? 'completed' : 'pending' });
      
      if (!chore.completed) {
        await addDoc(collection(db, 'karmaLogs'), {
          flatId,
          userId: user.uid,
          action: `Completed chore: ${chore.title}`,
          points: chore.karmaReward,
          date: new Date().toISOString()
        });
        
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          await updateDoc(userRef, { karma: (userSnap.data().karma || 0) + chore.karmaReward });
        }
        toast.success(`Chore completed! +${chore.karmaReward} Karma`);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `chores/${chore.id}`);
      toast.error('Failed to update chore');
    }
  };

  const deleteChore = async (choreId: string) => {
    try {
      await deleteDoc(doc(db, 'chores', choreId));
      toast.success('Chore deleted');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `chores/${choreId}`);
      toast.error('Failed to delete chore');
    }
  };

  const [editingChore, setEditingChore] = useState<any>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editAssignedTo, setEditAssignedTo] = useState('');
  const [editKarmaReward, setEditKarmaReward] = useState('');

  const saveEditedChore = async () => {
    if (!editingChore || !editTitle || !editAssignedTo) return;
    try {
      await updateDoc(doc(db, 'chores', editingChore.id), {
        title: editTitle,
        assignedTo: editAssignedTo,
        karmaReward: parseInt(editKarmaReward) || 30
      });
      toast.success('Chore updated');
      setEditingChore(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `chores/${editingChore.id}`);
      toast.error('Failed to update chore');
    }
  };

  const submitNegotiation = async () => {
    if (!negotiatingChore || !user) return;
    try {
      await updateDoc(doc(db, 'chores', negotiatingChore.id), {
        status: 'negotiating',
        proposedKarma,
        proposedBy: user.uid
      });
      toast.success('Karma increase requested');
      setNegotiatingChore(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `chores/${negotiatingChore.id}`);
      toast.error('Failed to request karma');
    }
  };

  const approveNegotiation = async (chore: any) => {
    try {
      await updateDoc(doc(db, 'chores', chore.id), {
        status: 'pending',
        karmaReward: chore.proposedKarma,
        proposedKarma: null,
        proposedBy: null
      });
      toast.success('Karma request approved');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `chores/${chore.id}`);
      toast.error('Failed to approve request');
    }
  };

  const rejectNegotiation = async (chore: any) => {
    try {
      await updateDoc(doc(db, 'chores', chore.id), {
        status: 'pending',
        proposedKarma: null,
        proposedBy: null
      });
      toast.success('Karma request rejected');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `chores/${chore.id}`);
      toast.error('Failed to reject request');
    }
  };

  const reassignChore = async (chore: any) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'chores', chore.id), {
        assignedTo: user.uid,
        status: 'pending',
        proposedKarma: null,
        proposedBy: null
      });
      toast.success('You took over this chore');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `chores/${chore.id}`);
      toast.error('Failed to reassign chore');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Chores & Quests</h1>
        <p className="text-muted-foreground mt-1">Keep the house clean and earn Karma.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Chores List */}
        <Card className="rounded-3xl shadow-sm border-0 bg-card md:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg font-medium">Household Tasks</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {chores.map(chore => {
                const assignee = flatmates.find(m => m.id === chore.assignedTo);
                const isNegotiating = chore.status === 'negotiating';
                
                return (
                  <div key={chore.id} className={`flex flex-col p-4 rounded-2xl border transition-all ${chore.completed ? 'bg-muted/50 border-border opacity-60' : isNegotiating ? 'bg-orange-50/50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-900' : 'bg-card border-border shadow-sm'}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <button onClick={() => toggleChore(chore)} disabled={isNegotiating} className={`transition-colors ${chore.completed ? 'text-primary' : isNegotiating ? 'text-muted-foreground opacity-50 cursor-not-allowed' : 'text-muted-foreground hover:text-primary'}`}>
                          {chore.completed ? <CheckCircle2 size={24} /> : <Circle size={24} />}
                        </button>
                        <div>
                          <p className={`font-medium ${chore.completed ? 'line-through text-muted-foreground' : ''}`}>{chore.title}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <Avatar className="h-5 w-5">
                              <AvatarImage src={assignee?.photoURL} />
                              <AvatarFallback>{assignee?.displayName?.charAt(0)}</AvatarFallback>
                            </Avatar>
                            <span className="text-xs text-muted-foreground">{assignee?.displayName}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Badge variant="secondary" className={`font-mono ${isNegotiating ? 'text-muted-foreground line-through' : 'text-orange-500 bg-orange-50 dark:bg-orange-950/50'}`}>
                          +{chore.karmaReward} XP
                        </Badge>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary" onClick={() => {
                          setEditingChore(chore);
                          setEditTitle(chore.title);
                          setEditAssignedTo(chore.assignedTo);
                          setEditKarmaReward(chore.karmaReward.toString());
                        }}>
                          <Edit2 size={14} />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-red-500" onClick={() => deleteChore(chore.id)}>
                          <Trash2 size={16} />
                        </Button>
                      </div>
                    </div>

                    {/* Negotiation UI */}
                    {!chore.completed && chore.assignedTo === user?.uid && chore.status !== 'negotiating' && (
                      <div className="mt-3 pl-10">
                        <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-orange-500" onClick={() => {
                          setProposedKarma(chore.karmaReward + 10);
                          setNegotiatingChore(chore);
                        }}>
                          <Handshake size={12} className="mr-1" /> Request more Karma
                        </Button>
                      </div>
                    )}

                    {isNegotiating && (
                      <div className="mt-4 pl-10 pr-2">
                        <div className="bg-background rounded-xl p-3 border border-border text-sm">
                          <p className="font-medium text-orange-500 flex items-center gap-1 mb-2">
                            <Flame size={14} /> {assignee?.displayName?.split(' ')[0]} wants {chore.proposedKarma} XP for this
                          </p>
                          {chore.assignedTo !== user?.uid ? (
                            <div className="flex flex-wrap gap-2 mt-3">
                              <Button size="sm" variant="default" className="h-7 text-xs rounded-full" onClick={() => approveNegotiation(chore)}>
                                <Check size={12} className="mr-1" /> Approve
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 text-xs rounded-full" onClick={() => rejectNegotiation(chore)}>
                                <X size={12} className="mr-1" /> Reject
                              </Button>
                              <Button size="sm" variant="secondary" className="h-7 text-xs rounded-full" onClick={() => reassignChore(chore)}>
                                I'll do it instead
                              </Button>
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">Waiting for flatmates to approve...</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {chores.length === 0 && (
                <p className="text-center text-muted-foreground py-8">No chores assigned. Enjoy the peace!</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Add Chore Form */}
        <Card className="rounded-3xl shadow-sm border-0 bg-card h-fit">
          <CardHeader>
            <CardTitle className="text-lg font-medium">Assign a Task</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Task Description</Label>
              <Input placeholder="e.g. Take out the trash" value={title} onChange={e => setTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Assign To</Label>
              <div className="flex flex-wrap gap-2 pt-1">
                {flatmates.map(mate => (
                  <button
                    key={mate.id}
                    onClick={() => setAssignedTo(mate.id)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-colors ${
                      assignedTo === mate.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    }`}
                  >
                    <Avatar className="h-5 w-5">
                      <AvatarImage src={mate.photoURL} />
                      <AvatarFallback>{mate.displayName?.charAt(0)}</AvatarFallback>
                    </Avatar>
                    {mate.displayName?.split(' ')[0]}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Karma Reward</Label>
              <div className="flex items-center gap-2">
                <Flame size={16} className="text-orange-500" />
                <Input type="number" placeholder="30" value={karmaReward} onChange={e => setKarmaReward(e.target.value)} className="w-24" />
                <span className="text-sm text-muted-foreground">XP</span>
              </div>
            </div>
            <Button className="w-full rounded-full mt-2" onClick={addChore} disabled={loading || !title || !assignedTo}>
              <Plus size={16} className="mr-2" /> Add Task
            </Button>
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!negotiatingChore} onOpenChange={(open) => !open && setNegotiatingChore(null)}>
        <DialogContent className="sm:max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle>Negotiate Karma</DialogTitle>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <Label>How much Karma is this worth?</Label>
                <span className="font-medium text-orange-500 flex items-center gap-1">
                  <Flame size={16} /> {proposedKarma} XP
                </span>
              </div>
              <Slider 
                value={[proposedKarma]} 
                onValueChange={(v: any) => setProposedKarma(Array.isArray(v) ? v[0] : v)} 
                min={negotiatingChore?.karmaReward || 0}
                max={(negotiatingChore?.karmaReward || 0) + 100} 
                step={5} 
                className="py-4"
              />
              <p className="text-xs text-muted-foreground text-center">
                Your flatmates will need to approve this increase.
              </p>
            </div>
            <Button className="w-full rounded-full" onClick={submitNegotiation}>
              Submit Request
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingChore} onOpenChange={(open) => !open && setEditingChore(null)}>
        <DialogContent className="sm:max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle>Edit Task</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Task Description</Label>
              <Input placeholder="e.g. Take out the trash" value={editTitle} onChange={e => setEditTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Assign To</Label>
              <div className="flex flex-wrap gap-2 pt-1">
                {flatmates.map(mate => (
                  <button
                    key={mate.id}
                    onClick={() => setEditAssignedTo(mate.id)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-colors ${
                      editAssignedTo === mate.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    }`}
                  >
                    <Avatar className="h-5 w-5">
                      <AvatarImage src={mate.photoURL} />
                      <AvatarFallback>{mate.displayName?.charAt(0)}</AvatarFallback>
                    </Avatar>
                    {mate.displayName?.split(' ')[0]}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Karma Reward</Label>
              <div className="flex items-center gap-2">
                <Flame size={16} className="text-orange-500" />
                <Input type="number" placeholder="30" value={editKarmaReward} onChange={e => setEditKarmaReward(e.target.value)} className="w-24" />
                <span className="text-sm text-muted-foreground">XP</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button className="w-full rounded-full" onClick={saveEditedChore} disabled={!editTitle || !editAssignedTo}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
