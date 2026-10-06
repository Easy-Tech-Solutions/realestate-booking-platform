// bookings.tasks (Celery) + their CELERY_BEAT_SCHEDULE entries.

import { defineTask, schedule } from '../../lib/jobs.js';
import { runExpiryTask } from './services.js';

defineTask('bookings.tasks.expire_unconfirmed_reservations', () => runExpiryTask('expire_unconfirmed_reservations'));
defineTask('bookings.tasks.expire_unpaid_reservations', () => runExpiryTask('expire_unpaid_reservations'));

// crontab(minute=0) / crontab(minute=5) — hourly
schedule('expire-unconfirmed-reservations', 'bookings.tasks.expire_unconfirmed_reservations', '0 * * * *');
schedule('expire-unpaid-reservations', 'bookings.tasks.expire_unpaid_reservations', '5 * * * *');
