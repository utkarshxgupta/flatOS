import { useEffect, useState, useMemo } from 'react';
import { useAppContext } from '../AppContext';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, doc, onSnapshot, query, where, updateDoc, writeBatch, deleteDoc } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Copy, TrendingUp, Flame, Settings, UserMinus, Crown, Leaf, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from 'recharts';
import { format, parseISO, startOfMonth, subMonths, formatDistanceToNow } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { completeJoin } from '../lib/onboarding';

export default function OverviewPage() {
  const { user, flatId, userProfile } = useAppContext();
  const [flat, setFlat] = useState<any>(null);
  const [flatmates, setFlatmates] = useState<any[]>([]);
  const [totalExpenses, setTotalExpenses] = useState(0);
  const [expenseTrends, setExpenseTrends] = useState<any[]>([]);
  const [consumptionLogs, setConsumptionLogs] = useState<any[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [editFlatName, setEditFlatName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [joinRequests, setJoinRequests] = useState<any[]>([]);

  useEffect(() => {
    if (!flatId) return;

    const flatRef = doc(db, 'flats', flatId);
    const unsubFlat = onSnapshot(flatRef, (doc) => {
      if (doc.exists()) {
        const data = doc.data();
        setFlat({ id: doc.id, ...data });
        setEditFlatName(data.name);
      }
    }, (error) => handleFirestoreError(error, OperationType.GET, `flats/${flatId}`));

    const usersQuery = query(collection(db, 'users'), where('flatId', '==', flatId));
    const unsubUsers = onSnapshot(usersQuery, (snapshot) => {
      const users = snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) }));
      // Sort by karma for leaderboard
      users.sort((a, b) => (b.karma || 0) - (a.karma || 0));
      setFlatmates(users);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'users'));

    // Get Join Requests
    const reqQuery = query(collection(db, 'joinRequests'), where('flatId', '==', flatId), where('status', '==', 'pending'));
    const unsubReqs = onSnapshot(reqQuery, (snapshot) => {
      setJoinRequests(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    // Get consumption logs
    const consumptionQuery = query(collection(db, 'consumptionLogs'), where('flatId', '==', flatId));
    const unsubConsumption = onSnapshot(consumptionQuery, (snapshot) => {
      const logs = snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) }));
      logs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setConsumptionLogs(logs); // Keep all for health calculation
    });

    // Get expenses for the last 6 months for trends
    const sixMonthsAgo = subMonths(startOfMonth(new Date()), 5);
    
    const expensesQuery = query(
      collection(db, 'expenses'), 
      where('flatId', '==', flatId),
      where('date', '>=', sixMonthsAgo.toISOString())
    );
    
    const unsubExpenses = onSnapshot(expensesQuery, (snapshot) => {
      let currentMonthTotal = 0;
      const currentMonthStr = format(new Date(), 'MMM yyyy');
      
      const monthlyData: Record<string, number> = {};
      
      // Initialize last 6 months with 0
      for (let i = 5; i >= 0; i--) {
        const monthStr = format(subMonths(new Date(), i), 'MMM yyyy');
        monthlyData[monthStr] = 0;
      }

      snapshot.docs.forEach(doc => {
        const data = doc.data() as any;
        if (data.isPayment || data.title === 'Settlement Payment') return; // Settlements don't count towards burn rate
        
        const amount = data.amount || 0;
        const dateStr = format(parseISO(data.date), 'MMM yyyy');
        
        if (monthlyData[dateStr] !== undefined) {
          monthlyData[dateStr] += amount;
        }
        
        if (dateStr === currentMonthStr) {
          currentMonthTotal += amount;
        }
      });

      setTotalExpenses(currentMonthTotal);
      
      const trendsArray = Object.keys(monthlyData).map(month => ({
        name: month.split(' ')[0], // Just the short month name
        total: monthlyData[month]
      }));
      
      setExpenseTrends(trendsArray);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'expenses'));

    return () => {
      unsubFlat();
      unsubUsers();
      unsubExpenses();
      unsubConsumption();
      unsubReqs();
    };
  }, [flatId]);

  const copyInviteCode = () => {
    if (flatId) {
      navigator.clipboard.writeText(flatId);
      toast.success('Invite code copied to clipboard!');
    }
  };

  const isAdmin = !flat?.adminId || flat?.adminId === user?.uid;

  const removeFlatmate = async (mateId: string) => {
    if (!flat || !user || !isAdmin) return;
    if (mateId === user.uid) {
      toast.error("You can't remove yourself.");
      return;
    }
    
    try {
      // Remove from flat members
      const newMembers = flat.members.filter((id: string) => id !== mateId);
      await updateDoc(doc(db, 'flats', flat.id), { members: newMembers });
      
      // Remove flatId from user
      await updateDoc(doc(db, 'users', mateId), { flatId: null });
      
      toast.success('Flatmate removed.');
    } catch (error) {
      console.error(error);
      toast.error('Failed to remove flatmate.');
    }
  };

  const makeAdmin = async (mateId: string) => {
    if (!flat || !user || !isAdmin) return;
    
    try {
      await updateDoc(doc(db, 'flats', flat.id), { adminId: mateId });
      toast.success('Admin rights transferred.');
      setIsSettingsOpen(false);
    } catch (error) {
      console.error(error);
      toast.error('Failed to transfer admin rights.');
    }
  };

  const handleRenameFlat = async () => {
    if (!flat || !user || !isAdmin || !editFlatName.trim()) return;
    setRenaming(true);
    try {
      await updateDoc(doc(db, 'flats', flat.id), { name: editFlatName.trim() });
      toast.success('Flat renamed successfully.');
    } catch (error) {
      console.error(error);
      toast.error('Failed to rename flat.');
    } finally {
      setRenaming(false);
    }
  };

  const approveJoinRequest = async (request: any) => {
    if (!flatId) return;
    try {
      await completeJoin(flatId, request.userId, request.dummyIdToClaim);
      await deleteDoc(doc(db, 'joinRequests', request.id));
      toast.success(`${request.userDisplayName} has been approved and added to the flat!`);
    } catch (error) {
      console.error(error);
      toast.error('Failed to approve request');
    }
  };

  const rejectJoinRequest = async (requestId: string) => {
    try {
      await deleteDoc(doc(db, 'joinRequests', requestId));
      toast.success('Join request rejected.');
    } catch (error) {
      console.error(error);
      toast.error('Failed to reject request');
    }
  };

  // Process consumption logs for health chart
  const healthData = useMemo(() => {
    const categories: Record<string, number> = {
      'Fresh Produce': 0,
      'Protein': 0,
      'Healthy Fats': 0,
      'Processed': 0,
      'High Sugar': 0,
      'Other': 0
    };

    consumptionLogs.forEach(log => {
      const tag = log.healthTag?.toLowerCase() || '';
      if (tag.includes('fresh')) categories['Fresh Produce']++;
      else if (tag.includes('protein')) categories['Protein']++;
      else if (tag.includes('fat')) categories['Healthy Fats']++;
      else if (tag.includes('process')) categories['Processed']++;
      else if (tag.includes('sugar')) categories['High Sugar']++;
      else categories['Other']++;
    });

    return Object.entries(categories)
      .map(([name, value]) => ({ name, value }));
  }, [consumptionLogs]);

  const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#f97316', '#8b5cf6'];

  if (!flat) return <div>Loading...</div>;

  return (
    <div className="space-y-6">
      {isAdmin && joinRequests.length > 0 && (
        <Card className="border-amber-500/50 bg-amber-500/5 shadow-sm rounded-3xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg font-medium flex items-center gap-2">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
              </span>
              Pending Join Requests ({joinRequests.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {joinRequests.map(req => (
              <div key={req.id} className="flex items-center justify-between p-3 rounded-2xl bg-card border">
                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={req.userPhotoURL} />
                    <AvatarFallback>{req.userDisplayName?.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-medium text-sm">{req.userDisplayName}</p>
                    <p className="text-xs text-muted-foreground">{req.userEmail}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" className="h-8 rounded-full border-red-200 text-red-600 hover:bg-red-50" onClick={() => rejectJoinRequest(req.id)}>
                    <X size={14} className="mr-1" /> Deny
                  </Button>
                  <Button size="sm" className="h-8 rounded-full bg-primary hover:bg-primary/90" onClick={() => approveJoinRequest(req)}>
                    <Check size={14} className="mr-1" /> Approve
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">{flat.name}</h1>
            {isAdmin && (
              <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
                <DialogTrigger render={<Button variant="outline" size="sm" className="h-8 rounded-full text-xs" />}>
                  <Settings size={14} className="mr-1.5" /> Manage Flat
                </DialogTrigger>
                <DialogContent className="sm:max-w-md rounded-3xl">
                  <DialogHeader>
                    <DialogTitle>Flat Settings</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Flat Name</h4>
                      <div className="flex gap-2">
                        <Input 
                          value={editFlatName} 
                          onChange={e => setEditFlatName(e.target.value)} 
                          placeholder="Enter flat name"
                        />
                        <Button 
                          onClick={handleRenameFlat} 
                          disabled={!editFlatName.trim() || editFlatName.trim() === flat.name || renaming}
                        >
                          {renaming ? 'Saving...' : 'Save'}
                        </Button>
                      </div>
                    </div>
                    <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mt-6">Manage Members</h4>
                    <div className="space-y-3">
                      {flatmates.map(mate => (
                        <div key={mate.id} className="flex items-center justify-between p-2 rounded-xl border bg-card">
                          <div className="flex items-center gap-3">
                            <Avatar className="h-8 w-8">
                              <AvatarImage src={mate.photoURL} />
                              <AvatarFallback>{mate.displayName?.charAt(0)}</AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="text-sm font-medium flex items-center gap-1">
                                {mate.displayName}
                                {(flat.adminId === mate.id || (!flat.adminId && mate.id === user?.uid)) && <Crown size={12} className="text-amber-500" />}
                              </p>
                              {mate.isDummy && <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">Dummy</span>}
                            </div>
                          </div>
                          
                          {isAdmin && mate.id !== user?.uid && (
                            <div className="flex items-center gap-1">
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-amber-500" onClick={() => makeAdmin(mate.id)} title="Make Admin">
                                <Crown size={14} />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-500" onClick={() => removeFlatmate(mate.id)} title="Remove">
                                <UserMinus size={14} />
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </div>
          <p className="text-muted-foreground flex items-center gap-2 mt-1">
            Invite Code: <span className="font-mono bg-muted px-2 py-0.5 rounded text-sm text-foreground">{flat.id}</span>
            <button onClick={copyInviteCode} className="hover:text-primary transition-colors"><Copy size={14} /></button>
          </p>
        </div>
        <div className="flex items-center gap-3 hidden md:flex">
          <Avatar className="h-10 w-10 border-2 border-primary">
            <AvatarImage src={userProfile?.photoURL} />
            <AvatarFallback>{userProfile?.displayName?.charAt(0)}</AvatarFallback>
          </Avatar>
          <div>
            <p className="text-sm font-medium leading-none">{userProfile?.displayName}</p>
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <Flame size={12} className="text-orange-500" /> {userProfile?.karma || 0} Karma
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
        {/* Burn Rate Card */}
        <Card className="rounded-3xl shadow-sm border-0 bg-card md:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp size={18} /> Monthly Burn Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-5xl font-light tracking-tight">
              {flat.currency} {totalExpenses.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <p className="text-sm text-muted-foreground mt-2 mb-6">Total household expenses this month</p>
            
            <div className="h-[200px] w-full mt-4">
              <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={expenseTrends}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-muted)" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: 'var(--color-muted-foreground)', fontSize: 12 }} dy={10} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--color-muted-foreground)', fontSize: 12 }} dx={-10} tickFormatter={(value) => `${value}`} />
                    <Tooltip 
                      cursor={{ fill: 'var(--color-muted)', opacity: 0.4 }}
                      contentStyle={{ backgroundColor: 'var(--color-card)', borderRadius: '8px', border: '1px solid var(--color-border)' }}
                      itemStyle={{ color: 'var(--color-foreground)' }}
                      labelStyle={{ color: 'var(--color-foreground)' }}
                    />
                    <Bar dataKey="total" fill="currentColor" className="fill-primary" radius={[4, 4, 0, 0]} />
                  </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          {/* Karma Leaderboard */}
          <Card className="rounded-3xl shadow-sm border-0 bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-medium flex items-center gap-2">
                <Flame size={18} className="text-orange-500" /> Karma Leaderboard
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4 mt-2">
                {flatmates.map((mate, index) => (
                  <div key={mate.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="font-mono text-sm text-muted-foreground w-4 text-center">{index + 1}</div>
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={mate.photoURL} />
                        <AvatarFallback>{mate.displayName?.charAt(0)}</AvatarFallback>
                      </Avatar>
                      <span className="text-sm font-medium">{mate.displayName}</span>
                    </div>
                    <Badge variant={index === 0 ? "default" : "secondary"} className="font-mono">
                      {mate.karma || 0} XP
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Household Health */}
          <Card className="rounded-3xl shadow-sm border-0 bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-medium flex items-center gap-2">
                <Leaf size={18} className="text-green-500" /> Household Diet
              </CardTitle>
            </CardHeader>
            <CardContent>
              {healthData.some(d => d.value > 0) ? (
                <div className="h-[220px] w-full mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart cx="50%" cy="50%" outerRadius="70%" data={healthData}>
                      <PolarGrid stroke="var(--color-border)" />
                      <PolarAngleAxis dataKey="name" tick={{ fill: 'var(--color-muted-foreground)', fontSize: 10 }} />
                      <PolarRadiusAxis angle={30} domain={[0, 'auto']} tick={false} axisLine={false} />
                      <Radar name="Diet" dataKey="value" stroke="currentColor" className="stroke-primary fill-primary" fill="currentColor" fillOpacity={0.4} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: 'var(--color-card)', borderRadius: '8px', border: '1px solid var(--color-border)' }}
                        itemStyle={{ color: 'var(--color-foreground)' }}
                        labelStyle={{ color: 'var(--color-foreground)' }}
                      />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">No consumption data yet.</p>
              )}
            </CardContent>
          </Card>

          {/* Recent Consumption */}
          <Card className="rounded-3xl shadow-sm border-0 bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-medium flex items-center gap-2">
                Recent Consumption
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4 mt-2">
                {consumptionLogs.slice(0, 5).map((log) => {
                  const mate = flatmates.find(m => m.id === log.userId);
                  return (
                    <div key={log.id} className="flex items-start gap-3 text-sm">
                      <Avatar className="h-8 w-8 mt-0.5">
                        <AvatarImage src={mate?.photoURL} />
                        <AvatarFallback>{mate?.displayName?.charAt(0)}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <p className="leading-tight">
                          <span className="font-medium">{mate?.displayName?.split(' ')[0]}</span> consumed <span className="font-medium">{log.itemName}</span>
                          {log.quantity && <span className="text-muted-foreground"> ({log.quantity})</span>}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {formatDistanceToNow(new Date(log.date), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  );
                })}
                {consumptionLogs.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-2">No recent consumption.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
