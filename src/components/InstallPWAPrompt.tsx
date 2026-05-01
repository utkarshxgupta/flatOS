import { useState, useEffect } from 'react';
import { X, Share, MoreVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function InstallPWAPrompt() {
  const [showPrompt, setShowPrompt] = useState(false);
  const [os, setOs] = useState<'ios' | 'android' | null>(null);

  useEffect(() => {
    // Check if app is already installed
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;
    if (isStandalone) {
      return;
    }

    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOS = /iphone|ipad|ipod/.test(userAgent);
    const isAndroid = /android/.test(userAgent);

    if (isIOS) {
      setOs('ios');
      setShowPrompt(true);
    } else if (isAndroid) {
      setOs('android');
      setShowPrompt(true);
    }
  }, []);

  if (!showPrompt || !os) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 p-4 z-50 animate-in slide-in-from-bottom flex justify-center">
      <div className="bg-card text-card-foreground border shadow-lg rounded-2xl p-4 w-full max-w-sm relative">
        <button 
          onClick={() => setShowPrompt(false)}
          className="absolute top-2 right-2 text-muted-foreground hover:text-foreground p-1"
        >
          <X size={16} />
        </button>
        
        <div className="flex flex-col gap-3">
          <div className="font-semibold text-sm">Install FlatOS App</div>
          
          {os === 'ios' && (
            <div className="text-sm text-muted-foreground flex flex-col gap-2">
              <p>For the best experience, add FlatOS to your home screen:</p>
              <ol className="list-decimal list-inside space-y-1 ml-1 text-xs">
                <li className="flex items-center inline-flex gap-1">Tap the <Share size={14} className="mx-1" /> Share button below</li>
                <li>Scroll down and tap <strong>Add to Home Screen</strong></li>
              </ol>
            </div>
          )}

          {os === 'android' && (
            <div className="text-sm text-muted-foreground flex flex-col gap-2">
              <p>For the best experience, install the FlatOS app:</p>
              <ol className="list-decimal list-inside space-y-1 ml-1 text-xs">
                <li className="flex items-center inline-flex gap-1">Tap the <MoreVertical size={14} className="mx-1" /> Menu button in your browser</li>
                <li>Tap <strong>Install app</strong> or <strong>Add to Home screen</strong></li>
              </ol>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
