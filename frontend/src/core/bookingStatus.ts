import type { BookingStatus } from './types';

export interface BookingStatusMeta {
  label: string;
  className: string; // tailwind classes for a status chip
}

// Single source of truth for how each booking status is shown to users.
export function bookingStatusMeta(status: BookingStatus): BookingStatusMeta {
  switch (status) {
    case 'pending_host':
    case 'pending':
      return { label: 'Awaiting host', className: 'bg-yellow-100 text-yellow-700' };
    case 'awaiting_payment':
      return { label: 'Payment due', className: 'bg-blue-100 text-blue-700' };
    case 'payment_received':
      return { label: 'Payment under review', className: 'bg-indigo-100 text-indigo-700' };
    case 'confirmed':
      return { label: 'Confirmed', className: 'bg-primary/10 text-primary' };
    case 'completed':
      return { label: 'Completed', className: 'bg-gray-100 text-gray-600' };
    case 'declined':
      return { label: 'Declined', className: 'bg-red-100 text-red-600' };
    case 'cancelled':
      return { label: 'Cancelled', className: 'bg-red-100 text-red-600' };
    case 'expired_unconfirmed':
      return { label: 'Expired (not confirmed)', className: 'bg-gray-100 text-gray-600' };
    case 'expired_unpaid':
      return { label: 'Expired (unpaid)', className: 'bg-gray-100 text-gray-600' };
    default:
      return { label: String(status), className: 'bg-gray-100 text-gray-600' };
  }
}
