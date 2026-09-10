import { GenericAdminPage } from './GenericAdminPage';
import { subscriberConfig } from './configs/subscriber.config';

export function AdminSubscribers() {
  return <GenericAdminPage config={subscriberConfig} />;
}
