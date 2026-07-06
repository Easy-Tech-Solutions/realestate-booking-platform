import { lazy } from 'react';
import type { ComponentType } from 'react';
import { createBrowserRouter, useRouteError } from 'react-router';
import { RootLayout } from './layouts/RootLayout';
import { ProtectedRoute } from './components/ProtectedRoute';

function ChunkErrorFallback() {
  const error = useRouteError() as Error | undefined;
  const isChunkError = /Failed to fetch dynamically imported module|Importing a module script failed/i.test(
    error?.message ?? ''
  );
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center space-y-4 max-w-sm">
        <h1 className="text-2xl font-semibold">
          {isChunkError ? 'Update available' : 'Something went wrong'}
        </h1>
        <p className="text-muted-foreground text-sm">
          {isChunkError
            ? 'A new version of the app was deployed. Reload to continue.'
            : 'An unexpected error occurred.'}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
        >
          Reload
        </button>
      </div>
    </div>
  );
}

const CHUNK_RELOAD_KEY = 'chunk-load-reload';

const lazyPage = <TProps extends object>(
  factory: () => Promise<{ default: ComponentType<TProps> }>
) =>
  lazy(() =>
    factory().catch((err: Error) => {
      const isChunkError = /Failed to fetch dynamically imported module|Importing a module script failed/i.test(
        err?.message ?? ''
      );
      if (isChunkError && !sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
        window.location.reload();
        return new Promise<never>(() => {});
      }
      throw err;
    })
  );

const Home = lazyPage(() => import('./pages/Home').then((module) => ({ default: module.Home })));
const PropertyDetails = lazyPage(() => import('./pages/PropertyDetails').then((module) => ({ default: module.PropertyDetails })));
const Search = lazyPage(() => import('./pages/Search').then((module) => ({ default: module.Search })));
const Booking = lazyPage(() => import('./pages/Booking').then((module) => ({ default: module.Booking })));
const BookingConfirmed = lazyPage(() => import('./pages/BookingConfirmed').then((module) => ({ default: module.BookingConfirmed })));
const CompletePayment = lazyPage(() => import('./pages/CompletePayment').then((module) => ({ default: module.CompletePayment })));
const RequestViewing = lazyPage(() => import('./pages/RequestViewing').then((module) => ({ default: module.RequestViewing })));
const Viewings = lazyPage(() => import('./pages/Viewings').then((module) => ({ default: module.Viewings })));
const Trips = lazyPage(() => import('./pages/Trips').then((module) => ({ default: module.Trips })));
const Wishlists = lazyPage(() => import('./pages/Wishlists').then((module) => ({ default: module.Wishlists })));
const Messages = lazyPage(() => import('./pages/Messages').then((module) => ({ default: module.Messages })));
const Account = lazyPage(() => import('./pages/Account').then((module) => ({ default: module.Account })));
const HostDashboard = lazyPage(() => import('./pages/HostDashboard').then((module) => ({ default: module.HostDashboard })));
const BecomeAHost = lazyPage(() => import('./pages/BecomeAHost').then((module) => ({ default: module.BecomeAHost })));
const CreateListing = lazyPage(() => import('./pages/CreateListing').then((module) => ({ default: module.CreateListing })));
const UserDashboard = lazyPage(() => import('./pages/UserDashboard').then((module) => ({ default: module.UserDashboard })));
const AdminDashboard = lazyPage(() => import('./pages/AdminDashboard').then((module) => ({ default: module.AdminDashboard })));
const AdminReports = lazyPage(() => import('./pages/AdminReports').then((module) => ({ default: module.AdminReports })));
const AdminSuspensions = lazyPage(() => import('./pages/AdminSuspensions').then((module) => ({ default: module.AdminSuspensions })));
const Notifications = lazyPage(() => import('./pages/Notifications').then((module) => ({ default: module.Notifications })));
const Login = lazyPage(() => import('./pages/Login').then((module) => ({ default: module.Login })));
const VerifyEmail = lazyPage(() => import('./pages/VerifyEmail').then((module) => ({ default: module.VerifyEmail })));
const HostProfile = lazyPage(() => import('./pages/HostProfile').then((module) => ({ default: module.HostProfile })));
const Help = lazyPage(() => import('./pages/Help').then((module) => ({ default: module.Help })));
const Terms = lazyPage(() => import('./pages/Terms').then((module) => ({ default: module.Terms })));
const Privacy = lazyPage(() => import('./pages/Privacy').then((module) => ({ default: module.Privacy })));
const NotFound = lazyPage(() => import('./pages/NotFound').then((module) => ({ default: module.NotFound })));
const ResetPassword = lazyPage(() => import('./pages/ResetPassword').then((module) => ({ default: module.ResetPassword })));
const ManageRooms = lazyPage(() => import('./pages/ManageRooms').then((module) => ({ default: module.ManageRooms })));
const AllReviews = lazyPage(() => import('./pages/AllReviews').then((module) => ({ default: module.AllReviews })));
const FAQ = lazyPage(() => import('./pages/FAQ').then((module) => ({ default: module.FAQ })));
const Contact = lazyPage(() => import('./pages/Contact').then((module) => ({ default: module.Contact })));
const About = lazyPage(() => import('./pages/About').then((module) => ({ default: module.About })));
const Support = lazyPage(() => import('./pages/Support').then((module) => ({ default: module.Support })));
const MyTickets = lazyPage(() => import('./pages/MyTickets').then((module) => ({ default: module.MyTickets })));

