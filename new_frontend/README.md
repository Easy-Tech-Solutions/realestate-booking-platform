# Staybnb — Airbnb-like Booking Platform

A full-featured property rental booking app built with React 18, TypeScript, and TailwindCSS v4. Designed from a [Figma prototype](https://www.figma.com/design/oo8Ma2soai9hrro20Q3S9z/Airbnb-like-Booking-App).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React 18 + TypeScript |
| Build tool | Vite 6 |
| Routing | React Router v7 |
| Styling | TailwindCSS v4 + tw-animate-css |
| UI components | shadcn/ui (Radix UI primitives) |
| Icons | Lucide React + MUI Icons |
| Maps | React Leaflet + Leaflet.js |
| Charts | Recharts |
| Animations | motion/react (Framer Motion) |
| Date picking | react-day-picker + date-fns |
| Toasts | Sonner |
| Forms | react-hook-form |
| Drag & drop | react-dnd |

---

## Project Structure

```
src/
├── app/
│   ├── components/       # Shared UI components
│   │   ├── ui/           # shadcn/ui primitives (button, dialog, etc.)
│   │   ├── figma/        # Figma-specific helpers (ImageWithFallback)
│   │   ├── AuthDialog.tsx
│   │   ├── ConfirmDialog.tsx
│   │   ├── FiltersDialog.tsx
│   │   ├── Footer.tsx
│   │   ├── Header.tsx
│   │   ├── LoadingSpinner.tsx
│   │   ├── MobileNav.tsx
│   │   ├── PropertyCard.tsx
│   │   ├── ProtectedRoute.tsx
│   │   ├── SearchDialog.tsx
│   │   └── Skeletons.tsx
│   ├── layouts/
│   │   └── RootLayout.tsx    # App shell: Header + Outlet + Footer + MobileNav
│   ├── pages/                # One file per route
│   │   ├── Home.tsx
│   │   ├── Search.tsx
│   │   ├── PropertyDetails.tsx
│   │   ├── Booking.tsx
│   │   ├── BookingConfirmed.tsx
│   │   ├── Trips.tsx
│   │   ├── Wishlists.tsx
│   │   ├── Messages.tsx
│   │   ├── Account.tsx
│   │   ├── HostDashboard.tsx
│   │   ├── HostProfile.tsx
│   │   ├── UserDashboard.tsx
│   │   ├── AdminDashboard.tsx
│   │   ├── CreateListing.tsx
│   │   ├── Notifications.tsx
│   │   ├── Help.tsx
│   │   ├── Terms.tsx
│   │   ├── Privacy.tsx
│   │   └── NotFound.tsx
│   ├── App.tsx               # Mounts RouterProvider
│   └── routes.tsx            # All route definitions
├── core/
│   ├── context.tsx           # Global AppContext + AppProvider
│   ├── types.ts              # All TypeScript interfaces and enums
│   ├── constants.ts          # App-wide constants
│   └── utils.ts              # Shared utility functions
├── services/
│   ├── api.service.ts        # API layer (mock implementations)
│   └── mock-data.ts          # 20 mock properties, 2 users, 2 reviews
├── styles/
│   ├── index.css             # Global base styles
│   ├── tailwind.css          # Tailwind directives
│   ├── theme.css             # CSS custom properties (colors, radius, etc.)
│   └── fonts.css             # Font-face declarations
└── main.tsx                  # React DOM entry point
```

---

## Setup & Running

```bash
# Install dependencies
npm i

# Start development server (http://localhost:5173)
npm run dev

# Build for production
npm run build
```

The `@` alias resolves to `src/`, so imports like `@/core/types` work everywhere.

---

## Routing

All routes are defined in `src/app/routes.tsx` using `createBrowserRouter`. Every route is a child of `RootLayout`, which renders the shared Header, Footer, and MobileNav.

| Path | Page | Guard |
|---|---|---|
| `/` | Home | — |
| `/search` | Search | — |
| `/rooms/:id` | PropertyDetails | — |
| `/book` | Booking | — |
| `/booking/confirmed` | BookingConfirmed | — |
| `/trips` | Trips | — |
| `/wishlists` | Wishlists | — |
| `/messages` | Messages | — |
| `/account` | Account | — |
| `/dashboard` | UserDashboard | — |
| `/host` | HostDashboard | `requireHost` |
| `/host/new` | CreateListing | `requireHost` |
| `/admin` | AdminDashboard | `requireAdmin` |
| `/notifications` | Notifications | — |
| `/users/:id` | HostProfile | — |
| `/help` | Help | — |
| `/terms` | Terms | — |
| `/privacy` | Privacy | — |

### Route Guards

`ProtectedRoute` (in `src/app/components/ProtectedRoute.tsx`) wraps children as JSX elements:

```tsx
<ProtectedRoute requireHost>
  <HostDashboard />
</ProtectedRoute>
```

It reads `user.isHost` / `user.isAdmin` from `AppContext` and redirects to `/` if the condition is not met.

---

## Global State — AppContext

`src/core/context.tsx` exports `AppProvider` and the `useApp()` hook.

```ts
interface AppContextType {
  user: User | null;
  setUser: (user: User | null) => void;
  isAuthenticated: boolean;
  login: (email, password) => Promise<void>;
  register: (data) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => void;
  searchFilters: SearchFilters;
  setSearchFilters: (filters: SearchFilters) => void;
  wishlistIds: string[];
  toggleWishlist: (propertyId: string) => void;
  isLoading: boolean;
  bookings: Booking[];
  addBooking: (booking: Booking) => void;
  cancelBooking: (bookingId: string) => void;
}
```

- Wishlist IDs are persisted to `localStorage`.
- Bookings are held in React state (in-memory, reset on refresh).
- In development, a mock user (`id: '1'`, `isHost: true`, `isAdmin: false`) is auto-set when no `authToken` is found in `localStorage`.

---

## Data Layer

The app is entirely mock-driven — there is no real backend.

- `src/services/mock-data.ts` — 20 `Property` objects, 2 `User` objects, 2 `Review` objects.
- `src/services/api.service.ts` — Simulates async API calls with `setTimeout` delays, returning mock data.

To connect a real backend, replace the functions in `api.service.ts` with actual `fetch`/`axios` calls. No other files need to change.

---

## Core Types

All interfaces live in `src/core/types.ts`. Key ones:

- `User` — id, email, name, avatar, isHost, isAdmin, verified
- `Property` — full listing data including location (lat/lng), amenities, bookedDates, host
- `Booking` — links a user + property with dates, guest counts, price breakdown, status
- `Review` — per-category ratings (cleanliness, accuracy, check-in, communication, location, value)
- `SearchFilters` — all filter fields used by the Search page
- `Conversation` / `Message` — messaging system types

Union types: `PropertyType`, `BookingStatus`, `PaymentStatus`, `PaymentMethod`, `CancellationPolicy`

---

## Key Feature Flows

### Search & Filters
`Search.tsx` reads `?location`, `?checkIn`, `?checkOut`, `?guests` from the URL on mount. `FiltersDialog.tsx` exposes an `ActiveFilters` interface and an `onApply` callback. Filters are applied client-side against `mockProperties`. Map markers use `L.divIcon` price-bubble pins that highlight on card hover.

### Booking Flow
```
PropertyDetails → /book (Booking.tsx) → addBooking() → navigate to /booking/confirmed
```
`BookingConfirmed.tsx` reads the `Booking` object from `location.state`.

### Trips & Cancellation
`Trips.tsx` reads from `context.bookings`. Cancel opens a `ConfirmDialog`; on confirm it calls `cancelBooking(id)`. Review opens a star-rating + textarea modal and fires a success toast.

### Host Flow
`/host` shows `HostDashboard` with real mock bookings and reviews filtered to `hostId: '1'`. `/host/new` is a multi-step `CreateListing` wizard with real file-input photo upload (up to 10 images, object URL previews).

### Wishlist
`toggleWishlist(propertyId)` in context adds/removes from `wishlistIds` and persists to `localStorage`. `PropertyCard` shows a filled heart for wishlisted items and fires a Sonner toast with a "View wishlist" action.

---

## Styling

- Primary color: `#004406` (dark green), defined as a CSS variable in `src/styles/theme.css`.
- TailwindCSS v4 is configured via the `@tailwindcss/vite` plugin — no `tailwind.config.js` file needed.
- shadcn/ui components live in `src/app/components/ui/` and use `class-variance-authority` + `tailwind-merge`.
- Animations use `motion/react` (Framer Motion v12 API).

---

## Maps

React Leaflet v4 with `@types/leaflet` installed. Always use `L.latLng(lat, lng)` for the `center` and `position` props — do not use array literals, as TypeScript will reject them.

```tsx
import L from 'leaflet';
<MapContainer center={L.latLng(lat, lng)} zoom={13}>
  <Marker position={L.latLng(lat, lng)} />
</MapContainer>
```

---

## Accessibility

- All icon-only buttons have `aria-label`.
- Wishlist button has `type="button"` and a dynamic `aria-label` (`Save to wishlist` / `Remove from wishlist`).
- Guest count buttons in `PropertyDetails` have descriptive `aria-label` attributes.
- Gallery navigation buttons (close, prev, next) have `aria-label`.

---

## Build Notes

- `vite build` exits 0 with no errors.
- One non-blocking warning: chunk size >500 KB (due to Leaflet + MUI bundled together). Split chunks via `build.rollupOptions.output.manualChunks` in `vite.config.ts` if needed.
- TypeScript is checked at build time via Vite's esbuild transform. Run `tsc --noEmit` separately for a full type-check pass.
