import React, { useEffect, useState } from 'react';
import { X, Mail, Lock, User as UserIcon } from 'lucide-react';
import { Dialog, DialogContent } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { useApp } from '../../hooks/useApp';
import { toast } from 'sonner';
import { authAPI } from '../../services/api.service';
import googleLogo  from '../../assets/google.png';
import appleLogo  from '../../assets/apple.png';
import { API_BASE_URL } from '../../core/constants';



/* Props passed in from the parent header/menu that opens this dialog */

interface AuthDialogProps {
  open: boolean;
  onClose: () => void;
  mode: 'login' | 'register';
  onModeChange: (mode: 'login' | 'register') => void;
}

/* Local dialog modes, including forgot-password */

type AuthView = 'login' | 'register' | 'forgot-password';

export function AuthDialog({ open, onClose, mode, onModeChange }: AuthDialogProps) {
  const { login, register } = useApp();

    /* Local UI state for which auth screen is showing */
  const [view, setView] = useState<AuthView>(mode);

   /* Loading state for async submit actions */
  const [isLoading, setIsLoading] = useState(false);

  /* Shared form state used by login, register, and forgot-password */
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    password2: '',
    first_name: '',
    last_name: '',
  });

  /* Keep the local dialog view in sync with the parent mode */
  useEffect(() => {
    setView(mode);
  }, [mode, open]);

 { /* Clear all form inputs */}
  const resetForm = () => {
    setFormData({
      username: '',
      email: '',
      password: '',
      password2: '',
      first_name: '',
      last_name: '',
    });
  };

  
  {/* Close dialog and restore its default state */}
  const handleClose = () => {
    setView(mode);
    resetForm();
    onClose();
  };

  {/* Handle submit for login, register, and forgot-password */}
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {

      {/* Forgot-password flow: request reset email */}
      if (view === 'forgot-password') {
        const result = await authAPI.passwordResetRequest(formData.email);
        toast.success(result.message);
        setView('login');
        resetForm();
        return;
      }

      { /* Login flow */}
      if (view === 'login') {
        await login(formData.username, formData.password);
        toast.success('Welcome back!');
        handleClose();
      } else {
         { /* Register flow: validate passwords match before calling register API */}
        if (formData.password !== formData.password2) {
          toast.error('Passwords do not match');
          return;
        }

          { /* Register flow request */}
        const result = await register({
          username: formData.username,
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

    } 
    
    catch (error: any) {
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

const handleGoogleSignIn = () => {
  window.location.href = `${API_BASE_URL}/api/auth/google/`;
};


  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[480px] p-0 gap-0">
        <div className="relative border-b border-border p-6">
          <button onClick={handleClose} className="absolute left-6 top-6 p-1 rounded-full hover:bg-muted">
            <X className="w-4 h-4" />
          </button>
          <h2 className="text-center font-semibold">
            {view === 'login' ? 'Log in' : view === 'register' ? 'Sign up' : 'Forgot password'}
          </h2>
        </div>

        <div className="p-6 space-y-4">

          {/* Heading and helper text for the current auth view */}

          <div>
            <h3 className="text-lg font-semibold mb-2">
              {view === 'login'
                ? 'Welcome back'
                : view === 'register'
                  ? 'Create your account'
                  : 'Reset your password'}
            </h3>
            <p className="text-sm text-muted-foreground">
              {view === 'login'
                ? 'Log in to continue your journey'
                : view === 'register'
                  ? 'Create an account to get started'
                  : 'Enter your email and we will send you a password reset link'}
            </p>
          </div>



        {/* Social sign-in section: shown for login/register, hidden for forgot-password */}
          {view !== 'forgot-password' && (
            <div className="space-y-3">
              {/* Divider label */}
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">Or continue with</span>
                </div>
              </div>

              {/* Placeholder provider buttons for Google and Apple */}
              <div className="space-y-3">

                <Button type="button" variant="outline" className="w-full" onClick={handleGoogleSignIn}>
  <img src={googleLogo} alt="Google" className="w-4 h-4 mr-2" />
  Continue with Google
</Button>

<Button type="button" variant="outline" className="w-full">
  <img src={appleLogo} alt="Apple" className="w-6 h-6 mr-2" />
  Continue with Apple
</Button>


              </div>
            </div>
          )}

   {/* Main auth form */}
          <form onSubmit={handleSubmit} className="space-y-4">

            {/* Register and forgot-password both need email */}
            {(view === 'register' || view === 'forgot-password') && (
              <>

                {/* Extra profile fields shown only on registration */}
                {view === 'register' && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="first_name">First name</Label>
                      <Input
                        id="first_name"
                        type="text"
                        placeholder="John"
                        value={formData.first_name}
                        onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                      />
    

                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="last_name">Last name</Label>
                      <Input
                        id="last_name"
                        type="text"
                        placeholder="Doe"
                        value={formData.last_name}
                        onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                      />
                    </div>
                  </div>
                )}
{/* Email field */}
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@example.com"
                      className="pl-10"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      required
                    />
                  </div>
                </div>
              </>
            )}

{/* Username field for login/register only */}

            {view !== 'forgot-password' && (
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <div className="relative">
                  <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="username"
                    type="text"
                    placeholder="johndoe"
                    className="pl-10"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    required
                  />
                </div>
              </div>
            )}

 {/* Confirm password shown only in register mode */}
            {view !== 'forgot-password' && (
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    className="pl-10"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    required
                  />
                </div>
              </div>
            )}

 {/* Forgot-password shortcut shown only in login mode */}
            {view === 'login' && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setView('forgot-password')}
                  className="text-sm text-primary font-semibold hover:underline"
                >
                  Forgot password?
                </button>
              </div>
            )}

            {view === 'register' && (
              <div className="space-y-2">
                <Label htmlFor="password2">Confirm password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="password2"
                    type="password"
                    placeholder="••••••••"
                    className="pl-10"
                    value={formData.password2}
                    onChange={(e) => setFormData({ ...formData, password2: e.target.value })}
                    required
                  />
                </div>
              </div>
            )}

{/* Submit button changes label based on current auth view */}
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Please wait...' : view === 'login' ? 'Log in' : view === 'register' ? 'Sign up' : 'Send reset link'}
            </Button>
          </form>

{/* Bottom links for switching between login/register/forgot-password */}
          <div className="text-center text-sm">
            {view === 'login' ? (
              <span>
                Don't have an account?{' '}
                <button
                  type="button"
                  onClick={() => {
                    onModeChange('register');
                    setView('register');
                  }}
                  className="text-primary font-semibold hover:underline"
                >
                  Sign up
                </button>
              </span>
            ) : view === 'register' ? (
              <span>
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => {
                    onModeChange('login');
                    setView('login');
                  }}
                  className="text-primary font-semibold hover:underline"
                >
                  Log in
                </button>
              </span>
            ) : (
              <span>
                Remembered your password?{' '}
                <button type="button" onClick={() => setView('login')} className="text-primary font-semibold hover:underline">
                  Back to log in
                </button>
              </span>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
