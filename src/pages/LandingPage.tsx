import { signInWithGoogle } from '../firebase';
import { Button } from '@/components/ui/button';
import { Home } from 'lucide-react';

export default function LandingPage() {
  const handleLogin = async () => {
    try {
      await signInWithGoogle();
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground font-sans">
      <main className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-20 h-20 bg-primary text-primary-foreground rounded-3xl flex items-center justify-center mb-8 shadow-lg transform -rotate-6">
          <Home size={40} />
        </div>
        <h1 className="text-5xl font-bold tracking-tight mb-4 text-balance">
          Welcome to FlatOS
        </h1>
        <p className="text-xl text-muted-foreground max-w-md mb-12 text-balance">
          The centralized super-app for shared living. Manage expenses, pantry, and chores without the drama.
        </p>
        <Button size="lg" onClick={handleLogin} className="rounded-full px-8 py-6 text-lg shadow-xl hover:scale-105 transition-transform">
          Sign in with Google
        </Button>
      </main>
    </div>
  );
}
