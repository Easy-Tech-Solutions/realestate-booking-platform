import type { ReactNode } from 'react';

export type FieldType = 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'readonly' | 'datetime';

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldConfig<T = any> {
  key: string;                          // must match the backend field name
  label: string;
  type: FieldType;
  required?: boolean;
  options?: FieldOption[];              // for type === 'select'
  placeholder?: string;
  helpText?: string;
  showInForm?: boolean;                 // default true
  showInTable?: boolean;                // default true
  renderCell?: (row: T) => ReactNode;   // escape hatch: badges, stars, etc.
}

export interface GenericAdminConfig<T extends { id: number }> {
  modelKey: string;                     // matches the backend registry key
  title: string;
  description?: string;
  fields: FieldConfig<T>[];             // single source of truth for both table columns and form fields
  searchPlaceholder?: string;
  defaultOrdering?: string;
  confirmDeleteLabel?: (row: T) => string;
  // View-only: hides New/Edit/Delete/bulk-select entirely. Must match the
  // backend ModelConfig's `read_only=True` for this model_key — this flag
  // only controls whether the UI *offers* mutation, the backend is what
  // actually enforces it (a read-only page pointed at a mutable backend
  // registration would just be misleading, not actually safe).
  readOnly?: boolean;
}
