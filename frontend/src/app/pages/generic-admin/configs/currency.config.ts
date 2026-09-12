import type { GenericAdminConfig } from '../types';

export interface CurrencyRow {
  id: number;
  code: string;
  name: string;
  symbol: string;
  exchange_rate_to_usd: string;
  is_active: boolean;
}

export const currencyConfig: GenericAdminConfig<CurrencyRow> = {
  modelKey: 'currency',
  title: 'Currencies',
  // Read-only reference view — currency codes are hardcoded throughout the
  // MTN MoMo gateway (payments/gateways/mtn_momo.py) and PaymentService, so
  // creating/renaming/deleting one here would silently break payments. Rate
  // editing (the one thing that's actually safe to change) lives on the
  // Finance & Legal Center page instead — see AdminFinance.tsx's
  // CurrencyRatesSection, backed by the dedicated /api/payments/admin/currencies/
  // endpoint that keeps `code` immutable and blocks create/delete entirely.
  description: 'Supported currencies and their USD exchange rates (view-only — edit rates from Finance & Legal Center).',
  searchPlaceholder: 'Search code or name…',
  defaultOrdering: 'code',
  readOnly: true,
  fields: [
    { key: 'id', label: 'ID', type: 'readonly', showInForm: false },
    { key: 'code', label: 'Code', type: 'text', required: true, placeholder: 'e.g. GHS' },
    { key: 'name', label: 'Name', type: 'text', required: true, placeholder: 'e.g. Ghanaian Cedi' },
    { key: 'symbol', label: 'Symbol', type: 'text', required: true, placeholder: 'e.g. ₵' },
    { key: 'exchange_rate_to_usd', label: 'Exchange Rate to USD', type: 'number', required: true },
    { key: 'is_active', label: 'Active', type: 'boolean' },
  ],
  confirmDeleteLabel: (row) => `Delete the ${row.code} currency? Existing records that reference it are unaffected.`,
};
