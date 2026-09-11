import type { GenericAdminConfig } from '../types';

export interface PropertyCategoryRow {
  id: number;
  name: string;
  slug: string;
  is_active: boolean;
  sort_order: number;
  listings_count: number;
}

export const propertyCategoryConfig: GenericAdminConfig<PropertyCategoryRow> = {
  modelKey: 'property_category',
  title: 'Property Categories',
  description: 'The category taxonomy used to tag and browse listings (Homes, Apartment, Hotel, etc.).',
  searchPlaceholder: 'Search name or slug…',
  defaultOrdering: 'sort_order',
  fields: [
    { key: 'id', label: 'ID', type: 'readonly', showInForm: false },
    { key: 'name', label: 'Name', type: 'text', required: true },
    { key: 'slug', label: 'Slug', type: 'text', placeholder: 'auto-generated if left blank', helpText: 'Used in category filter URLs — leave blank to auto-generate from the name. Renaming it once listings use this category is blocked (they store the slug as plain text, not a link, so a rename would silently orphan them).' },
    { key: 'sort_order', label: 'Sort Order', type: 'number', helpText: 'Lower numbers appear first.' },
    { key: 'is_active', label: 'Active', type: 'boolean' },
    { key: 'listings_count', label: 'Listings', type: 'readonly', showInForm: false },
  ],
  confirmDeleteLabel: (row) => `Delete the "${row.name}" category? ${row.listings_count} listing(s) currently tagged with it keep their tag.`,
};
