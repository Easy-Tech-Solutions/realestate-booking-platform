# Frontend Architecture Deep Guide

This document is the detailed frontend reference for the React + TypeScript client in this repository.

It explains:
- every frontend block and how blocks connect
- the role of each file in the frontend source tree
- how API calls are wired from UI to backend and back
- how to modify existing APIs/pages/components
- how to add a new API/page/component safely

Scope for this guide:
- Includes: frontend source and frontend config/docs files.
- Excludes: generated and third-party folders such as frontend/dist and frontend/node_modules..

## Quick Start for New Frontend Developers

If you are new to this codebase, read in this order:
1. `frontend/src/main.tsx` and `frontend/src/app/App.tsx` to understand app bootstrap.
2. `frontend/src/app/routes.tsx` and `frontend/src/app/layouts/RootLayout.tsx` to understand route structure and shell behavior.
3. `frontend/src/store/appStore.ts` and `frontend/src/hooks/useApp.ts` to understand app-level state.
4. `frontend/src/hooks/queries/keys.ts` and one query hook (for example `frontend/src/hooks/queries/usePropertyDetails.ts`) to understand server-state patterns.
5. `frontend/src/services/api/shared/client.ts`, `frontend/src/services/api/shared/contracts.ts`, and `frontend/src/services/api/shared/normalizers.ts` to understand API transport and data mapping.
6. One page + one component pair (for example `frontend/src/app/pages/PropertyDetails.tsx` and `frontend/src/app/components/PropertyCard.tsx`) to see end-to-end UI + data flow.

Fast mental model:
- Page = orchestration and UI composition.
- Query hook = server data acquisition and cache behavior.
- Domain API = endpoint-level calls and return typing.
- Shared client = auth headers, token refresh, and HTTP transport.
- Normalizer = backend shape to frontend shape conversion.
- Store = app-level user/session/filter state.

## 1) Frontend at a glance

Tech stack and runtime structure:
- Build and dev server: Vite
- UI runtime: React 18 + React Router v7
- Server-state cache: TanStack Query
- App state (auth/search/wishlist): Zustand store
- HTTP layer: domain APIs + shared authenticated client
- Type bridge: backend DTO contracts + normalizers
- Styling: TailwindCSS v4 + CSS variables + shadcn UI primitives

High-level data flow:
1. User interacts with page/component.
2. Component calls a query/mutation hook or app store action.
3. Hook/store calls a domain API module.
4. Domain API calls fetchWithAuth in shared client.
5. Shared client sends request, handles token refresh, and parses response.
6. Domain API normalizes backend payload into frontend types.
7. Query/store updates state.
8. Component re-renders.

## 2) Bootstrap and provider chain

Entry flow:
1. frontend/index.html defines the root mount node.
2. frontend/src/main.tsx mounts the React app.
3. frontend/src/app/App.tsx wraps the router with AppProvider.
4. frontend/src/providers/AppProvider.tsx initializes persisted auth/session state and wraps with QueryProvider.
5. frontend/src/providers/QueryProvider.tsx provides TanStack Query client defaults.
6. frontend/src/app/routes.tsx defines route tree.
7. frontend/src/app/layouts/RootLayout.tsx provides shell (Header, Footer, MobileNav, Toaster, Suspense fallback).

Provider stack:
- AppProvider
- AppQueryProvider (TanStack Query)
- RouterProvider
- Page components

## 3) Routing architecture

Routing is centralized in frontend/src/app/routes.tsx.

Pattern used:
- route components are lazy-loaded to reduce initial bundle size
- privileged routes use ProtectedRoute wrapper
- all routes share RootLayout shell

Guard model:
- frontend/src/app/components/ProtectedRoute.tsx checks:
  - isAuthenticated
  - requireHost
  - requireAdmin
- unauthorized users are redirected.

## 4) State architecture

### 4.1 App/global state (Zustand)

File: frontend/src/store/appStore.ts

