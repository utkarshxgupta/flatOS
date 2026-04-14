import React, { useState, useEffect } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { Home, Receipt, Package, CheckSquare, LogOut, Moon, Sun, Download, UserCircle, Settings, MessageSquare, Shield } from 'lucide-react';
import { logOut, db, handleFirestoreError, OperationType } from '../firebase';
import { doc, updateDoc } from 'firebase/firestore';
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
  const { userProfile, refreshProfile, user } = useAppContext();
  const [showPWA, setShowPWA] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  
  // Profile Edit State
  const [editName, setEditName] = useState(userProfile?.displayName || '');
  const [editAvatar, setEditAvatar] = useState(userProfile?.photoURL || '');
  const [isSaving, setIsSaving] = useState(false);

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
    
    // Check if iOS and not installed
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
    { to: '/dashboard/board', icon: MessageSquare, label: 'Board' },
    { to: '/dashboard/expenses', icon: Receipt, label: 'Expenses' },
    { to: '/dashboard/pantry', icon: Package, label: 'Pantry' },
    { to: '/dashboard/chores', icon: CheckSquare, label: 'Chores' },
    { to: '/dashboard/vault', icon: Shield, label: 'Vault' },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row font-sans text-foreground">
      {/* Sidebar for Desktop */}
      <aside className="hidden md:flex w-64 flex-col bg-card border-r border-border">
        <div className="p-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">FlatOS</h1>
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
                `flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${
                  isActive ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`
              }
            >
              <item.icon size={20} />
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
        <div className="md:hidden flex items-center justify-between p-4 bg-card border-b border-border">
          <h1 className="text-xl font-bold tracking-tight">FlatOS</h1>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </Button>
            <Dialog>
              <DialogTrigger render={<Button variant="ghost" size="icon" />}>
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
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border flex justify-around items-center pb-safe pt-2 px-2 z-50">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex flex-col items-center p-2 min-w-[50px] transition-colors ${
                isActive ? 'text-primary' : 'text-muted-foreground'
              }`
            }
          >
            <item.icon size={24} className="mb-1" />
            <span className="text-[10px] font-medium">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