export const router = createBrowserRouter([
  {
    path: '/',
    Component: RootLayout,
    errorElement: <ChunkErrorFallback />,
    children: [
      { index: true, Component: Home },
      { path: 'rooms/:id', Component: PropertyDetails },
      { path: 'search', Component: Search },
      { path: 'book', Component: Booking },
      { path: 'booking/confirmed', Component: BookingConfirmed },
      {
        path: 'booking/:id/pay',
        element: (
          <ProtectedRoute>
            <CompletePayment />
          </ProtectedRoute>
        ),
      },
      {
        path: 'rooms/:id/viewing',
        element: (
          <ProtectedRoute>
            <RequestViewing />
          </ProtectedRoute>
        ),
      },
      {
        path: 'viewings',
        element: (
          <ProtectedRoute>
            <Viewings />
          </ProtectedRoute>
        ),
      },
      {
        path: 'trips',
        element: (
          <ProtectedRoute>
            <Trips />
          </ProtectedRoute>
        ),
      },
      { path: 'wishlists', Component: Wishlists },
      {
        path: 'messages',
        element: (
          <ProtectedRoute>
            <Messages />
          </ProtectedRoute>
        ),
      },
      { path: 'account', Component: Account },
      {
        path: 'become-a-host',
        element: (
          <ProtectedRoute>
            <BecomeAHost />
          </ProtectedRoute>
        ),
      },
      {
        path: 'host',
        element: (
          <ProtectedRoute requireHost>
            <HostDashboard />
          </ProtectedRoute>
        ),
      },
      {
        path: 'host/new',
        element: (
          <ProtectedRoute requireHost>
            <CreateListing />
          </ProtectedRoute>
        ),
      },
      {
        path: 'host/listings/:id/rooms',
        element: (
          <ProtectedRoute requireHost>
            <ManageRooms />
          </ProtectedRoute>
        ),
      },
      { path: 'dashboard', Component: UserDashboard },
      { path: 'notifications', Component: Notifications },
      { path: 'login', Component: Login },
      { path: 'verify-email', Component: VerifyEmail },
      { path: 'users/:id', Component: HostProfile },
      { path: 'help', Component: Help },
      { path: 'terms', Component: Terms },
      { path: 'privacy', Component: Privacy },
      { path: '*', Component: NotFound },
      { path: 'reset-password', Component: ResetPassword },
      { path: 'reviews', Component: AllReviews },
      { path: 'faq', Component: FAQ },
      { path: 'contact', Component: Contact },
      { path: 'about', Component: About },
      { path: 'support', Component: Support },
      { path: 'support/tickets', Component: MyTickets },
    ],
  },
]);
