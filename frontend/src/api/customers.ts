import type { AxiosResponse } from 'axios';
import api from './client';

// 客户管理（客户 = 收报人）：把订单履约目标按 收件人姓名 + 电话 聚合。
// 只读视图，口径见后端 customer_service（仅当前在订）。

export interface CustomerRow {
  recipient_name: string;
  recipient_phone: string | null;
  primary_address: string | null;
  address_count: number;
  order_count: number;
  total_quantity: number;
  publications: string[];
  last_order_date: string | null;
}

export interface CustomerListOut {
  rows: CustomerRow[];
  total: number;
}

export interface CustomerOrderLine {
  target_id: number;
  order_id: number;
  order_code: string | null;
  order_date: string;
  order_status: string;
  commercial_status: string | null;
  publication: string;
  fulfillment_type: string;
  quantity: number;
  coverage_start_date: string | null;
  coverage_end_date: string | null;
  issue_label: string | null;
  issue_number: number | null;
  shipping_channel: string;
  recipient_address: string;
  target_status: string;
}

export interface CustomerDetailOut {
  recipient_name: string;
  recipient_phone: string | null;
  total_quantity: number;
  order_count: number;
  publications: string[];
  lines: CustomerOrderLine[];
}

export interface ListCustomersParams {
  search?: string;
  page?: number;
  page_size?: number;
}

export const customerQueryKeys = {
  all: ['customers'] as const,
  list: (params?: ListCustomersParams) => ['customers', 'list', params] as const,
  detail: (name: string, phone?: string | null) =>
    ['customers', 'detail', name, phone ?? ''] as const,
};

export function listCustomers(
  params?: ListCustomersParams,
): Promise<AxiosResponse<CustomerListOut>> {
  return api.get('/customers', { params });
}

export function getCustomerDetail(
  recipient_name: string,
  recipient_phone?: string | null,
): Promise<AxiosResponse<CustomerDetailOut>> {
  return api.get('/customers/detail', {
    params: { recipient_name, recipient_phone: recipient_phone ?? undefined },
  });
}
