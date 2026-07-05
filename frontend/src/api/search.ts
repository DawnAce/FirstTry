import type { AxiosResponse } from 'axios';
import api from './client';

export type SearchHitType = 'order' | 'recipient' | 'product' | 'issue';

export interface SearchHit {
  type: SearchHitType;
  id: number;
  title: string;
  subtitle: string | null;
  /** 精确定位串（外部单号 / 商品编码 / 期号 / 收报人姓名），前端据此跳转/预填。 */
  ref: string | null;
}

export interface GlobalSearchOut {
  items: SearchHit[];
}

export function globalSearch(q: string): Promise<AxiosResponse<GlobalSearchOut>> {
  return api.get('/search', { params: { q } });
}
