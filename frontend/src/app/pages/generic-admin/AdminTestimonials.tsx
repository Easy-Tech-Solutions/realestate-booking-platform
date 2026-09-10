import { GenericAdminPage } from './GenericAdminPage';
import { testimonialConfig } from './configs/testimonial.config';

export function AdminTestimonials() {
  return <GenericAdminPage config={testimonialConfig} />;
}
