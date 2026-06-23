import type { AxiosResponse } from 'axios';
import api from './client';
import type {
  BillingType,
  DeliveryMethod,
  FulfillmentType,
  Publication,
  PublicationFormat,
  SubscriptionTerm,
} from './orders';

export type CoverageRule = 'term_from_month' | 'latest_issue' | 'explicit' | 'custom';

export interface ProductComponent {
  publication: Publication;
  subscription_term?: SubscriptionTerm | null;
  coverage_rule?: CoverageRule;
  fixed_price?: string | number | null;
  remainder?: boolean;
}

export interface Product {
  id: number;
  code: string;
  display_name: string;
  aliases: string[] | null;
  publication: Publication | null;
  publication_format: PublicationFormat;
  fulfillment_type: FulfillmentType;
  subscription_term: SubscriptionTerm | null;
  delivery_method: DeliveryMethod | null;
  billing_type: BillingType;
  coverage_rule: CoverageRule;
  coverage_start_date: string | null;
  coverage_end_date: string | null;
  list_price: string;
  is_bundle: boolean;
  components: ProductComponent[] | null;
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductCreatePayload {
  code: string;
  display_name: string;
  aliases?: string[] | null;
  publication?: Publication | null;
  publication_format?: PublicationFormat;
  fulfillment_type: FulfillmentType;
  subscription_term?: SubscriptionTerm | null;
  delivery_method?: DeliveryMethod | null;
  billing_type?: BillingType;
  coverage_rule?: CoverageRule;
  coverage_start_date?: string | null;
  coverage_end_date?: string | null;
  list_price?: string | number;
  is_bundle?: boolean;
  components?: ProductComponent[] | null;
  active?: boolean;
  notes?: string | null;
}

export type ProductUpdatePayload = Partial<Omit<ProductCreatePayload, 'code'>>;

export const productQueryKeys = {
  all: ['products'] as const,
  list: (params?: { active?: boolean; q?: string }) => ['products', params ?? {}] as const,
};

export function listProducts(params?: {
  active?: boolean;
  q?: string;
}): Promise<AxiosResponse<Product[]>> {
  return api.get('/products', { params });
}

export function createProduct(body: ProductCreatePayload): Promise<AxiosResponse<Product>> {
  return api.post('/products', body);
}

export function updateProduct(
  id: number,
  body: ProductUpdatePayload,
): Promise<AxiosResponse<Product>> {
  return api.put(`/products/${id}`, body);
}

export function deactivateProduct(id: number): Promise<AxiosResponse<Product>> {
  return api.post(`/products/${id}/deactivate`);
}

export function deleteProduct(id: number): Promise<AxiosResponse<void>> {
  return api.delete(`/products/${id}`);
}
