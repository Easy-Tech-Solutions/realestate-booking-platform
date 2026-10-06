// users.models.User / Profile behaviour shared by every app.

import { sql, type Transaction } from 'kysely';
import { config } from '../config.js';
import { db, type DB } from '../db/index.js';
import { drf } from '../lib/datetime.js';
import { checkPassword } from '../lib/hashers.js';
import type { User } from '../lib/view.js';

type Executor = typeof db | Transaction<DB>;

/** User.save(): role/staff/superuser coupling + email normalisation. */
export function applyUserSaveRules<T extends { role?: string; is_superuser?: boolean; is_staff?: boolean; email?: string }>(u: T): T {
  if (u.is_superuser || u.role === 'superadmin') {
    u.role = 'superadmin';
    u.is_staff = true;
    u.is_superuser = true;
  } else if (u.role === 'admin') {
    u.is_staff = true;
  }
  if (u.email) u.email = u.email.trim().toLowerCase();
  return u;
}

export interface NewUser {
  username: string;
  email: string;
  password: string; // already hashed (or unusable)
  first_name?: string;
  last_name?: string;
  is_active?: boolean;
  role?: string;
  email_verified?: boolean;
  is_staff?: boolean;
  is_superuser?: boolean;
}

/** User.objects.create_user / User(...).save() + the post_save signal that creates the Profile. */
export async function createUser(u: NewUser, ex: Executor = db): Promise<User> {
  const row = applyUserSaveRules({
    username: u.username,
    email: u.email,
    password: u.password,
    first_name: u.first_name ?? '',
    last_name: u.last_name ?? '',
    is_active: u.is_active ?? true,
    role: u.role ?? 'user',
    email_verified: u.email_verified ?? false,
    is_staff: u.is_staff ?? false,
    is_superuser: u.is_superuser ?? false,
    is_archived: false,
    date_joined: new Date(),
  });
  const user = await ex.insertInto('users_user').values(row).returningAll().executeTakeFirstOrThrow();
  // FileField stores '' when empty, even with null=True.
  await ex.insertInto('users_profile').values({ user_id: user.id, bio: '', is_superhost: false, phone_number: '', image: '' }).execute();
  // notifications.signals: create_notification_preferences on user post_save(created)
  const { onUserCreated } = await import('./notifications.js');
  await onUserCreated(user, ex);
  return user;
}

/** ModelBackend.authenticate(username=..., password=...) incl. hash upgrade and is_active check. */
export async function authenticate(username: string, password: string): Promise<User | null> {
  const user = await db.selectFrom('users_user').selectAll().where('username', '=', username).executeTakeFirst();
  if (!user) {
    // Django runs the hasher once anyway to blunt username-enumeration timing.
    await checkPassword(password, 'pbkdf2_sha256$1000000$timingsalt$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    return null;
  }
  const { ok, upgraded } = await checkPassword(password, user.password);
  if (!ok) return null;
  if (upgraded) {
    await db.updateTable('users_user').set({ password: upgraded }).where('id', '=', user.id).execute();
    user.password = upgraded;
  }
  return user.is_active ? user : null; // user_can_authenticate
}

/** AbstractBaseUser.has_usable_password(): only the '!' prefix marks an unusable password ('' counts as usable). */
export const hasUsablePassword = (u: { password: string | null }) => u.password === null || !u.password.startsWith('!');

/** FieldFile.url for local storage: MEDIA_URL + name (None when empty). */
export function mediaUrl(name: string | null | undefined): string | null {
  if (!name) return null;
  return config.mediaUrl + name.split('/').map(encodeURIComponent).join('/');
}

/** users.serializers.ProfileSerializer */
export async function serializeProfile(userId: number, ex: Executor = db) {
  const p = await ex.selectFrom('users_profile').selectAll().where('user_id', '=', userId).executeTakeFirst();
  if (!p) return null; // RelatedObjectDoesNotExist → DRF renders None for a read-only nested field
  return { image: mediaUrl(p.image), bio: p.bio, phone_number: p.phone_number, is_superhost: p.is_superhost, last_seen: drf(p.last_seen) };
}

/** agents.models.is_approved_agent */
export async function isApprovedAgent(userId: number, ex: Executor = db): Promise<boolean> {
  const r = await ex.selectFrom('agents_agentprofile').select('id').where('user_id', '=', userId).where('is_active', '=', true).executeTakeFirst();
  return !!r;
}

/** authapp.serializers.UserSerializer (login / me / google responses). */
export async function serializeAuthUser(u: User, ex: Executor = db) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    first_name: u.first_name,
    last_name: u.last_name,
    role: u.role,
    is_staff: u.is_staff,
    email_verified: u.email_verified,
    has_password: hasUsablePassword(u),
    is_agent: await isApprovedAgent(u.id, ex),
    profile: await serializeProfile(u.id, ex),
  };
}

