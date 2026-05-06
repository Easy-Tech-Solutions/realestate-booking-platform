import React, { useEffect, useState } from 'react';
import { X, Mail, Lock, User as UserIcon } from 'lucide-react';
import { GoogleLogin, type CredentialResponse } from '@react-oauth/google';
import { Dialog, DialogContent } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { useApp } from '../../hooks/useApp';
import { toast } from 'sonner';
import { authAPI } from '../../services/api.service';
import appleLogo  from '../../assets/apple.png';



/* Props passed in from the parent header/menu that opens this dialog */

interface AuthDialogProps {
  open: boolean;
  onClose: () => void;
  mode: 'login' | 'register';
  onModeChange: (mode: 'login' | 'register') => void;
}

/* Local dialog modes, including forgot-password and Google's role-picker step */

type AuthView = 'login' | 'register' | 'forgot-password' | 'choose-role';

interface PendingGoogleSignup {
  idToken: string;
  email: string;
  firstName: string;
  lastName: string;
}

export function AuthDialog({ open, onClose, mode, onModeChange }: AuthDialogProps) {
  const { login, register, loginWithGoogle } = useApp();

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

  /* Holds a verified Google ID token while the user picks their role on first sign-in */
  const [pendingGoogleSignup, setPendingGoogleSignup] = useState<PendingGoogleSignup | null>(null);

  /* Keep the local dialog view in sync with the parent mode (but don't clobber the role picker) */
  useEffect(() => {
    if (view !== 'choose-role') {
      setView(mode);
    }
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
    setPendingGoogleSignup(null);
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

  /*
   * Google Sign-In flow:
   *   1. <GoogleLogin> renders Google's button and returns a CredentialResponse
   *      whose `credential` field is a signed ID-token JWT.
   *   2. POST it to /api/auth/google/ via authAPI.loginWithGoogle (in the store).
   *   3. If the user is new, the backend asks us to collect a role first
   *      (`needs_role`); we stash the ID token and switch to the role picker.
   *   4. The role picker re-submits with { id_token, role } to create the user.
   */
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
        handleClose();
        return;
      }

      // First-time Google sign-up — ask the user to choose a role.
      setPendingGoogleSignup({
        idToken: result.idToken,
        email: result.email,
        firstName: result.firstName,
        lastName: result.lastName,
      });
      setView('choose-role');
    } catch (error: any) {
      toast.error(error.message || 'Google sign-in failed. Please try again.');
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
        handleClose();
      } else {
        // Should not happen on the second call, but fall through safely.
        toast.error('Could not complete sign-up. Please try again.');
      }
    } catch (error: any) {
      toast.error(error.message || 'Could not complete sign-up.');
    } finally {
      setIsLoading(false);
    }
  };

  const cancelRoleChoice = () => {
    setPendingGoogleSignup(null);
    setView(mode);
  };


  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="w-full max-w-[95vw] sm:max-w-[480px] p-0 gap-0 max-h-[90vh] overflow-y-auto">
        <div className="relative border-b border-border p-6">
          <button onClick={handleClose} className="absolute left-6 top-6 p-1 rounded-full hover:bg-muted">
            <X className="w-4 h-4" />
          </button>
          <h2 className="text-center font-semibold">
            {view === 'login'
              ? 'Log in'
              : view === 'register'
                ? 'Sign up'
                : view === 'forgot-password'
                  ? 'Forgot password'
                  : 'Choose your role'}
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
                  : view === 'forgot-password'
                    ? 'Reset your password'
                    : `Welcome${pendingGoogleSignup?.firstName ? `, ${pendingGoogleSignup.firstName}` : ''}!`}
            </h3>
            <p className="text-sm text-muted-foreground">
              {view === 'login'
                ? 'Log in to continue your journey'
                : view === 'register'
                  ? 'Create an account to get started'
                  : view === 'forgot-password'
                    ? 'Enter your email and we will send you a password reset link'
                    : 'How do you plan to use the platform? You can change this later in settings.'}
            </p>
          </div>

          {/* Role-picker step shown after Google reports a brand-new user. */}
          {view === 'choose-role' && (
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

              <div className="text-center">
                <button
                  type="button"
                  onClick={cancelRoleChoice}
                  disabled={isLoading}
                  className="text-sm text-muted-foreground hover:underline"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

        {/* Social sign-in section: shown for login/register, hidden for forgot-password and role-picker */}
          {view !== 'forgot-password' && view !== 'choose-role' && (
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

              {/* Provider buttons. Google's button is rendered by GIS itself
                  so the look and accessibility match Google's spec. */}
              <div className="space-y-3">
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

                <Button type="button" variant="outline" className="w-full">
                  <img src={appleLogo} alt="Apple" className="w-6 h-6 mr-2" />
                  Continue with Apple
                </Button>
              </div>
            </div>
          )}

   {/* Main auth form (hidden during the role-picker step) */}
          {view !== 'choose-role' && (
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
          )}

{/* Bottom links for switching between login/register/forgot-password (hidden during role-picker) */}
          {view !== 'choose-role' && (
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
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
