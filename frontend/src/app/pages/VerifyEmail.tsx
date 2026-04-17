import React from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Button } from '../components/ui/button';
import { authAPI } from '../../services/api.service';

type VerificationState = 'idle' | 'loading' | 'success' | 'error';

export function VerifyEmail() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [state, setState] = React.useState<VerificationState>('idle');
  const [message, setMessage] = React.useState('Preparing verification...');

  const token = searchParams.get('token');

  React.useEffect(() => {
    let active = true;

    const verify = async () => {
      if (!token) {
        setState('error');
        setMessage('Missing verification token. Please use the full link from your email or backend console.');
        return;
      }

      setState('loading');
      setMessage('Verifying your email...');

      try {
        const result = await authAPI.verifyEmail(token);
        if (!active) {
          return;
        }
        setState('success');
        setMessage(result.message || 'Your email has been verified. You can log in now.');
      } catch (error: any) {
        if (!active) {
          return;
        }
        setState('error');
        setMessage(error?.message || 'Email verification failed. The link may be invalid or expired.');
      }
    };

    verify();

    return () => {
      active = false;
    };
  }, [token]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-sm">
        <h1 className="text-2xl font-semibold mb-3">Email verification</h1>
        <p className="text-muted-foreground mb-6">{message}</p>

        <div className="flex gap-3">
          {state === 'success' ? (
            <Button onClick={() => navigate('/login')}>Go to login</Button>
          ) : (
            <Button variant="outline" onClick={() => navigate('/')}>Back to home</Button>
          )}

          {state === 'error' && token && (
            <Button onClick={() => window.location.reload()}>Try again</Button>
          )}
        </div>
      </div>
    </div>
  );
}
