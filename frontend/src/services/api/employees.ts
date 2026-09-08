import { fetchWithAuth } from './shared/client';

export interface Employee {
  id: number;
  name: string;
  role_title: string;
  momo_number: string;
  momo_network: string;
  is_active: boolean;
  created_at: string;
}

export interface EmployeePayment {
  id: string;
  employee_id: number;
  employee_name: string;
  amount: string;
  currency: string;
  description: string;
  status: 'paid' | 'failed';
  reference: string;
  error_message: string;
  created_at: string;
}

export const employeesAPI = {
  adminList: (): Promise<Employee[]> => fetchWithAuth('/api/payments/admin/employees/'),

  adminCreate: (data: { name: string; momo_number: string; role_title?: string }): Promise<Employee> =>
    fetchWithAuth('/api/payments/admin/employees/', { method: 'POST', body: JSON.stringify(data) }),

  adminUpdate: (id: number, data: Partial<{ name: string; momo_number: string; role_title: string; momo_network: string }>): Promise<Employee> =>
    fetchWithAuth(`/api/payments/admin/employees/${id}/`, { method: 'PATCH', body: JSON.stringify(data) }),

  adminDeactivate: (id: number): Promise<null> =>
    fetchWithAuth(`/api/payments/admin/employees/${id}/`, { method: 'DELETE' }),

  // Pay an employee an ad-hoc amount via a live MTN MoMo disbursement.
  adminPay: (id: number, data: { amount: string; currency: string; description?: string }): Promise<EmployeePayment> =>
    fetchWithAuth(`/api/payments/admin/employees/${id}/pay/`, { method: 'POST', body: JSON.stringify(data) }),

  adminPaymentHistory: (employeeId?: number): Promise<EmployeePayment[]> => {
    const qs = employeeId ? `?employee_id=${employeeId}` : '';
    return fetchWithAuth(`/api/payments/admin/employee-payments/${qs}`);
  },
};
