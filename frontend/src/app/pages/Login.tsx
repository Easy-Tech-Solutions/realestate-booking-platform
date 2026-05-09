import React from 'react';
import { useNavigate } from 'react-router';
import { Lock, User as UserIcon } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { useApp } from '../../hooks/useApp';
import { toast } from 'sonner';

export function Login() {
  const navigate = useNavigate();
  const { login } = useApp();
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsLoading(true);

    try {
      await login(username, password);
      toast.success('Welcome back!');
      navigate('/');
    } catch (error: any) {
      toast.error(error?.message || 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-sm">
        <h1 className="text-3xl font-semibold mb-2">Log in</h1>
        <p className="text-muted-foreground mb-8">Enter your username and password to access your account.</p>

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
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="pl-10"
                placeholder="Enter your password"
                required
              />
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
