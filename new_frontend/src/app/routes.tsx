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

export const router = createBrowserRouter([
  {
    path: '/',
    Component: RootLayout,
    children: [
      {
        index: true,
        Component: Home,
      },
      {
        path: 'rooms/:id',
        Component: PropertyDetails,
      },
      {
        path: 'search',
        Component: Search,
      },
      {
        path: 'book',
        Component: Booking,
      },
      {
        path: 'trips',
        Component: Trips,
      },
      {
        path: 'wishlists',
        Component: Wishlists,
      },
      {
        path: 'messages',
        Component: Messages,
      },
      {
        path: 'account',
        Component: Account,
      },
      {
        path: 'host',
        Component: HostDashboard,
      },
      {
        path: 'dashboard',
        Component: UserDashboard,
      },
      {
        path: 'admin',
        Component: AdminDashboard,
      },
    ],
  },
]);
