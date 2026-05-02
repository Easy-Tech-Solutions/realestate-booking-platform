# Frontend Architecture

## Standards

- API transport lives in `src/services/api/shared/client.ts`.
- API errors are normalized in `src/services/api/shared/errors.ts`.
- Backend-to-frontend mapping lives in `src/services/api/shared/normalizers.ts`.
- Domain APIs live under `src/services/api/` one file per domain.
- `src/services/api.service.ts` is a compatibility facade only.
- Server state should use TanStack Query hooks under `src/hooks/queries/`.
- App-wide providers belong in `src/providers/`.
- New screens should avoid ad hoc `useEffect` fetch logic when query hooks are appropriate.

## Expected Flow

1. Page or component calls a query or mutation hook.
2. Hook delegates to a domain API module.
3. Domain API uses the shared authenticated client.
4. Shared normalizers convert backend payloads into app types.

## Gradual Cleanup Targets

- Replace remaining `any` API signatures with DTO interfaces.
- Move more page-level data loading into query hooks.
- Add mutation hooks for create, update, and delete flows.
- Tighten TypeScript strictness in stages once the current codebase is fully typed.