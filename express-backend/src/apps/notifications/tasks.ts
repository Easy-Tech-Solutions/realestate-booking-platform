// notifications.tasks — Celery tasks (same dotted names, same retry policy:
// max_retries=3, default_retry_delay=60). No CELERY_BEAT_SCHEDULE entries
// exist for this app.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Selectable } from 'kysely';
import { config } from '../../config.js';
import type { NotificationsNotification, UsersUser } from '../../db/schema.js';
import { db } from '../../db/index.js';
import { defineTask } from '../../lib/jobs.js';
import { logger } from '../../lib/logger.js';
import { sendMail, type Attachment } from '../../lib/mail.js';
import { renderToString } from '../../lib/templates.js';
import { sendPushToUser } from './pushService.js';

/** settings.FRONTEND_ORIGIN or settings.LOCAL_DOMAIN */
export function siteUrl(): string {
  const frontend = process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173';
  return frontend || (process.env.LOCAL_DOMAIN ?? 'localhost:8000');
}

/** site_url.rstrip('/') + '/' + ADMIN_URL.lstrip('/'), always ending in '/'. */
export function adminUrl(site = siteUrl()): string {
  const adminPath = (process.env.DJANGO_ADMIN_URL ?? 'admin/').replace(/^\/+/, '');
  let url = site.replace(/\/+$/, '') + '/' + adminPath;
  if (!url.endsWith('/')) url += '/';
  return url;
}

/** settings.DEFAULT_FROM_EMAIL or 'noreply@realestate.com' */
function fromEmail(): string {
  return (process.env.DEFAULT_FROM_EMAIL ?? 'homekonnet@gmail.com') || 'noreply@realestate.com';
}

function isMissingTemplate(e: unknown): boolean {
  return (e as { code?: string })?.code === 'ENOENT';
}

async function readMedia(name: string): Promise<Buffer> {
  return readFile(join(config.mediaRoot, name));
}

type NotificationRow = Selectable<NotificationsNotification>;
type UserRow = Selectable<UsersUser>;

/** The HTML body send_notification_email renders (specific template → generic → bare <p>). */
export function renderNotificationEmail(notification: NotificationRow, user: UserRow): string {
  const site = siteUrl();
  const fullName = `${user.first_name} ${user.last_name}`.trim();
  const data = (notification.data ?? {}) as Record<string, unknown>;
  const context = {
    // get_full_name falls back to the username here because lib/templates.ts
    // treats `default:user.username` as a literal; the rendered output is the
    // same as Django's `{{ user.get_full_name|default:user.username }}`.
    user: { ...user, get_full_name: () => fullName || user.username },
    notification,
    data,
    site_name: config.siteName,
    site_url: site,
    admin_url: adminUrl(site),
  };

  let html: string;
  try {
    html = renderToString(`emails/notifications/${notification.notification_type}.html`, context);
  } catch (e) {
    if (!isMissingTemplate(e)) throw e;
    try {
      html = renderToString('emails/notifications/generic.html', context);
    } catch (e2) {
      if (!isMissingTemplate(e2)) throw e2;
      logger.error(`send_notification_email: no template found for ${notification.notification_type}`);
      html = `<p>${notification.message}</p>`;
    }
  }

  return html;
}

/** send_notification_email(notification_id) */
export async function sendNotificationEmail(notificationId: number): Promise<void> {
  const notification = await db.selectFrom('notifications_notification').selectAll().where('id', '=', Number(notificationId)).executeTakeFirst();
  if (!notification) {
    logger.warn(`send_notification_email: Notification ${notificationId} not found`);
    return;
  }
  const user = await db.selectFrom('users_user').selectAll().where('id', '=', notification.user_id).executeTakeFirstOrThrow();
  if (!user.email) {
    logger.info(`send_notification_email: user ${user.id} has no email address, skipping`);
    return;
  }
  const html = renderNotificationEmail(notification, user);
  const data = (notification.data ?? {}) as Record<string, unknown>;

  try {
    const attachments: Attachment[] = [];
    const leaseBookingId = data.attach_lease_booking_id;
    if (leaseBookingId) {
      try {
        const lease = await db.selectFrom('leaseagreements_leaseagreement').select('document')
          .where('booking_id', '=', Number(leaseBookingId)).orderBy('generated_at', 'desc').executeTakeFirst();
        if (lease && lease.document) attachments.push({ filename: 'Agreement-of-Lease.pdf', content: await readMedia(lease.document), mimetype: 'application/pdf' });
      } catch (e) {
        logger.error({ err: e }, `Could not attach lease for booking ${leaseBookingId}`);
      }
    }
    const ownerAgreementAppId = data.attach_owner_agreement_application_id;
    if (ownerAgreementAppId) {
      try {
        const app = await db.selectFrom('hostapplications_hostapplication').select('agreement_document')
          .where('id', '=', Number(ownerAgreementAppId)).executeTakeFirst();
        if (app && app.agreement_document) attachments.push({ filename: 'Property-Owner-Agreement.pdf', content: await readMedia(app.agreement_document), mimetype: 'application/pdf' });
      } catch (e) {
        logger.error({ err: e }, `Could not attach owner agreement for application ${ownerAgreementAppId}`);
      }
    }

    await sendMail(notification.title, notification.message, fromEmail(), [user.email], html, { attachments });

    await db.updateTable('notifications_notification').set({ email_sent: true }).where('id', '=', notification.id).execute();
    logger.info(`Notification email sent: id=${notificationId} type=${notification.notification_type} to=${user.email}`);
  } catch (exc) {
    logger.error(`Failed to send notification email id=${notificationId}: ${exc}`);
    throw exc; // self.retry(exc=exc)
  }
}

/** send_push_notification_task(notification_id) */
export async function sendPushNotificationTask(notificationId: number): Promise<void> {
  const notification = await db.selectFrom('notifications_notification').selectAll().where('id', '=', Number(notificationId)).executeTakeFirst();
  if (!notification) {
    logger.warn(`send_push_notification_task: Notification ${notificationId} not found`);
    return;
  }
  try {
    await sendPushToUser(notification.user_id, notification.title, notification.message, {
      notification_id: String(notification.id),
      notification_type: notification.notification_type,
    }, '/');
  } catch (exc) {
    logger.error(`Failed to send push notification id=${notificationId}: ${exc}`);
    throw exc; // self.retry(exc=exc)
  }
}

defineTask('notifications.tasks.send_notification_email', sendNotificationEmail as (id: never) => Promise<void>, { maxRetries: 3, retryDelaySeconds: 60 });
defineTask('notifications.tasks.send_push_notification_task', sendPushNotificationTask as (id: never) => Promise<void>, { maxRetries: 3, retryDelaySeconds: 60 });
