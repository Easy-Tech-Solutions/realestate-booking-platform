import { lazy } from 'react';
import type { ComponentType } from 'react';
import { createBrowserRouter } from 'react-router';
import { RootLayout } from './layouts/RootLayout';
import { ProtectedRoute } from './components/ProtectedRoute';

const lazyPage = <TProps extends object>(
  factory: () => Promise<{ default: ComponentType<TProps> }>
) => lazy(factory);

const Home = lazyPage(() => import('./pages/Home').then((module) => ({ default: module.Home })));
const PropertyDetails = lazyPage(() => import('./pages/PropertyDetails').then((module) => ({ default: module.PropertyDetails })));
const Search = lazyPage(() => import('./pages/Search').then((module) => ({ default: module.Search })));
const Booking = lazyPage(() => import('./pages/Booking').then((module) => ({ default: module.Booking })));
const BookingConfirmed = lazyPage(() => import('./pages/BookingConfirmed').then((module) => ({ default: module.BookingConfirmed })));
const Trips = lazyPage(() => import('./pages/Trips').then((module) => ({ default: module.Trips })));
const Wishlists = lazyPage(() => import('./pages/Wishlists').then((module) => ({ default: module.Wishlists })));
const Messages = lazyPage(() => import('./pages/Messages').then((module) => ({ default: module.Messages })));
const Account = lazyPage(() => import('./pages/Account').then((module) => ({ default: module.Account })));
const HostDashboard = lazyPage(() => import('./pages/HostDashboard').then((module) => ({ default: module.HostDashboard })));
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
      {
        path: 'admin/reports',
        element: (
          <ProtectedRoute requireAdmin>
            <AdminReports />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/suspensions',
        element: (
          <ProtectedRoute requireAdmin>
            <AdminSuspensions />
          </ProtectedRoute>
        ),
      },
      { path: 'notifications', Component: Notifications },
      { path: 'login', Component: Login },
      { path: 'verify-email', Component: VerifyEmail },
      { path: 'users/:id', Component: HostProfile },
      { path: 'help', Component: Help },
      { path: 'terms', Component: Terms },
      { path: 'privacy', Component: Privacy },
      { path: '*', Component: NotFound },
    ],
  },
]);
