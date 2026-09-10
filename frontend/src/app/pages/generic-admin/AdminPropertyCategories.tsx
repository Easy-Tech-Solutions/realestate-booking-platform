import { GenericAdminPage } from './GenericAdminPage';
import { propertyCategoryConfig } from './configs/propertyCategory.config';

export function AdminPropertyCategories() {
  return <GenericAdminPage config={propertyCategoryConfig} />;
}
