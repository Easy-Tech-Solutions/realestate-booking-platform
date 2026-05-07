import { GoogleOAuthProvider } from '@react-oauth/google';
import { RouterProvider } from 'react-router';
import { AppProvider } from '../providers/AppProvider';
import { router } from './routes';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID || '';

export default function App() {
  const core = (
    <AppProvider>
      <RouterProvider router={router} />
    </AppProvider>
  );

  if (!GOOGLE_CLIENT_ID) return core;

  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      {core}
    </GoogleOAuthProvider>
  );
}