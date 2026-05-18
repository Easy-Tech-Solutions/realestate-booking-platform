import React from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Lock, User as UserIcon, Eye, EyeOff } from 'lucide-react';
import { GoogleLogin, type CredentialResponse } from '@react-oauth/google';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { useApp } from '../../hooks/useApp';
import { toast } from 'sonner';

export function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const next = searchParams.get('next') || '/';
  const { login, loginWithGoogle } = useApp();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(false);
  const [emailError, setEmailError] = React.useState('');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setEmailError('');
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError('Enter a valid email address');
      return;
    }
    if (!password) return;
    setIsLoading(true);
    try {
      await login(email, password);
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
      await loginWithGoogle(idToken);
      toast.success('Welcome!');
      navigate(next, { replace: true });
    } catch (error: any) {
      toast.error(error?.message || 'Google sign-in failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleError = () => {
    toast.error('Google sign-in failed. Please try again.');
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-sm">
        <h1 className="text-3xl font-semibold mb-2">Log in</h1>
        <p className="text-muted-foreground mb-8">Enter your email and password to access your account.</p>

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
            <Label htmlFor="email">Email</Label>
            <div className="relative">
              <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(event) => { setEmail(event.target.value); setEmailError(''); }}
                className="pl-10"
                placeholder="you@example.com"
                required
              />
            </div>
            {emailError && <p className="text-xs text-destructive">{emailError}</p>}
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
