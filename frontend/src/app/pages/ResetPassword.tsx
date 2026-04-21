import React, { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Lock } from 'lucide-react';
import { toast } from 'sonner';
import { authAPI } from '../../services/api.service';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';

export function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = useMemo(() => searchParams.get('token') ?? '', [searchParams]);

  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const hasToken = token.trim().length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!hasToken) {
      toast.error('Reset token is missing');
      return;
    }

    if (password !== password2) {
      toast.error('Passwords do not match');
      return;
    }

    setIsLoading(true);
    try {
      const result = await authAPI.passwordResetConfirm(token, password, password2);
      toast.success(result.message);
      navigate('/');
    } catch (error: any) {
      toast.error(error.message || 'Unable to reset password');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border bg-card text-card-foreground p-6 shadow-sm">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold mb-2">Set a new password</h1>
          <p className="text-sm text-muted-foreground">
            Choose a new password for your account.
          </p>
        </div>

        {!hasToken ? (
          <div className="space-y-4">
            <p className="text-sm text-destructive">
              This reset link is missing its token.
            </p>
            <Button type="button" className="w-full" onClick={() => navigate('/')}>
              Go home
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">New password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  className="pl-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password2">Confirm new password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="password2"
                  type="password"
                  placeholder="••••••••"
                  className="pl-10"
                  value={password2}
                  onChange={(e) => setPassword2(e.target.value)}
                  required
                />
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Please wait...' : 'Reset password'}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
