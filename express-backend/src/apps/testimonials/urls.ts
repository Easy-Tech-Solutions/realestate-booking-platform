// testimonials — /api/testimonials/ (port of testimonials/views.py + serializers.py).

import type { Selectable } from 'kysely';
import { db } from '../../db/index.js';
import type { TestimonialsTestimonial } from '../../db/schema.js';
import { mediaUrl } from '../../domain/users.js';
import { drf } from '../../lib/datetime.js';
import { AllowAny, apiView } from '../../lib/view.js';
import { djangoRouter } from '../../routes/registry.js';
import { charField, FieldErr } from '../suspensions/serializers.js';
import { pyStr, pyStrip, pyTypeName, pyUpper, requestData } from '../users/request.js';

const AVATAR_COLORS = ['emerald', 'blue', 'orange', 'purple', 'rose', 'teal', 'indigo', 'amber', 'cyan', 'lime'];

/** Testimonial.avatar_initials */
function avatarInitials(name: string): string {
  const parts = pyStrip(name).split(/[\s\u001c-\u001f\u0085]+/u).filter(Boolean);
  if (parts.length >= 2) return pyUpper([...parts[0]!][0]! + [...parts[parts.length - 1]!][0]!);
  return name ? pyUpper([...name].slice(0, 2).join('')) : '??';
}

async function serializeTestimonial(t: Selectable<TestimonialsTestimonial>) {
  let avatar: string | null = null;
  if (t.user_id !== null) {
    const p = await db.selectFrom('users_profile').select('image').where('user_id', '=', t.user_id).executeTakeFirst();
    if (p && p.image) avatar = mediaUrl(p.image);
  }
  return {
    id: t.id, name: t.name, location: t.location, rating: t.rating, quote: t.quote, avatar_color: t.avatar_color,
    avatar_initials: avatarInitials(t.name), user_avatar: avatar, created_at: drf(t.created_at as unknown as string),
  };
}

/** DRF IntegerField(min_value=1, max_value=5) */
function ratingField(v: unknown): number {
  if (v === null) throw new FieldErr('This field may not be null.');
  if (typeof v === 'string' && v.length > 1000) throw new FieldErr('String value too large.');
  const s = typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? pyStr(v).replace(/\.0*\s*$/u, '') : null;
  if (s === null || !/^\s*[+-]?\d+(_\d+)*\s*$/u.test(s)) throw new FieldErr('A valid integer is required.');
  const n = Number(s.trim().replace(/_/g, ''));
  if (n > 5) throw new FieldErr('Ensure this value is less than or equal to 5.');
  if (n < 1) throw new FieldErr('Ensure this value is greater than or equal to 1.');
  return n;
}

const r = djangoRouter('api/testimonials/');

r.path('', apiView({
  permissions: [AllowAny],
  async GET() {
    const rows = await db.selectFrom('testimonials_testimonial').selectAll().where('is_active', '=', true).orderBy('created_at', 'desc').execute();
    const out = [];
    for (const t of rows) out.push(await serializeTestimonial(t));
    return out;
  },
  async POST(req, res) {
    if (!req.user) return res.status(401).json({ error: 'You must be signed in to share a testimonial.' });
    const { data } = await requestData(req, res);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return res.status(400).json({ non_field_errors: [`Invalid data. Expected a dictionary, but got ${pyTypeName(data)}.`] });
    }
    const d = data as Record<string, unknown>;
    const has = (k: string) => Object.prototype.hasOwnProperty.call(d, k);
    const errors: Record<string, string[]> = {};
    let location: string | undefined; let rating = 5; let quote = '';
    try { if (has('location')) location = charField(d.location, { allowBlank: true, maxLength: 150 })!; } catch (e) { if (e instanceof FieldErr) errors.location = [e.message]; else throw e; }
    try { if (has('rating')) rating = ratingField(d.rating); } catch (e) { if (e instanceof FieldErr) errors.rating = [e.message]; else throw e; }
    try {
      if (!has('quote')) throw new FieldErr('This field is required.');
      quote = charField(d.quote, { minLength: 5, maxLength: 1000 })!;
    } catch (e) { if (e instanceof FieldErr) errors.quote = [e.message]; else throw e; }
    if (Object.keys(errors).length) return res.status(400).json(errors);

    const user = req.user;
    const fullName = pyStrip(`${user.first_name} ${user.last_name}`) || user.username;
    const { n } = await db.selectFrom('testimonials_testimonial').select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow();
    const t = await db.insertInto('testimonials_testimonial').values({
      user_id: user.id, name: fullName, location: location ?? '', rating, quote,
      avatar_color: AVATAR_COLORS[Number(n) % AVATAR_COLORS.length]!, is_active: true, created_at: new Date(),
    }).returningAll().executeTakeFirstOrThrow();
    return res.status(201).json(await serializeTestimonial(t));
  },
}));
