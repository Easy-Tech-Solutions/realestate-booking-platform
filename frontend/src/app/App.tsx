import { GoogleOAuthProvider } from '@react-oauth/google';
import { RouterProvider } from 'react-router';
import { AppProvider } from '../providers/AppProvider';
import { router } from './routes';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID || '';

export default function App() {
  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <AppProvider>
        <RouterProvider router={router} />
      </AppProvider>
    </GoogleOAuthProvider>
  );
}