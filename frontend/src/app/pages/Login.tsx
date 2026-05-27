import React from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Lock, User as UserIcon, Eye, EyeOff } from 'lucide-react';
import { GoogleLogin, type CredentialResponse } from '@react-oauth/google';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { useApp } from '../../hooks/useApp';
import { toast } from 'sonner';

type Mode = 'login' | 'signup';

export function Login() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const next = searchParams.get('next') || '/';
  const initialMode: Mode = searchParams.get('mode') === 'signup' ? 'signup' : 'login';

  const { login, loginWithGoogle, register } = useApp();
  const [mode, setMode] = React.useState<Mode>(initialMode);
  const [firstName, setFirstName] = React.useState('');
  const [lastName, setLastName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [password2, setPassword2] = React.useState('');
  const [emailError, setEmailError] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(false);
  const [showPassword2, setShowPassword2] = React.useState(false);

  // Keep the URL's ?mode= in sync with the toggle so deep-links stay accurate.
  const switchMode = (next: Mode) => {
    setMode(next);
    const params = new URLSearchParams(searchParams);
    if (next === 'signup') params.set('mode', 'signup');
    else params.delete('mode');
    setSearchParams(params, { replace: true });
  };

  const validateEmail = () => {
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError('Enter a valid email address');
      return false;
    }
    setEmailError('');
    return true;
  };

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!validateEmail() || !password) return;
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

  const handleSignup = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!firstName.trim() || !lastName.trim()) {
      toast.error('First name and last name are required');
      return;
    }
    if (!validateEmail()) return;
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    if (password !== password2) {
      toast.error('Passwords do not match');
      return;
    }
    setIsLoading(true);
    try {
      const result = await register({
        email,
        password,
        password2,
        first_name: firstName,
        last_name: lastName,
      } as any);
      toast.success(result.message || 'Account created! Check your email for the verification link.');
      // After verification the user can log in; keep them on this page in
      // login mode with their email pre-filled so the next step is one click.
      switchMode('login');
      setPassword('');
      setPassword2('');
    } catch (error: any) {
      toast.error(error?.message || 'Registration failed');
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

  const isSignup = mode === 'signup';

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-sm">
        <h1 className="text-3xl font-semibold mb-2">{isSignup ? 'Create your account' : 'Log in'}</h1>
        <p className="text-muted-foreground mb-8">
          {isSignup
            ? 'Sign up to list your property or book a stay.'
            : 'Enter your email and password to access your account.'}
        </p>

        <div className="space-y-4 mb-6">
          <div className="flex justify-center">
            <GoogleLogin
              onSuccess={handleGoogleCredential}
              onError={handleGoogleError}
              theme="outline"
              size="large"
              text={isSignup ? 'signup_with' : 'continue_with'}
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

        <form onSubmit={isSignup ? handleSignup : handleLogin} className="space-y-5">
          {isSignup && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="firstName">First name</Label>
                <Input
                  id="firstName"
                  type="text"
                  value={firstName}
                  onChange={(event) => setFirstName(event.target.value)}
                  placeholder="John"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last name</Label>
                <Input
                  id="lastName"
                  type="text"
                  value={lastName}
                  onChange={(event) => setLastName(event.target.value)}
                  placeholder="Doe"
                  required
                />
              </div>
            </div>
          )}

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
                placeholder={isSignup ? 'At least 8 characters' : 'Enter your password'}
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

          {isSignup && (
            <div className="space-y-2">
              <Label htmlFor="password2">Confirm password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="password2"
                  type={showPassword2 ? 'text' : 'password'}
                  value={password2}
                  onChange={(event) => setPassword2(event.target.value)}
                  className="pl-10 pr-10"
                  placeholder="Re-enter your password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword2((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                  aria-label={showPassword2 ? 'Hide password' : 'Show password'}
                >
                  {showPassword2 ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            <Button type="submit" className="w-full sm:w-auto" disabled={isLoading}>
              {isLoading
                ? (isSignup ? 'Creating account…' : 'Logging in…')
                : (isSignup ? 'Sign up' : 'Log in')}
            </Button>
            <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => navigate('/')}>
              Back to home
            </Button>
          </div>
        </form>

        <div className="text-center text-sm mt-6">
          {isSignup ? (
            <span>
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => switchMode('login')}
                className="text-primary font-semibold hover:underline"
              >
                Log in
              </button>
            </span>
          ) : (
            <span>
              Don't have an account?{' '}
              <button
                type="button"
                onClick={() => switchMode('signup')}
                className="text-primary font-semibold hover:underline"
              >
                Sign up
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
