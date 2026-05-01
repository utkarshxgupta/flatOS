import { useState, useEffect } from 'react';
import { signInWithGoogle, signInWithApple, setupRecaptcha, requestPhoneOtp } from '../firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Home, Apple, Phone, Mail } from 'lucide-react';
import { InstallPWAPrompt } from '../components/InstallPWAPrompt';
import { toast } from 'sonner';

declare global {
  interface Window {
    recaptchaVerifier: any;
  }
}

export default function LandingPage() {
  const [showPhoneDialog, setShowPhoneDialog] = useState(false);
  const [phoneState, setPhoneState] = useState<'details' | 'otp'>('details');
  const [countryCode, setCountryCode] = useState('+91');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirmationResult, setConfirmationResult] = useState<any>(null);

  useEffect(() => {
    if (!window.recaptchaVerifier) {
      window.recaptchaVerifier = setupRecaptcha('recaptcha-container');
    }
    
    return () => {
      // Optional: Cleanup
    };
  }, []);

  const handleGoogleLogin = async () => {
    try {
      await signInWithGoogle();
    } catch (error) {
      console.error(error);
    }
  };

  const handleAppleLogin = async () => {
    try {
      await signInWithApple();
    } catch (error) {
      console.error(error);
    }
  };

  const handlePhoneSubmit = async () => {
    if (!phoneNumber) {
      toast.error('Please enter a phone number');
      return;
    }
    setLoading(true);
    try {
      // Ensure phone format is E.164 (roughly check if it has a +)
      const cleanPhone = phoneNumber.replace(/\s+/g, '').replace(/^0+/, '');
      const formattedPhone = `${countryCode}${cleanPhone}`;
      const appVerifier = window.recaptchaVerifier;
      const confResult = await requestPhoneOtp(formattedPhone, appVerifier);
      setConfirmationResult(confResult);
      setPhoneState('otp');
      toast.success('OTP sent to your phone');
    } catch (error: any) {
      console.error(error);
      toast.error('Failed to send OTP: ' + (error.message || 'Check format'));
    } finally {
      setLoading(false);
    }
  };

  const handleOtpSubmit = async () => {
    if (!otp || !confirmationResult) return;
    setLoading(true);
    try {
      const result = await confirmationResult.confirm(otp);
      if (result.user) {
        toast.success('Successfully signed in!');
      }
    } catch (error: any) {
      console.error(error);
      toast.error('Invalid OTP');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground font-sans">
      <main className="flex-1 flex flex-col items-center justify-center p-6 text-center max-w-sm mx-auto">
        <div className="w-20 h-20 bg-primary text-primary-foreground rounded-3xl flex items-center justify-center mb-8 shadow-lg transform -rotate-6">
          <Home size={40} />
        </div>
        <h1 className="text-5xl font-bold tracking-tight mb-4 text-balance">
          Welcome to <span className="inline-flex items-baseline"><span className="italic font-normal mr-2" style={{ fontFamily: '"IM Fell English", serif' }}>Flat</span><span className="not-italic font-normal" style={{ fontFamily: '"IM Fell English", serif' }}>OS</span></span>
        </h1>
        <p className="text-xl text-muted-foreground mb-12 text-balance">
          The centralized super-app for shared living. Manage expenses, pantry, and chores without the drama.
        </p>
        
        <div className="flex flex-col gap-4 w-full">
          <Button size="lg" onClick={handleGoogleLogin} className="rounded-full px-8 py-6 text-lg shadow-sm w-full flex items-center justify-center gap-2">
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            Continue with Google
          </Button>

          <Button size="lg" variant="outline" onClick={handleAppleLogin} className="rounded-full px-8 py-6 text-lg w-full flex items-center justify-center gap-2 border-primary/20">
            <Apple size={20} className="fill-current" />
            Continue with Apple
          </Button>

          <Button size="lg" variant="outline" onClick={() => setShowPhoneDialog(true)} className="rounded-full px-8 py-6 text-lg w-full flex items-center justify-center gap-2 border-primary/20">
            <Phone size={20} />
            Continue with Phone
          </Button>
        </div>

        <div id="recaptcha-container"></div>
        <InstallPWAPrompt />
      </main>

      <Dialog open={showPhoneDialog} onOpenChange={setShowPhoneDialog}>
        <DialogContent className="sm:max-w-md p-6 sm:p-8 rounded-[2rem] gap-0 border shadow-2xl">
          <DialogHeader className="flex flex-col items-center text-center pb-6">
            <div className="w-16 h-16 bg-primary/10 text-primary rounded-full flex items-center justify-center mb-4">
              <Phone size={28} />
            </div>
            <DialogTitle className="text-2xl font-semibold tracking-tight">
              {phoneState === 'details' ? 'Welcome back' : 'Check your phone'}
            </DialogTitle>
            <DialogDescription className="text-base mt-2 text-balance">
              {phoneState === 'details' 
                ? 'Enter your phone number to sign in or create an account.'
                : `We sent a 6-digit code to ${countryCode} ${phoneNumber}`
              }
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {phoneState === 'details' ? (
              <>
                <div className="space-y-2.5">
                  <Label htmlFor="phone" className="text-sm font-medium text-muted-foreground ml-1">Phone Number</Label>
                  <div className="flex gap-2 items-center">
                    <Select value={countryCode} onValueChange={setCountryCode}>
                      <SelectTrigger 
                        className="w-[120px] rounded-2xl shadow-sm font-medium bg-background bg-white" 
                        style={{ height: '48px' }}
                      >
                        <span className="truncate">
                          {countryCode === '+91' ? '🇮🇳 IND +91' : 
                           countryCode === '+1' ? '🇺🇸 USA +1' : 
                           countryCode === '+44' ? '🇬🇧 GBR +44' : 
                           countryCode === '+61' ? '🇦🇺 AUS +61' : 
                           countryCode === '+65' ? '🇸🇬 SGP +65' : countryCode}
                        </span>
                      </SelectTrigger>
                      <SelectContent className="rounded-xl">
                        <SelectItem value="+91" className="rounded-lg">🇮🇳 IND +91</SelectItem>
                        <SelectItem value="+1" className="rounded-lg">🇺🇸 USA +1</SelectItem>
                        <SelectItem value="+44" className="rounded-lg">🇬🇧 GBR +44</SelectItem>
                        <SelectItem value="+61" className="rounded-lg">🇦🇺 AUS +61</SelectItem>
                        <SelectItem value="+65" className="rounded-lg">🇸🇬 SGP +65</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input 
                      id="phone" 
                      placeholder="9876543210" 
                      value={phoneNumber} 
                      onChange={e => setPhoneNumber(e.target.value)} 
                      className="flex-1 rounded-2xl shadow-sm px-4 bg-background bg-white"
                      style={{ height: '48px' }}
                      type="tel"
                    />
                  </div>
                </div>
                <Button size="lg" className="w-full rounded-2xl h-12 mt-4 text-base font-semibold shadow-md active:scale-[0.98] transition-transform" onClick={handlePhoneSubmit} disabled={loading}>
                  {loading ? 'Sending...' : 'Send code'}
                </Button>
              </>
            ) : (
              <>
                <div className="space-y-3">
                  <Label htmlFor="otp" className="sr-only">Code</Label>
                  <Input 
                    id="otp" 
                    placeholder="• • • • • •" 
                    value={otp} 
                    onChange={e => setOtp(e.target.value)} 
                    className="rounded-2xl h-14 text-center text-2xl tracking-[0.5em] font-medium shadow-sm transition-all focus-visible:ring-primary"
                    type="text"
                    maxLength={6}
                  />
                </div>
                <Button size="lg" className="w-full rounded-2xl h-12 mt-4 text-base font-semibold shadow-md active:scale-[0.98] transition-transform" onClick={handleOtpSubmit} disabled={loading}>
                  {loading ? 'Verifying...' : 'Verify code'}
                </Button>
                <div className="text-center mt-4">
                  <button 
                    onClick={() => setPhoneState('details')} 
                    className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Change phone number
                  </button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
