import { motion, AnimatePresence } from 'motion/react';
import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { Home, Receipt, Package, CheckSquare, LogOut, Moon, Sun, Download, UserCircle, Settings, MessageSquare, Shield, Menu, X as XIcon } from 'lucide-react';
import { logOut, db, handleFirestoreError, OperationType } from '../firebase';
import { doc, updateDoc, collection, query, where, onSnapshot } from 'firebase/firestore';
import { useAppContext } from '../AppContext';
import { Button } from '@/components/ui/button';
import { useTheme } from '../components/theme-provider';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { toast } from 'sonner';

export default function DashboardLayout() {
  const { theme, setTheme } = useTheme();
  const { userProfile, refreshProfile, user, flatId } = useAppContext();
  const location = useLocation();
  const [showPWA, setShowPWA] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  
  // Profile Edit State
  const [editName, setEditName] = useState(userProfile?.displayName || '');
  const [editAvatar, setEditAvatar] = useState(userProfile?.photoURL || '');
  const [isSaving, setIsSaving] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Notification State
  const [latestBoardTime, setLatestBoardTime] = useState(0);
  const [latestExpenseTime, setLatestExpenseTime] = useState(0);
  const [pendingChoresCount, setPendingChoresCount] = useState(0);

  const [lastSeenBoard, setLastSeenBoard] = useState(Number(localStorage.getItem('lastSeenBoard')) || 0);
  const [lastSeenExpenses, setLastSeenExpenses] = useState(Number(localStorage.getItem('lastSeenExpenses')) || 0);
  const [lastSeenChoresCount, setLastSeenChoresCount] = useState(Number(localStorage.getItem('lastSeenChoresCount')) || 0);

  useEffect(() => {
    if (location.pathname === '/dashboard/board') {
      const now = Date.now();
      localStorage.setItem('lastSeenBoard', now.toString());
      setLastSeenBoard(now);
    } else if (location.pathname === '/dashboard/expenses') {
      const now = Date.now();
      localStorage.setItem('lastSeenExpenses', now.toString());
      setLastSeenExpenses(now);
    } else if (location.pathname === '/dashboard/chores') {
      localStorage.setItem('lastSeenChoresCount', pendingChoresCount.toString());
      setLastSeenChoresCount(pendingChoresCount);
    }
  }, [location.pathname, pendingChoresCount]);

  useEffect(() => {
    if (!flatId || !user) return;

    // Board Notifications
    const boardQ = query(collection(db, 'notices'), where('flatId', '==', flatId));
    const unsubBoard = onSnapshot(boardQ, (snap) => {
      let maxTime = 0;
      snap.docs.forEach(doc => {
        const time = new Date(doc.data().date).getTime();
        if (time > maxTime) maxTime = time;
      });
      setLatestBoardTime(maxTime);
    });

    // Expense Notifications
    const expQ = query(collection(db, 'expenses'), where('flatId', '==', flatId));
    const unsubExp = onSnapshot(expQ, (snap) => {
      let maxTime = 0;
      snap.docs.forEach(doc => {
        const data = doc.data();
        if (data.paidBy !== user.uid) {
          const time = new Date(data.date).getTime();
          if (time > maxTime) maxTime = time;
        }
      });
      setLatestExpenseTime(maxTime);
    });

    // Chores Notifications
    const choresQ = query(collection(db, 'chores'), where('flatId', '==', flatId), where('assignedTo', '==', user.uid));
    const unsubChores = onSnapshot(choresQ, (snap) => {
      let count = 0;
      snap.docs.forEach(doc => {
        if (!doc.data().completed) count++;
      });
      setPendingChoresCount(count);
    });

    return () => {
      unsubBoard();
      unsubExp();
      unsubChores();
    };
  }, [flatId, user]);

  const hasNewBoard = latestBoardTime > lastSeenBoard;
  const hasNewExpenses = latestExpenseTime > lastSeenExpenses;
  const hasNewChores = pendingChoresCount > lastSeenChoresCount;

  useEffect(() => {
    setEditName(userProfile?.displayName || '');
    setEditAvatar(userProfile?.photoURL || '');
  }, [userProfile]);

  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowPWA(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    
    const isIos = () => {
      const userAgent = window.navigator.userAgent.toLowerCase();
      return /iphone|ipad|ipod/.test(userAgent);
    };
    const isInStandaloneMode = () => ('standalone' in window.navigator) && (window.navigator as any).standalone;
    
    if (isIos() && !isInStandaloneMode()) {
      setShowPWA(true);
    }

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const installPWA = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setShowPWA(false);
      }
      setDeferredPrompt(null);
    } else {
      toast.info("To install on iOS: tap the Share button and select 'Add to Home Screen'");
      setShowPWA(false);
    }
  };

  const saveProfile = async () => {
    if (!user) return;
    setIsSaving(true);
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        displayName: editName,
        photoURL: editAvatar
      });
      await refreshProfile();
      toast.success("Profile updated");
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
      toast.error("Failed to update profile");
    } finally {
      setIsSaving(false);
    }
  };

  const generateAvatar = () => {
    const seed = Math.random().toString(36).substring(7);
    setEditAvatar(`https://api.dicebear.com/7.x/notionists/svg?seed=${seed}`);
  };

  const navItems = [
    { to: '/dashboard', icon: Home, label: 'Overview', end: true },
    { to: '/dashboard/board', icon: MessageSquare, label: 'Board', hasDot: hasNewBoard },
    { to: '/dashboard/expenses', icon: Receipt, label: 'Expenses', hasDot: hasNewExpenses },
    { to: '/dashboard/pantry', icon: Package, label: 'Pantry' },
    { to: '/dashboard/chores', icon: CheckSquare, label: 'Chores', hasDot: hasNewChores },
    { to: '/dashboard/vault', icon: Shield, label: 'Vault' },
  ];

  const mobilePrimaryNav = [
    { to: '/dashboard', icon: Home, label: 'Home', end: true },
    { to: '/dashboard/expenses', icon: Receipt, label: 'Expenses', hasDot: hasNewExpenses },
    { to: '/dashboard/pantry', icon: Package, label: 'Pantry' },
  ];

  const mobileMoreNav = [
    { to: '/dashboard/board', icon: MessageSquare, label: 'Notice Board', hasDot: hasNewBoard },
    { to: '/dashboard/chores', icon: CheckSquare, label: 'Chores', hasDot: hasNewChores },
    { to: '/dashboard/vault', icon: Shield, label: 'Vault' },
  ];

  return (
    <div className="h-screen overflow-hidden bg-background flex flex-col md:flex-row font-sans text-foreground">
      {/* Sidebar for Desktop */}
      <aside className="hidden md:flex w-64 flex-col bg-card backdrop-blur-2xl border-r border-white/20 dark:border-white/10 relative z-10">
        <div className="p-6 flex items-center justify-between">
          <h1 className="text-3xl tracking-tight flex items-baseline">
            <span className="italic font-normal mr-1.5" style={{ fontFamily: '"IM Fell English", serif' }}>Flat</span>
            <span className="not-italic font-normal" style={{ fontFamily: '"IM Fell English", serif' }}>OS</span>
          </h1>
          <Button variant="ghost" size="icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </Button>
        </div>
        <nav className="flex-1 px-4 space-y-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `relative flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${
                  isActive ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`
              }
            >
              <div className="relative">
                <item.icon size={20} />
                {item.hasDot && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-card"></span>}
              </div>
              {item.label}
            </NavLink>
          ))}
        </nav>
        
        <div className="p-4 border-t border-border space-y-2">
          <Dialog>
            <DialogTrigger render={<Button variant="ghost" className="w-full justify-start text-muted-foreground" />}>
                <Settings size={20} className="mr-3" />
                Profile Settings
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Edit Profile</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="flex flex-col items-center gap-4">
                  <Avatar className="w-24 h-24">
                    <AvatarImage src={editAvatar} />
                    <AvatarFallback>{editName.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={generateAvatar}>Random Avatar</Button>
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="name">Display Name</Label>
                  <Input id="name" value={editName} onChange={(e) => setEditName(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label>Email Address</Label>
                  <Input value={user?.email || ''} disabled className="bg-muted text-muted-foreground" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="avatarUrl">Custom Avatar URL</Label>
                  <Input id="avatarUrl" value={editAvatar} onChange={(e) => setEditAvatar(e.target.value)} placeholder="https://..." />
                </div>
                <Button onClick={saveProfile} disabled={isSaving}>Save Changes</Button>
              </div>
            </DialogContent>
          </Dialog>

          <Button variant="ghost" className="w-full justify-start text-muted-foreground" onClick={logOut}>
            <LogOut size={20} className="mr-3" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto pb-20 md:pb-0 relative">
        {showPWA && (
          <div className="bg-primary text-primary-foreground p-3 flex items-center justify-between shadow-md z-50">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-background rounded-md flex items-center justify-center text-foreground">
                <Home size={16} />
              </div>
              <span className="text-sm font-medium">Add FlatOS to your Home Screen</span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={installPWA} className="h-8 text-xs">Install</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowPWA(false)} className="h-8 text-xs hover:bg-primary/80">Dismiss</Button>
            </div>
          </div>
        )}
        
        {/* Mobile Header */}
        <div className="md:hidden flex items-center justify-between p-4 bg-card backdrop-blur-xl border-b border-white/20 dark:border-white/10 sticky top-0 z-30">
          <h1 className="text-2xl tracking-tight flex items-baseline">
            <span className="italic font-normal mr-1.5" style={{ fontFamily: '"IM Fell English", serif' }}>Flat</span>
            <span className="not-italic font-normal" style={{ fontFamily: '"IM Fell English", serif' }}>OS</span>
          </h1>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </Button>
            <Dialog>
              <DialogTrigger render={<Button variant="ghost" size="icon" className="rounded-full" />}>
                  <Avatar className="w-8 h-8">
                    <AvatarImage src={userProfile?.photoURL} />
                    <AvatarFallback>{userProfile?.displayName?.charAt(0)}</AvatarFallback>
                  </Avatar>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[425px] w-[90vw] rounded-2xl">
                <DialogHeader>
                  <DialogTitle>Edit Profile</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="flex flex-col items-center gap-4">
                    <Avatar className="w-24 h-24">
                      <AvatarImage src={editAvatar} />
                      <AvatarFallback>{editName.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={generateAvatar}>Random Avatar</Button>
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="name-mobile">Display Name</Label>
                    <Input id="name-mobile" value={editName} onChange={(e) => setEditName(e.target.value)} />
                  </div>
                  <div className="grid gap-2">
                    <Label>Email Address</Label>
                    <Input value={user?.email || ''} disabled className="bg-muted text-muted-foreground" />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="avatarUrl-mobile">Custom Avatar URL</Label>
                    <Input id="avatarUrl-mobile" value={editAvatar} onChange={(e) => setEditAvatar(e.target.value)} placeholder="https://..." />
                  </div>
                  <Button onClick={saveProfile} disabled={isSaving}>Save Changes</Button>
                  <Button variant="outline" className="mt-4" onClick={logOut}>Sign Out</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="max-w-5xl mx-auto p-4 md:p-8">
          <Outlet />
        </div>
      </main>

      {/* Bottom Nav for Mobile */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-card backdrop-blur-2xl border-t border-white/20 dark:border-white/10 flex justify-around items-center pb-safe pt-2 px-2 z-50">
        {mobilePrimaryNav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `relative flex flex-col items-center p-2 min-w-[60px] transition-colors ${
                isActive ? 'text-primary' : 'text-muted-foreground'
              }`
            }
          >
            <div className="relative">
              <item.icon size={24} className="mb-1" />
              {item.hasDot && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-card"></span>}
            </div>
            <span className="text-[10px] font-medium">{item.label}</span>
          </NavLink>
        ))}
        
        {/* Fluid Animated More Menu */}
        <button 
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className={`relative z-[60] flex flex-col items-center justify-center p-2 min-w-[60px] transition-colors ${isMobileMenuOpen ? 'text-primary' : 'text-muted-foreground hover:text-primary'}`}
        >
          <motion.div animate={{ rotate: isMobileMenuOpen ? 180 : 0 }} transition={{ type: "spring", stiffness: 300, damping: 20 }}>
            {isMobileMenuOpen ? <XIcon size={24} className="mb-1" /> : <Menu size={24} className="mb-1" />}
          </motion.div>
          {(hasNewBoard || hasNewChores) && !isMobileMenuOpen && <span className="absolute top-1 right-2 w-2 h-2 bg-red-500 rounded-full"></span>}
          <span className="text-[10px] font-medium mt-1">{isMobileMenuOpen ? 'Close' : 'More'}</span>
        </button>
      </nav>

      <AnimatePresence>
        {isMobileMenuOpen && (
          <>
            {/* Backdrop */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMobileMenuOpen(false)}
              className="fixed inset-0 bg-transparent backdrop-blur-md z-[45] md:hidden"
            />
            
            {/* Floating Menu Items */}
            <div className="md:hidden fixed bottom-[85px] right-4 z-[45] flex flex-col-reverse items-end gap-3 pointer-events-none">
              {mobileMoreNav.map((item, idx) => (
                <motion.div
                  key={item.to}
                  initial={{ opacity: 0, y: 20, scale: 0.8, filter: 'blur(10px)' }}
                  animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, y: 20, scale: 0.8, filter: 'blur(10px)' }}
                  transition={{ 
                    delay: (mobileMoreNav.length - idx - 1) * 0.05, 
                    type: 'spring', 
                    stiffness: 300, 
                    damping: 25 
                  }}
                  className="pointer-events-auto origin-bottom-right"
                >
                  <NavLink
                    to={item.to}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-5 py-3.5 rounded-full shadow-xl transition-all active:scale-95 ${
                        isActive ? 'bg-primary text-primary-foreground' : 'bg-card text-foreground border border-border/50'
                      }`
                    }
                  >
                    <span className="font-semibold text-sm tracking-tight">{item.label}</span>
                    <div className="relative">
                      <item.icon size={20} className={location.pathname === item.to ? '' : 'text-primary'} />
                      {item.hasDot && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-card"></span>}
                    </div>
                  </NavLink>
                </motion.div>
              ))}
            </div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