/** users.serializers.UserSerializer (users app — no is_agent). */
export async function serializeUser(u: User, ex: Executor = db) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    first_name: u.first_name,
    last_name: u.last_name,
    role: u.role,
    is_staff: u.is_staff,
    email_verified: u.email_verified,
    has_password: hasUsablePassword(u),
    profile: await serializeProfile(u.id, ex),
  };
}

/** Case-insensitive email match (email__iexact). */
export function emailIexact(email: string) {
  return sql<boolean>`upper(email) = upper(${email})`;
}

/** Active suspension lookup used by login/refresh/google (no ordering → Django's default Meta ordering). */
export async function activeSuspension(userId: number) {
  return db
    .selectFrom('suspensions_suspension')
    .selectAll()
    .where('user_id', '=', userId)
    .where('status', '=', 'active')
    .where((eb) => eb.or([eb('ends_at', 'is', null), eb('ends_at', '>', sql<string>`now()`)]))
    .orderBy('started_at', 'desc')
    .executeTakeFirst();
}

// ---- users.serializers (added with the users app port) -------------------------------------

/** users.serializers.PublicUserSerializer (no request in context → relative image URL). */
export async function serializePublicUser(u: User, ex: Executor = db) {
  const p = await ex.selectFrom('users_profile').selectAll().where('user_id', '=', u.id).executeTakeFirst();
  return {
    id: u.id,
    username: u.username,
    first_name: u.first_name,
    last_name: u.last_name,
    profile: p ? { image: mediaUrl(p.image), bio: p.bio, is_superhost: p.is_superhost } : null,
    is_superhost: p ? p.is_superhost : false,
    member_since: drf(u.date_joined as unknown as string),
    email_verified: u.email_verified,
  };
}

/** users.serializers.AdminUserSerializer */
export async function serializeAdminUser(u: User, ex: Executor = db) {
  const p = await ex.selectFrom('users_profile').select('phone_number').where('user_id', '=', u.id).executeTakeFirst();
  const app = await ex.selectFrom('hostapplications_hostapplication').select('momo_number')
    .where('applicant_id', '=', u.id).where('status', '=', 'approved').orderBy('updated_at', 'desc').executeTakeFirst();
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    first_name: u.first_name,
    last_name: u.last_name,
    role: u.role,
    is_staff: u.is_staff,
    is_superuser: u.is_superuser,
    is_active: u.is_active,
    email_verified: u.email_verified,
    is_archived: u.is_archived,
    deleted_at: drf(u.deleted_at as unknown as string | null),
    date_joined: drf(u.date_joined as unknown as string),
    phone_number: p ? p.phone_number : '',
    momo_number: app ? app.momo_number : '',
    has_password: hasUsablePassword(u),
  };
}

/** Blacklist every OutstandingToken of a user (get_or_create BlacklistedToken), as admin reset/deletion do. */
export async function blacklistUserTokens(userId: number, ex: Executor = db) {
  const tokens = await ex.selectFrom('token_blacklist_outstandingtoken').select('id').where('user_id', '=', userId).orderBy('user_id').execute();
  for (const t of tokens) {
    const hit = await ex.selectFrom('token_blacklist_blacklistedtoken').select('id').where('token_id', '=', t.id).executeTakeFirst();
    if (!hit) await ex.insertInto('token_blacklist_blacklistedtoken').values({ token_id: t.id, blacklisted_at: new Date() }).execute();
  }
}
