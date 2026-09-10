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
  description: 'Supported currencies and their USD exchange rates, used for pricing and payouts.',
  searchPlaceholder: 'Search code or name…',
  defaultOrdering: 'code',
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
