import type { GenericAdminConfig } from '../types';

export interface TestimonialRow {
  id: number;
  name: string;
  location: string;
  rating: number;
  quote: string;
  avatar_color: string;
  is_active: boolean;
  created_at: string;
}

export const testimonialConfig: GenericAdminConfig<TestimonialRow> = {
  modelKey: 'testimonial',
  title: 'Testimonials',
  description: 'Customer testimonials shown on the public site. Deactivate to hide one without deleting it.',
  searchPlaceholder: 'Search name, location, quote…',
  defaultOrdering: '-created_at',
  fields: [
    { key: 'id', label: 'ID', type: 'readonly', showInForm: false },
    { key: 'name', label: 'Name', type: 'text', required: true },
    { key: 'location', label: 'Location', type: 'text' },
    { key: 'rating', label: 'Rating', type: 'number', required: true },
    { key: 'quote', label: 'Quote', type: 'textarea', required: true, showInTable: false },
    { key: 'is_active', label: 'Active', type: 'boolean' },
    { key: 'created_at', label: 'Created', type: 'datetime', showInForm: false },
  ],
  confirmDeleteLabel: (row) => `Delete the testimonial from "${row.name}"? This cannot be undone.`,
};
