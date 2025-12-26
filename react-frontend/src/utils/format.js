export function formatCurrency(value, currency = 'USD', locale = undefined) {
  try { return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value) } catch { return String(value) }
}

export function formatDate(value, locale = undefined, options = {}) {
  try { return new Date(value).toLocaleDateString(locale, options) } catch { return String(value) }
}
