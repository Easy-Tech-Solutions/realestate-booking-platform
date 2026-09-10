import { GenericAdminPage } from './GenericAdminPage';
import { currencyConfig } from './configs/currency.config';

export function AdminCurrencies() {
  return <GenericAdminPage config={currencyConfig} />;
}
