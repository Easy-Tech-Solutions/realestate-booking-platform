export interface AuthLoginResponse {
  user: unknown;
  access: string;
  refresh: string;
}

export interface ListingPricingResponse {
  nights: number;
  base_price: number;
  subtotal: number;
  discount: number;
  discount_label: string | null;
  discounted_subtotal: number;
  cleaning_fee: number;
  service_fee: number;
  taxes: number;
  total: number;
}

export interface AvailabilityResponse {
  booked_dates: string[];
}

export interface DashboardSummaryResponse {
  total_revenue?: string;
  total_bookings?: number;
  total_listings?: number;
}

export interface DashboardFavoriteResponse {
  id: number;
  created_at: string;
  listing?: unknown;
}

export interface DashboardResponse {
  user?: unknown;
  listings?: unknown[];
  bookings_as_customer?: unknown[];
  bookings_on_my_listings?: unknown[];
  favorites?: DashboardFavoriteResponse[];
  summary?: DashboardSummaryResponse;
}

export interface NotificationPreferencesResponse {
  in_app_enabled?: boolean;
  new_message_email?: boolean;
  search_alert_email?: boolean;
}

export interface PaymentEnvelope {
  payment?: unknown;
}