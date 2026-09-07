import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { differenceInDays, format, parseISO } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, currency: string = 'USD'): string {
  // Show cents only when they're non-zero so round figures stay clean
  // ($30, $120) but fee breakdowns stay accurate ($4.80, $6.34).
  const hasCents = Math.abs(amount - Math.trunc(amount)) > 0.005;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  }).format(amount);
}

// Room-based listings (hotel/lodge) don't have a single meaningful price —
// each room type is priced independently. Cards/headline prices show the
// cheapest active room's rate as a "from" price instead of the listing's own
// `price` field (which, for these listings, is just a starting-price snapshot
// taken at publish time and can go stale as rooms are added/edited later).
export function getListingDisplayPrice(
  property: { price: number; hotelRooms?: { pricePerNight: number; isActive: boolean }[] },
): { amount: number; isFromPrice: boolean } {
  const activeRooms = property.hotelRooms?.filter((r) => r.isActive) ?? [];
  if (activeRooms.length === 0) {
    return { amount: property.price, isFromPrice: false };
  }
  return { amount: Math.min(...activeRooms.map((r) => r.pricePerNight)), isFromPrice: true };
}

export function formatDate(date: string | Date, formatStr: string = 'MMM d, yyyy'): string {
  const dateObj = typeof date === 'string' ? parseISO(date) : date;
  return format(dateObj, formatStr);
}

export function calculateNights(checkIn: Date, checkOut: Date): number {
  return differenceInDays(checkOut, checkIn);
}

export function calculateTotalPrice(
  basePrice: number,
  nights: number,
  cleaningFee: number = 0,
  serviceFeePercent: number = 0.04,
  taxPercent: number = 0.12
): {
  subtotal: number;
  cleaningFee: number;
  serviceFee: number;
  taxes: number;
  total: number;
} {
  const subtotal = basePrice * nights;
  const serviceFee = Math.round(subtotal * serviceFeePercent);
  const taxes = Math.round((subtotal + cleaningFee + serviceFee) * taxPercent);
  const total = subtotal + cleaningFee + serviceFee + taxes;

  return {
    subtotal,
    cleaningFee,
    serviceFee,
    taxes,
    total,
  };
}

export function generateMockId(): string {
  return Math.random().toString(36).substr(2, 9);
}

export function getInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout>;
  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

export function isDateBooked(date: Date, bookedDates: string[]): boolean {
  const dateStr = format(date, 'yyyy-MM-dd');
  return bookedDates.includes(dateStr);
}

export function generateDateRange(start: Date, end: Date): Date[] {
  const dates: Date[] = [];
  const currentDate = new Date(start);

  while (currentDate <= end) {
    dates.push(new Date(currentDate));
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return dates;
}
