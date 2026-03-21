import { createBrowserRouter } from 'react-router';
import { RootLayout } from './layouts/RootLayout';
import { Home } from './pages/Home';
import { PropertyDetails } from './pages/PropertyDetails';
import { Search } from './pages/Search';
import { Booking } from './pages/Booking';
import { Trips } from './pages/Trips';
import { Wishlists } from './pages/Wishlists';
import { Messages } from './pages/Messages';
import { Account } from './pages/Account';
import { HostDashboard } from './pages/HostDashboard';
import { UserDashboard } from './pages/UserDashboard';
import { AdminDashboard } from './pages/AdminDashboard';
import { Notifications } from './pages/Notifications';
import { CreateListing } from './pages/CreateListing';
import { HostProfile } from './pages/HostProfile';
import { Help } from './pages/Help';
import { Terms } from './pages/Terms';
import { Privacy } from './pages/Privacy';
import { NotFound } from './pages/NotFound';
import { BookingConfirmed } from './pages/BookingConfirmed';
import { ProtectedRoute } from './components/ProtectedRoute';

export const router = createBrowserRouter([
  {
    path: '/',
    Component: RootLayout,
    children: [
      { index: true, Component: Home },
      { path: 'rooms/:id', Component: PropertyDetails },
      { path: 'search', Component: Search },
      { path: 'book', Component: Booking },
      { path: 'booking/confirmed', Component: BookingConfirmed },
      { path: 'trips', Component: Trips },
      { path: 'wishlists', Component: Wishlists },
      { path: 'messages', Component: Messages },
      { path: 'account', Component: Account },
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
      { path: 'dashboard', Component: UserDashboard },
      {
        path: 'admin',
        element: (
          <ProtectedRoute requireAdmin>
            <AdminDashboard />
          </ProtectedRoute>
        ),
      },
      { path: 'notifications', Component: Notifications },
      { path: 'users/:id', Component: HostProfile },
      { path: 'help', Component: Help },
      { path: 'terms', Component: Terms },
      { path: 'privacy', Component: Privacy },
      { path: '*', Component: NotFound },
    ],
  },
]);
