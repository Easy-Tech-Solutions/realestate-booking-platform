import type { GenericAdminConfig } from '../types';

export interface SubscriberRow {
  id: number;
  email: string;
  interests: string[];
  is_active: boolean;
  subscribed_at: string;
  unsubscribe_token: string;
}

export const subscriberConfig: GenericAdminConfig<SubscriberRow> = {
  modelKey: 'subscriber',
  title: 'Newsletter Subscribers',
  description: 'Everyone who has subscribed to platform newsletters, and their interest tags.',
  searchPlaceholder: 'Search email…',
  defaultOrdering: '-subscribed_at',
  fields: [
    { key: 'id', label: 'ID', type: 'readonly', showInForm: false },
    { key: 'email', label: 'Email', type: 'text', required: true },
    // Backend field is a JSON list; the generic form only supports scalar
    // inputs, so this is display-only here rather than risk writing a raw
    // string into a list field. Editing interests isn't a common admin task.
    { key: 'interests', label: 'Interests', type: 'readonly', showInForm: false },
    { key: 'is_active', label: 'Subscribed', type: 'boolean' },
    { key: 'subscribed_at', label: 'Subscribed At', type: 'datetime', showInForm: false },
    { key: 'unsubscribe_token', label: 'Unsubscribe Token', type: 'readonly', showInForm: false, showInTable: false },
  ],
  confirmDeleteLabel: (row) => `Delete the subscriber "${row.email}"? This cannot be undone.`,
};