Owned state:
- user
- isAuthenticated
- isLoading
- searchFilters
- wishlistIds

Owned actions:
- setUser
- login
- register
- logout
- setSearchFilters
- toggleWishlist
- initialize

Persistence:
- persisted key: easy-tech-app-store
- persisted slices: searchFilters, wishlistIds
- token storage handled separately in API shared client

Access hook:
- frontend/src/hooks/useApp.ts exposes useApp() wrapper around the store.

### 4.2 Server state (TanStack Query)

Files: frontend/src/hooks/queries/*

Rules used here:
- query keys centralized in frontend/src/hooks/queries/keys.ts
- read operations use useQuery/useQueries
- write operations use useMutation + query invalidation
- pages consume hook return values (data, loading, error)

## 5) API architecture and wiring

### 5.1 Layer responsibilities

API facade (compatibility import surface):
- frontend/src/services/api.service.ts re-exports domain modules.

Domain API layer:
- frontend/src/services/api/*.ts
- one module per domain (auth, properties, bookings, messages, etc.)

Shared API internals:
- frontend/src/services/api/shared/client.ts
  - token memory + localStorage sync
  - Authorization header injection
  - refresh-token retry on 401
  - JSON handling and 204 handling
- frontend/src/services/api/shared/contracts.ts
  - backend response DTO interfaces
- frontend/src/services/api/shared/normalizers.ts
  - backend shape -> frontend shape transformations
- frontend/src/services/api/shared/errors.ts
  - ApiError class and helper message extraction

### 5.2 Request lifecycle example

Example: property details page
1. PropertyDetails reads route id.
2. usePropertyDetails(id) runs 3 queries in parallel:
   - propertiesAPI.getById
   - reviewsAPI.getByProperty
   - propertiesAPI.getAvailability
3. API modules call fetchWithAuth(...).
4. fetchWithAuth appends API_BASE_URL and Authorization token.
5. On 401, fetchWithAuth attempts /api/auth/refresh-token/.
6. Domain API runs normalizeListing/normalizeReview/normalizeBooking.
7. Typed data returns to hook and page renders.

### 5.3 Env variables used by API

Configured in constants:
- frontend/src/core/constants.ts
  - API_BASE_URL from VITE_API_URL
  - WS_BASE_URL from VITE_WS_URL

Production setup details are documented in:
- frontend docs file: frontend/docs/frontend/infrastructure-production.md

## 6) How to modify an existing API safely

Use this checklist when changing existing API behavior.

1. Identify domain module
- Find method in frontend/src/services/api/*.ts.

2. Update endpoint contract
- If response shape changed, edit frontend/src/services/api/shared/contracts.ts.

3. Update normalizer
- If backend field names or nested shape changed, update frontend/src/services/api/shared/normalizers.ts.
- Keep frontend types stable where possible.

4. Update method and return type
- In domain API file, ensure method returns frontend model, not raw backend object.

5. Update hook if key or params changed
- Edit frontend/src/hooks/queries/* as needed.

6. Verify consumers
- Pages/components using that hook may need UI adjustments.

7. Validate
- Run npm run typecheck
- Run npm run lint
- Manually test the feature page.

## 7) How to add a new API

Recommended pattern:
1. Create method in appropriate domain file in frontend/src/services/api.
2. Add/adjust DTO interfaces in frontend/src/services/api/shared/contracts.ts.
3. Add/adjust normalizer in frontend/src/services/api/shared/normalizers.ts.
4. Export from frontend/src/services/api/index.ts.
5. Keep frontend/src/services/api.service.ts compatibility export intact.
6. Create query or mutation hook under frontend/src/hooks/queries.
7. Use hook in page/component.
8. Add query key entry in frontend/src/hooks/queries/keys.ts when caching is needed.

## 8) How to modify an existing page

Safe page-change workflow:
1. Update page UI in frontend/src/app/pages/<PageName>.tsx.
2. Keep data-fetch logic in hooks under frontend/src/hooks/queries when possible.
3. Reuse app components in frontend/src/app/components instead of duplicating.
4. If route/path changes, update frontend/src/app/routes.tsx.
5. If shared shell behavior changes (header/footer visibility), update frontend/src/app/layouts/RootLayout.tsx.

## 9) How to add a new page

1. Create file in frontend/src/app/pages/NewPage.tsx.
2. Export named component matching lazy import style.
3. In frontend/src/app/routes.tsx:
- add lazy import line
- add route object under RootLayout children
- wrap with ProtectedRoute if role protected
4. Add navigation entry in Header, MobileNav, or other menu if needed.
5. Add any required query hook in frontend/src/hooks/queries.
6. Validate route load and permission behavior.

## 10) How to modify or add a component

Modify existing:
1. Edit component in frontend/src/app/components.
2. Keep props typed in TypeScript interfaces.
3. Keep app-specific UI in components, not in primitive wrappers.
4. If used widely, search all references before changing props.

Add new:
1. Create component in frontend/src/app/components.
2. Add strict typed props.
3. Compose from existing ui primitives in frontend/src/app/components/ui where possible.
4. Keep domain logic in hooks/store/API, not deep inside visual components.
5. Import and use in page/layout.

## 11) File-by-file frontend reference

This section covers all source files and frontend config/docs files.

### 11.1 Root frontend files

- frontend/package.json: project metadata, scripts, dependencies.
- frontend/vite.config.ts: build config, alias mapping, chunk splitting.
- frontend/tsconfig.json: TypeScript compiler options.
- frontend/eslint.config.js: lint rules and plugin configuration.
- frontend/postcss.config.mjs: placeholder for extra PostCSS plugins.
- frontend/index.html: app HTML entry with root node.
- frontend/README.md: frontend usage and high-level architecture notes.
- frontend/ARCHITECTURE.md: architecture standards and direction.
- frontend/PROJECT_OVERVIEW.md: product-level frontend feature overview.
- frontend/ATTRIBUTIONS.md: external attributions.

### 11.2 App entry and routing

- frontend/src/main.tsx: mounts App and imports global CSS.
- frontend/src/app/App.tsx: wraps router with AppProvider.
- frontend/src/app/routes.tsx: route definitions and lazy imports.
- frontend/src/app/layouts/RootLayout.tsx: global shell and suspense fallback.

### 11.3 Core domain layer

- frontend/src/core/constants.ts: API endpoints, categories, amenities, policy constants.
- frontend/src/core/types.ts: canonical frontend domain interfaces and unions.
- frontend/src/core/utils.ts: class merging, formatting, dates, math helpers.
- frontend/src/core/icon-map.ts: dynamic icon string-to-component mapping.

### 11.4 Providers and store

- frontend/src/providers/AppProvider.tsx: bootstraps store initialization and wraps query provider.
- frontend/src/providers/QueryProvider.tsx: creates and provides shared QueryClient.
- frontend/src/store/appStore.ts: persisted app store state and actions.
- frontend/src/hooks/useApp.ts: convenience hook for store consumption.

### 11.5 API layer

Facade and index:
- frontend/src/services/api.service.ts: compatibility re-export layer.
- frontend/src/services/api/index.ts: central re-exports of domain APIs.

Domain APIs:
- frontend/src/services/api/auth.ts: login/register/logout/current-user/password flows.
- frontend/src/services/api/properties.ts: listing search/read/write/favorites/reviews/availability/pricing.
- frontend/src/services/api/bookings.ts: booking create/read/cancel/confirm/decline/pending.
- frontend/src/services/api/reviews.ts: review create/read/delete/respond.
- frontend/src/services/api/messages.ts: conversations/messages/send/start/unread-count.
- frontend/src/services/api/dashboard.ts: dashboard aggregate and host analytics.
- frontend/src/services/api/payments.ts: initiate, verify, refund, status, user payments.
- frontend/src/services/api/notifications.ts: notification list/read/preferences.
- frontend/src/services/api/users.ts: user profile and phone-change flows.
- frontend/src/services/api/reports.ts: report create/read/admin workflows.
- frontend/src/services/api/suspensions.ts: admin suspension workflows.
- frontend/src/services/api/wishlists.ts: wishlist model adaptation from dashboard favorites.
- frontend/src/services/api/booking-tools.ts: saved searches and listing comparison endpoints.

Shared API internals:
- frontend/src/services/api/shared/client.ts: authenticated fetch + token lifecycle.
- frontend/src/services/api/shared/contracts.ts: typed API response contracts.
- frontend/src/services/api/shared/errors.ts: ApiError and error message extraction.
- frontend/src/services/api/shared/normalizers.ts: backend-to-frontend object mapping.

Mock dataset:
- frontend/src/services/mock-data.ts: local mock entities used for fallback/development scenarios.

### 11.6 Query hooks

- frontend/src/hooks/queries/keys.ts: centralized query key factory.
- frontend/src/hooks/queries/useHomeProperties.ts: home featured/category listings query.
- frontend/src/hooks/queries/usePropertyDetails.ts: property, review, availability parallel queries.
- frontend/src/hooks/queries/useSearchProperties.ts: search query bound to store filters.
- frontend/src/hooks/queries/usePropertyPricing.ts: dynamic pricing query for date range.
- frontend/src/hooks/queries/useBookingConfirmed.ts: booking confirmation query + property enrichment.
- frontend/src/hooks/queries/useHostDashboard.ts: host dashboard reads and host mutations.
- frontend/src/hooks/queries/useHostProfile.ts: host profile + host listings + host reviews.
- frontend/src/hooks/queries/useMessages.ts: conversations/thread queries + send mutation.
- frontend/src/hooks/queries/useTrips.ts: user trips queries + cancel/review mutations.
- frontend/src/hooks/queries/useUserDashboard.ts: user dashboard aggregate data hook.
- frontend/src/hooks/queries/useWishlists.ts: favorite property query.

### 11.7 Pages

- frontend/src/app/pages/Home.tsx: category browsing and featured listing discovery.
- frontend/src/app/pages/Search.tsx: search results list + map + client filters.
- frontend/src/app/pages/PropertyDetails.tsx: listing detail, reviews, map, calendar, reserve action.
- frontend/src/app/pages/Booking.tsx: booking checkout and payment selection UI.
- frontend/src/app/pages/BookingConfirmed.tsx: booking receipt/confirmation view.
- frontend/src/app/pages/Trips.tsx: upcoming/past trips management and cancellation/review actions.
- frontend/src/app/pages/Wishlists.tsx: saved properties screen.
- frontend/src/app/pages/Messages.tsx: conversation list and chat thread interface.
- frontend/src/app/pages/Notifications.tsx: notification center and read-state actions.
- frontend/src/app/pages/Account.tsx: profile and account management screen.
- frontend/src/app/pages/UserDashboard.tsx: guest-side summary dashboard.
- frontend/src/app/pages/HostDashboard.tsx: host-side operational dashboard.
- frontend/src/app/pages/CreateListing.tsx: listing creation/editing workflow.
- frontend/src/app/pages/HostProfile.tsx: public host profile and listings.
- frontend/src/app/pages/AdminDashboard.tsx: admin overview and entry point.
- frontend/src/app/pages/AdminReports.tsx: moderation/report handling.
- frontend/src/app/pages/AdminSuspensions.tsx: suspension controls/history.
- frontend/src/app/pages/Help.tsx: help/support content.
- frontend/src/app/pages/Terms.tsx: terms of service content.
- frontend/src/app/pages/Privacy.tsx: privacy policy content.
- frontend/src/app/pages/NotFound.tsx: unmatched-route fallback page.

### 11.8 App components

Feature components:
- frontend/src/app/components/Header.tsx: top navigation, auth/menu actions, host switch.
- frontend/src/app/components/Footer.tsx: global footer and legal links.
- frontend/src/app/components/MobileNav.tsx: bottom tab-like nav for small screens.
- frontend/src/app/components/AuthDialog.tsx: login/register modal forms.
- frontend/src/app/components/SearchDialog.tsx: search criteria modal.
- frontend/src/app/components/FiltersDialog.tsx: advanced listing filters modal.
- frontend/src/app/components/PropertyCard.tsx: reusable listing card with wishlist/image carousel.
- frontend/src/app/components/ReportDialog.tsx: report content dialog.
- frontend/src/app/components/ConfirmDialog.tsx: generic confirmation modal.
- frontend/src/app/components/ProtectedRoute.tsx: role/auth guard wrapper.
- frontend/src/app/components/LoadingSpinner.tsx: loading visual.
- frontend/src/app/components/Skeletons.tsx: shared skeleton placeholders.

Figma helper:
- frontend/src/app/components/figma/ImageWithFallback.tsx: resilient image renderer with fallback behavior.

UI primitive wrappers (shadcn/Radix composition):
- frontend/src/app/components/ui/accordion.tsx: collapsible content sections.
- frontend/src/app/components/ui/alert.tsx: inline alert callouts.
- frontend/src/app/components/ui/alert-dialog.tsx: confirmation/destructive modal wrapper.
- frontend/src/app/components/ui/aspect-ratio.tsx: fixed media ratio container.
- frontend/src/app/components/ui/avatar.tsx: user avatar primitive.
- frontend/src/app/components/ui/badge.tsx: small status/label pill.
- frontend/src/app/components/ui/breadcrumb.tsx: breadcrumb navigation primitives.
- frontend/src/app/components/ui/button.tsx: shared button variants.
- frontend/src/app/components/ui/calendar.tsx: day picker calendar wrapper.
- frontend/src/app/components/ui/card.tsx: panel/card primitives.
- frontend/src/app/components/ui/carousel.tsx: embla-based carousel wrapper.
- frontend/src/app/components/ui/chart.tsx: chart styling helpers/components.
- frontend/src/app/components/ui/checkbox.tsx: checkbox primitive.
- frontend/src/app/components/ui/collapsible.tsx: collapsible primitive wrapper.
- frontend/src/app/components/ui/command.tsx: command palette primitives.
- frontend/src/app/components/ui/context-menu.tsx: context menu primitives.
- frontend/src/app/components/ui/dialog.tsx: modal dialog primitives.
- frontend/src/app/components/ui/drawer.tsx: mobile drawer panel.
- frontend/src/app/components/ui/dropdown-menu.tsx: dropdown primitives.
- frontend/src/app/components/ui/form.tsx: react-hook-form utility wrappers.
- frontend/src/app/components/ui/hover-card.tsx: hover-card primitives.
- frontend/src/app/components/ui/input.tsx: text input primitive.
- frontend/src/app/components/ui/input-otp.tsx: OTP input primitive.
- frontend/src/app/components/ui/label.tsx: form label primitive.
- frontend/src/app/components/ui/menubar.tsx: menu bar primitives.
- frontend/src/app/components/ui/navigation-menu.tsx: nav menu primitives.
- frontend/src/app/components/ui/pagination.tsx: pagination components.
- frontend/src/app/components/ui/popover.tsx: popover primitives.
- frontend/src/app/components/ui/progress.tsx: progress bar primitive.
- frontend/src/app/components/ui/radio-group.tsx: radio group primitives.
- frontend/src/app/components/ui/resizable.tsx: resizable panel wrappers.
- frontend/src/app/components/ui/scroll-area.tsx: styled scroll container.
- frontend/src/app/components/ui/select.tsx: select/dropdown primitives.
- frontend/src/app/components/ui/separator.tsx: visual separator line.
- frontend/src/app/components/ui/sheet.tsx: slide-over sheet wrapper.
- frontend/src/app/components/ui/sidebar.tsx: sidebar layout primitives.
- frontend/src/app/components/ui/skeleton.tsx: base skeleton block.
- frontend/src/app/components/ui/slider.tsx: slider primitive.
- frontend/src/app/components/ui/sonner.tsx: toaster provider export.
- frontend/src/app/components/ui/switch.tsx: toggle switch primitive.
- frontend/src/app/components/ui/table.tsx: table structure primitives.
- frontend/src/app/components/ui/tabs.tsx: tab primitives.
- frontend/src/app/components/ui/textarea.tsx: multiline text input.
- frontend/src/app/components/ui/toggle.tsx: boolean toggle primitive.
- frontend/src/app/components/ui/toggle-group.tsx: grouped toggles.
- frontend/src/app/components/ui/tooltip.tsx: tooltip primitives.
- frontend/src/app/components/ui/use-mobile.ts: responsive/mobile media helper hook.
- frontend/src/app/components/ui/utils.ts: utility helpers for UI wrappers.

### 11.9 Styling files

- frontend/src/styles/index.css: imports fonts, tailwind, theme, leaflet CSS.
- frontend/src/styles/tailwind.css: Tailwind v4 source directives and utility additions.
- frontend/src/styles/theme.css: design tokens via CSS variables and base typography.
- frontend/src/styles/fonts.css: font-face declarations (currently empty).

### 11.10 TypeScript environment helper

- frontend/src/vite-env.d.ts: Vite TypeScript ambient type declarations.

## 12) Where to put new code

Use these placement rules:
- New backend call: frontend/src/services/api/<domain>.ts
- New response DTO type: frontend/src/services/api/shared/contracts.ts
- New backend->frontend mapping: frontend/src/services/api/shared/normalizers.ts
- New cached fetch hook: frontend/src/hooks/queries/useSomething.ts
- New route-level page: frontend/src/app/pages/NewPage.tsx + routes.tsx
- New reusable visual piece: frontend/src/app/components/NewComponent.tsx
- New truly global constants/types: frontend/src/core/constants.ts or frontend/src/core/types.ts
- New app-global persistent state: frontend/src/store/appStore.ts

## 13) Practical change playbooks

### 13.1 Change an existing endpoint path or payload

1. Update domain API method request URL/body.
2. Update contracts if response changed.
3. Update normalizer if field names changed.
4. Update query hook input/output types.
5. Test affected page.

### 13.2 Add a new dashboard widget with backend data

1. Add API method in dashboard.ts or correct domain file.
2. Add hook in frontend/src/hooks/queries (or extend existing dashboard hook).
3. Add query key in keys.ts.
4. Render in UserDashboard or HostDashboard.
5. Invalidate relevant keys in mutations.

### 13.3 Add a new admin page

1. Create page in frontend/src/app/pages.
2. Add route in routes.tsx under admin path.
3. Wrap route with ProtectedRoute requireAdmin.
4. Add navigation entry from admin dashboard/menu.
5. Build domain API methods + hooks used by page.

## 14) Common pitfalls and guardrails

- Do not return raw backend DTOs directly to pages; normalize first.
- Keep query keys stable and centralized; avoid ad-hoc arrays in many places.
- Prefer query hooks over page-local fetch useEffect patterns.
- Keep auth token handling only in shared client, not scattered in pages/components.
- Keep app-wide state in store minimal; put server data in React Query.
- When changing route-level behavior, verify RootLayout visibility rules (header/footer/fullscreen logic).
- FormData requests should not force Content-Type manually (shared client already handles this).

## 15) Suggested maintenance improvement

This file now documents the full structure. As the code evolves, update section 11 first.

Recommended update cadence:
- whenever a new page is added
- whenever a new domain API file is added
- whenever routing or provider stack changes
