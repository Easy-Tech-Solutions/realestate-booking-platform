# Real Estate Booking Platform — React Frontend (Migration Starter)

This is the React starter for migrating the static HTML/CSS/JS UI under `../frontend` to a modern React app. It keeps visual parity by importing the legacy theme CSS and Bootstrap, while providing routes, layout, and a service layer compatible with both Express and Python backends.

## Quick start

```bash
cd react-frontend
npm install
npm run dev
```

Set `VITE_API_BASE_URL` in a `.env` file at the project root if your API origin is not the same as the dev server.

## Structure

- `src/routes/AppRoutes.jsx`: Route mapping to legacy pages (e.g., `/about-us`, `/property/:id`).
- `src/components/layout/*`: `Header`, `Footer`, and `MainLayout` wrappers.
- `src/pages/*`: Page stubs referencing the original HTML file to port.
- `src/assets/css/*`: Aggregators that import legacy CSS from `../frontend/assets/css`.
- `src/services/*`: API client and domain services (`auth`, `listings`, `bookings`, `users`).
- `src/contexts/AuthContext.jsx`: Minimal auth state (token, user) and provider.
- `src/hooks/*`: `useAuth`, `useFetch` utilities.
- `src/utils/*`: Helpers for storage and formatting.

## Migration workflow

1. Open the corresponding file in `frontend/public/*.html`.
2. Copy sections into the React page (e.g., `src/pages/PropertyDetails.jsx`).
3. Replace jQuery/DOM scripts with React components + hooks.
4. Move repeated UI to `src/components/*` and import where needed.
5. Replace hard-coded data with calls to services in `src/services/*`.

Tip: The legacy CSS is imported globally for parity. As you migrate, consider moving scoped styles into components or CSS Modules for maintainability.

## Backend compatibility

The service layer uses a shared REST shape (see `src/services/endpoints.js`). Implement these endpoints in either backend:

- Express: see `backend/` for reference routes.
- Python (e.g., FastAPI/Flask): reproduce the same paths and payloads.

Configure the API origin via `VITE_API_BASE_URL`.

### Use Django backend

1. Copy env and set API base URL:

	```bash
	cd react-frontend
	cp .env.example .env
	# ensure .env contains: VITE_API_BASE_URL=http://localhost:8000
	```

2. Start the React dev server:

	```bash
	npm run dev
	```

3. Backend endpoints expected:
	- `/api/auth/login`, `/api/auth/register`, `/api/auth/me`
	- `/api/listings`, `/api/listings/:id`, `/api/listings/:id/favorite`
	- `/api/bookings`, `/api/bookings/:id`
	- `/api/users`, `/api/users/:id`

