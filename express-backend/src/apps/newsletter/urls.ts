// newsletter — /api/newsletter/ (port of newsletter/views.py + serializers.py).

import { randomBytes } from 'node:crypto';
import { db } from '../../db/index.js';
import { isValidEmail } from '../../lib/validators.js';
import { AllowAny, apiView } from '../../lib/view.js';
import { djangoRouter } from '../../routes/registry.js';
import { charField, FieldErr } from '../suspensions/serializers.js';
import { dget, pyTypeName, requestData, strip } from '../users/request.js';

const r = djangoRouter('api/newsletter/');

r.path('subscribe/', apiView({
  permissions: [AllowAny],
  async POST(req, res) {
    const { data, lists } = await requestData(req, res);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return res.status(400).json({ non_field_errors: [`Invalid data. Expected a dictionary, but got ${pyTypeName(data)}.`] });
    }
    const d = data as Record<string, unknown>;
    const has = (k: string) => Object.prototype.hasOwnProperty.call(d, k);
    const isForm = !req.is(['application/json', 'application/*+json']);
    const errors: Record<string, unknown> = {};
    let email = ''; let firstName: string | undefined; let interests: unknown[] = [];
    try {
      if (!has('email')) throw new FieldErr('This field is required.');
      email = charField(d.email)!;
      if (!isValidEmail(email)) throw new FieldErr('Enter a valid email address.');
    } catch (e) { if (e instanceof FieldErr) errors.email = [e.message]; else throw e; }
    try { if (has('first_name')) firstName = charField(d.first_name, { allowBlank: true, maxLength: 100 })!; } catch (e) { if (e instanceof FieldErr) errors.first_name = [e.message]; else throw e; }
    if (has('interests')) {
      const raw = isForm ? (lists.interests ?? []) : d.interests;
      if (raw === null) errors.interests = ['This field may not be null.'];
      else if (!Array.isArray(raw)) errors.interests = [`Expected a list of items but got type "${pyTypeName(raw)}".`];
      else {
        const childErrors: Record<string, string[]> = {};
        const out: string[] = [];
        raw.forEach((v, i) => {
          try { out.push(charField(v, { maxLength: 50 })!); } catch (e) { if (e instanceof FieldErr) childErrors[String(i)] = [e.message]; else throw e; }
        });
        if (Object.keys(childErrors).length) errors.interests = childErrors;
        else interests = out;
      }
    }
    if (Object.keys(errors).length) return res.status(400).json(errors);

    email = email.toLowerCase().trim();
    const fn = (firstName ?? '').trim();
    const sub = await db.selectFrom('newsletter_subscriber').selectAll().where('email', '=', email).executeTakeFirst();
    if (!sub) {
      await db.insertInto('newsletter_subscriber').values({
        email, first_name: fn, interests: JSON.stringify(interests), is_active: true,
        unsubscribe_token: randomBytes(48).toString('base64url'), subscribed_at: new Date(), unsubscribed_at: null,
      }).execute();
      return res.status(201).json({ message: 'Thank you for subscribing! You will receive updates about new listings, hotels, and exclusive deals.' });
    }
    if (sub.is_active) return res.status(200).json({ message: 'You are already subscribed.' });
    await db.updateTable('newsletter_subscriber').set({
      is_active: true, unsubscribed_at: null, first_name: fn || sub.first_name,
      interests: JSON.stringify(interests.length ? interests : sub.interests),
    }).where('id', '=', sub.id).execute();
    return res.status(200).json({ message: 'Welcome back! You have been re-subscribed.' });
  },
}));

r.path('unsubscribe/', apiView({
  permissions: [AllowAny],
  async POST(req, res) {
    const { data } = await requestData(req, res);
    const token = strip(dget(data, 'token', ''));
    if (!token) return res.status(400).json({ error: 'Token is required.' });
    const sub = await db.selectFrom('newsletter_subscriber').selectAll().where('unsubscribe_token', '=', token).executeTakeFirst();
    if (!sub) return res.status(404).json({ error: 'Invalid unsubscribe link.' });
    if (!sub.is_active) return res.status(200).json({ message: 'You are already unsubscribed.' });
    await db.updateTable('newsletter_subscriber').set({ is_active: false, unsubscribed_at: new Date() }).where('id', '=', sub.id).execute();
    return res.status(200).json({ message: 'You have been unsubscribed successfully.' });
  },
}));
