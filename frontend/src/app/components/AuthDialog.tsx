import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { X, Mail, Lock, User as UserIcon, Eye, EyeOff } from 'lucide-react';
import { GoogleLogin, type CredentialResponse } from '@react-oauth/google';
import { Dialog, DialogContent } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Checkbox } from './ui/checkbox';
import { useApp } from '../../hooks/useApp';
import { toast } from 'sonner';
import { authAPI } from '../../services/api.service';

interface AuthDialogProps {
  open: boolean;
  onClose: () => void;
  mode: 'login' | 'register';
  onModeChange: (mode: 'login' | 'register') => void;
}

type AuthView = 'login' | 'register' | 'forgot-password';

interface FormErrors {
  first_name?: string;
  last_name?: string;
  email?: string;
  password?: string;
  password2?: string;
  agreedToTerms?: string;
}

function validatePassword(password: string): string | undefined {
  if (!password) return 'Password is required';
  if (password.length < 8) return 'At least 8 characters';
  if (!/[A-Z]/.test(password)) return 'Must contain an uppercase letter';
  if (!/[a-z]/.test(password)) return 'Must contain a lowercase letter';
  if (!/[0-9]/.test(password)) return 'Must contain a number';
  return undefined;
}

export function AuthDialog({ open, onClose, mode, onModeChange }: AuthDialogProps) {
  const { login, register, loginWithGoogle } = useApp();

  const [view, setView] = useState<AuthView>(mode ?? 'login');
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    password2: '',
    first_name: '',
    last_name: '',
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [showPassword, setShowPassword] = useState(false);
  const [showPassword2, setShowPassword2] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  useEffect(() => {
    setView(mode ?? 'login');
  }, [mode, open]);

  const resetForm = () => {
    setFormData({ email: '', password: '', password2: '', first_name: '', last_name: '' });
    setErrors({});
    setAgreedToTerms(false);
  };

  const handleClose = () => {
    setView(mode);
    resetForm();
    onClose();
  };

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};

    if (view === 'register') {
      if (!formData.first_name.trim()) newErrors.first_name = 'First name is required';
      if (!formData.last_name.trim()) newErrors.last_name = 'Last name is required';
    }

    if (view === 'login' || view === 'register' || view === 'forgot-password') {
      if (!formData.email.trim()) newErrors.email = 'Email is required';
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) newErrors.email = 'Enter a valid email address';
    }

    if (view === 'login') {
      if (!formData.password) newErrors.password = 'Password is required';
    }

    if (view === 'register') {
      const pwErr = validatePassword(formData.password);
      if (pwErr) newErrors.password = pwErr;
    }

    if (view === 'register') {
      if (!formData.password2) newErrors.password2 = 'Please confirm your password';
      else if (formData.password !== formData.password2) newErrors.password2 = 'Passwords do not match';
    }

    if (view === 'register' && !agreedToTerms) {
      newErrors.agreedToTerms = 'You must agree to the Terms of Service and Privacy Policy';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    setIsLoading(true);
    try {
      if (view === 'forgot-password') {
        const result = await authAPI.passwordResetRequest(formData.email);
        toast.success(result.message);
        setView('login');
        resetForm();
        return;
      }

      if (view === 'login') {
        await login(formData.email, formData.password);
        toast.success('Welcome back!');
        handleClose();
      } else {
        const result = await register({
          email: formData.email,
          password: formData.password,
          password2: formData.password2,
          first_name: formData.first_name,
          last_name: formData.last_name,
        });
        toast.success(result.message || 'Account created! Check your email for the verification link.');
        onModeChange('login');
        handleClose();
      }
    } catch (error: any) {
      toast.error(
        error.message ||
          (view === 'forgot-password'
            ? 'Unable to send reset link'
            : view === 'login'
              ? 'Invalid credentials'
              : 'Registration failed')
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleCredential = async (credentialResponse: CredentialResponse) => {
    const idToken = credentialResponse.credential;
    if (!idToken) { toast.error('Google sign-in was cancelled.'); return; }

    setIsLoading(true);
    try {
      await loginWithGoogle(idToken);
      toast.success('Welcome!');
      handleClose();
    } catch (error: any) {
      toast.error(error.message || 'Google sign-in failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleError = () => {
    toast.error('Google sign-in failed. Please try again.');
  };

  const field = (id: keyof typeof formData) => ({
    value: formData[id],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setFormData(prev => ({ ...prev, [id]: e.target.value }));
      if (errors[id as keyof FormErrors]) setErrors(prev => ({ ...prev, [id]: undefined }));
    },
  });

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="w-full max-w-[95vw] sm:max-w-[480px] p-0 gap-0 max-h-[90vh] overflow-y-auto">
        <div className="relative border-b border-border p-6">
          <button type="button" title="Close dialog" onClick={handleClose} className="absolute left-6 top-6 p-1 rounded-full hover:bg-muted">
            <X className="w-4 h-4" />
          </button>
          <h2 className="text-center font-semibold">
            {view === 'login' ? 'Log in' : view === 'register' ? 'Sign up' : 'Forgot password'}
          </h2>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <h3 className="text-lg font-semibold mb-2">
              {view === 'login' ? 'Welcome back' : view === 'register' ? 'Create your account' : 'Reset your password'}
            </h3>
            <p className="text-sm text-muted-foreground">
              {view === 'login' ? 'Log in to continue your journey' : view === 'register' ? 'Create an account to get started' : 'Enter your email and we will send you a password reset link'}
            </p>
            {view === 'register' && (
              <p className="text-sm text-muted-foreground mt-2">
                By creating an account, you agree to our{' '}
                <Link to="/terms" target="_blank" rel="noopener noreferrer" className="text-primary font-semibold hover:underline">
                  Terms of Service
                </Link>{' '}
                and{' '}
                <Link to="/privacy" target="_blank" rel="noopener noreferrer" className="text-primary font-semibold hover:underline">
                  Privacy Policy
                </Link>
                .
              </p>
            )}
          </div>

          {view !== 'forgot-password' && (
            <div className="space-y-3">
              <div className="relative">
                <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">Or continue with</span>
                </div>
              </div>
              <div className="flex justify-center">
                <GoogleLogin onSuccess={handleGoogleCredential} onError={handleGoogleError} theme="outline" size="large" text="continue_with" shape="rectangular" width="320" />
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              {view === 'register' && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="first_name">First name</Label>
                    <div className="relative">
                      <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input id="first_name" type="text" placeholder="John" className="pl-10" required {...field('first_name')} />
                    </div>
                    {errors.first_name && <p className="text-xs text-destructive">{errors.first_name}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="last_name">Last name</Label>
                    <div className="relative">
                      <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input id="last_name" type="text" placeholder="Doe" className="pl-10" required {...field('last_name')} />
                    </div>
                    {errors.last_name && <p className="text-xs text-destructive">{errors.last_name}</p>}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input id="email" type="email" placeholder="you@example.com" className="pl-10" {...field('email')} />
                </div>
                {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
              </div>

              {view !== 'forgot-password' && (
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input id="password" type={showPassword ? 'text' : 'password'} placeholder="••••••••" className="pl-10 pr-10" {...field('password')} />
                    <button type="button" onClick={() => setShowPassword(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" tabIndex={-1} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {errors.password && <p className="text-xs text-destructive">{errors.password}</p>}
                </div>
              )}

              {view === 'login' && (
                <div className="flex justify-end">
                  <button type="button" onClick={() => setView('forgot-password')} className="text-sm text-primary font-semibold hover:underline">Forgot password?</button>
                </div>
              )}

              {view === 'register' && (
                <div className="space-y-2">
                  <Label htmlFor="password2">Confirm password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input id="password2" type={showPassword2 ? 'text' : 'password'} placeholder="••••••••" className="pl-10 pr-10" {...field('password2')} />
                    <button type="button" onClick={() => setShowPassword2(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" tabIndex={-1} aria-label={showPassword2 ? 'Hide password' : 'Show password'}>
                      {showPassword2 ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {errors.password2 && <p className="text-xs text-destructive">{errors.password2}</p>}
                </div>
              )}

              {view === 'register' && (
                <div className="space-y-1">
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id="agreedToTerms"
                      checked={agreedToTerms}
                      onCheckedChange={(checked) => {
                        setAgreedToTerms(checked === true);
                        if (errors.agreedToTerms) setErrors(prev => ({ ...prev, agreedToTerms: undefined }));
                      }}
                      className="mt-0.5"
                    />
                    <Label htmlFor="agreedToTerms" className="font-normal leading-snug cursor-pointer">
                      I have read and agree to the{' '}
                      <Link to="/terms" target="_blank" rel="noopener noreferrer" className="text-primary font-semibold hover:underline">
                        Terms of Service
                      </Link>{' '}
                      and{' '}
                      <Link to="/privacy" target="_blank" rel="noopener noreferrer" className="text-primary font-semibold hover:underline">
                        Privacy Policy
                      </Link>
                      .
                    </Label>
                  </div>
                  {errors.agreedToTerms && <p className="text-xs text-destructive">{errors.agreedToTerms}</p>}
                </div>
              )}

              <Button type="submit" className="w-full" disabled={isLoading || (view === 'register' && !agreedToTerms)}>
                {isLoading ? 'Please wait...' : view === 'login' ? 'Log in' : view === 'register' ? 'Sign up' : 'Send reset link'}
              </Button>
            </form>

          <div className="text-center text-sm">
            {view === 'login' ? (
              <span>Don't have an account?{' '}<button type="button" onClick={() => { onModeChange('register'); setView('register'); }} className="text-primary font-semibold hover:underline">Sign up</button></span>
            ) : view === 'register' ? (
              <span>Already have an account?{' '}<button type="button" onClick={() => { onModeChange('login'); setView('login'); }} className="text-primary font-semibold hover:underline">Log in</button></span>
            ) : (
              <span>Remembered your password?{' '}<button type="button" onClick={() => setView('login')} className="text-primary font-semibold hover:underline">Back to log in</button></span>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
