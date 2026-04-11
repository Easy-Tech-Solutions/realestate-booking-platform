import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { differenceInDays, format, parseISO } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
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
  serviceFeePercent: number = 0.14,
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
