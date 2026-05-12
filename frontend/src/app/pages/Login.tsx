import React from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Lock, User as UserIcon, Eye, EyeOff } from 'lucide-react';
import { GoogleLogin, type CredentialResponse } from '@react-oauth/google';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { useApp } from '../../hooks/useApp';
import { toast } from 'sonner';

interface PendingGoogleSignup {
  idToken: string;
  email: string;
  firstName: string;
  lastName: string;
}

export function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const next = searchParams.get('next') || '/';
  const { login, loginWithGoogle } = useApp();
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(false);
  const [pendingGoogleSignup, setPendingGoogleSignup] = React.useState<PendingGoogleSignup | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsLoading(true);

    try {
      await login(username, password);
      toast.success('Welcome back!');
      navigate(next, { replace: true });
    } catch (error: any) {
      toast.error(error?.message || 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleCredential = async (credentialResponse: CredentialResponse) => {
    const idToken = credentialResponse.credential;
    if (!idToken) {
      toast.error('Google sign-in was cancelled.');
      return;
    }
    setIsLoading(true);
    try {
      const result = await loginWithGoogle(idToken);
      if (result.status === 'success') {
        toast.success('Welcome!');
        navigate(next, { replace: true });
        return;
      }
      // First-time Google sign-up — collect a role.
      setPendingGoogleSignup({
        idToken: result.idToken,
        email: result.email,
        firstName: result.firstName,
        lastName: result.lastName,
      });
    } catch (error: any) {
      toast.error(error?.message || 'Google sign-in failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleError = () => {
    toast.error('Google sign-in failed. Please try again.');
  };

  const handleRoleChoice = async (role: 'user' | 'agent') => {
    if (!pendingGoogleSignup) return;
    setIsLoading(true);
    try {
      const result = await loginWithGoogle(pendingGoogleSignup.idToken, role);
      if (result.status === 'success') {
        toast.success('Welcome to the platform!');
        navigate(next, { replace: true });
      } else {
        toast.error('Could not complete sign-up. Please try again.');
      }
    } catch (error: any) {
      toast.error(error?.message || 'Could not complete sign-up.');
    } finally {
      setIsLoading(false);
    }
  };

  if (pendingGoogleSignup) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-sm">
          <h1 className="text-3xl font-semibold mb-2">
            Welcome{pendingGoogleSignup.firstName ? `, ${pendingGoogleSignup.firstName}` : ''}!
          </h1>
          <p className="text-muted-foreground mb-8">
            How do you plan to use the platform? You can change this later in settings.
          </p>

          <div className="space-y-3">
            <button
              type="button"
              onClick={() => handleRoleChoice('user')}
              disabled={isLoading}
              className="w-full text-left border rounded-lg p-4 hover:bg-muted transition disabled:opacity-50"
            >
              <div className="font-semibold">I'm here to book</div>
              <div className="text-xs text-muted-foreground mt-1">
                Find and book properties listed by agents.
              </div>
            </button>

            <button
              type="button"
              onClick={() => handleRoleChoice('agent')}
              disabled={isLoading}
              className="w-full text-left border rounded-lg p-4 hover:bg-muted transition disabled:opacity-50"
            >
              <div className="font-semibold">I'm an agent</div>
              <div className="text-xs text-muted-foreground mt-1">
                List and manage properties for booking.
              </div>
            </button>

            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => setPendingGoogleSignup(null)}
                disabled={isLoading}
                className="text-sm text-muted-foreground hover:underline"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-sm">
        <h1 className="text-3xl font-semibold mb-2">Log in</h1>
        <p className="text-muted-foreground mb-8">Enter your username and password to access your account.</p>

        <div className="space-y-4 mb-6">
          <div className="flex justify-center">
            <GoogleLogin
              onSuccess={handleGoogleCredential}
              onError={handleGoogleError}
              theme="outline"
              size="large"
              text="continue_with"
              shape="rectangular"
              width="320"
            />
          </div>
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <div className="relative">
              <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="pl-10"
                placeholder="johndoe"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="pl-10 pr-10"
                placeholder="Enter your password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <Button type="submit" className="w-full sm:w-auto" disabled={isLoading}>
              {isLoading ? 'Logging in...' : 'Log in'}
            </Button>
            <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => navigate('/')}>
              Back to home
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
