export type PanelTone = 'is-match' | 'is-mismatch' | 'is-pending' | 'is-warning';

export type PlanReconciliationKind = 'loading' | 'error' | 'empty' | 'match' | 'mismatch' | 'waiting';

export interface PlanReconciliationState {
  kind: PlanReconciliationKind;
  tone: PanelTone;
  label: string;
  description: string;
}

interface PlanReconciliationInput {
  detailsLoading: boolean;
  detailsError: boolean;
  detailsLoaded: boolean;
  reportLoading: boolean;
  reportError: boolean;
  detailCount: number;
  isMatch: boolean | null;
}

export function resolvePlanReconciliationState(input: PlanReconciliationInput): PlanReconciliationState {
  if (input.detailsError || input.reportError) {
    return {
      kind: 'error',
      tone: 'is-mismatch',
      label: '发货计划加载失败',
      description: '接口异常不会再被当成零条明细，请重新加载。',
    };
  }
  if (input.detailsLoading || input.reportLoading || !input.detailsLoaded) {
    return {
      kind: 'loading',
      tone: 'is-pending',
      label: '正在加载发货计划',
      description: '正在读取确认版发货明细与报数数据。',
    };
  }
  if (input.detailCount === 0) {
    return {
      kind: 'empty',
      tone: 'is-pending',
      label: '尚未建立发货计划',
      description: '接口已成功返回，本期确实没有发货明细。',
    };
  }
  if (input.isMatch === true) {
    return {
      kind: 'match',
      tone: 'is-match',
      label: '计划已对平',
      description: '确认报数与当前计划及已归因停发已经对平。',
    };
  }
  if (input.isMatch === false) {
    return {
      kind: 'mismatch',
      tone: 'is-mismatch',
      label: '计划明细不一致',
      description: '确认报数与当前计划仍存在未归因差异。',
    };
  }
  return {
    kind: 'waiting',
    tone: 'is-pending',
    label: '等待计划校验',
    description: '发货明细已加载，暂无可用的报数校验。',
  };
}

export type FulfillmentPanelKind = 'loading' | 'error' | 'pending' | 'partial' | 'shipped' | 'exception';

export interface FulfillmentPanelState {
  kind: FulfillmentPanelKind;
  tone: PanelTone;
  label: string;
  description: string;
}

export function resolveFulfillmentPanelState(input: {
  loading: boolean;
  error: boolean;
  status?: 'pending' | 'partial' | 'shipped' | 'exception';
}): FulfillmentPanelState {
  if (input.error) {
    return {
      kind: 'error',
      tone: 'is-mismatch',
      label: '发货核销加载失败',
      description: '未把接口异常误判为待发货，请重新加载。',
    };
  }
  if (input.loading || !input.status) {
    return {
      kind: 'loading',
      tone: 'is-pending',
      label: '正在加载核销状态',
      description: '正在读取运单与无需运单记录。',
    };
  }
  if (input.status === 'shipped') {
    return {
      kind: 'shipped',
      tone: 'is-match',
      label: '已完成发货核销',
      description: '当前计划已全部取得运单或明确无需运单。',
    };
  }
  if (input.status === 'exception') {
    return {
      kind: 'exception',
      tone: 'is-mismatch',
      label: '发货核销存在超额',
      description: '累计处理份数超过计划应发，请检查运单份数。',
    };
  }
  if (input.status === 'partial') {
    return {
      kind: 'partial',
      tone: 'is-warning',
      label: '部分已发货',
      description: '已有部分运单，仍有份数需要补录。',
    };
  }
  return {
    kind: 'pending',
    tone: 'is-warning',
    label: '待录入运单',
    description: '发货计划已存在，尚未登记实际运单。',
  };
}

type ApiErrorLike = {
  code?: string;
  response?: {
    status?: number;
    data?: { detail?: unknown } | string;
  };
};

export function logisticsApiErrorMessage(error: unknown, fallback: string): string {
  const apiError = error as ApiErrorLike;
  const data = apiError?.response?.data;
  const detail = typeof data === 'object' && data !== null ? data.detail : undefined;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (!apiError?.response) {
    if (apiError?.code === 'ECONNABORTED' || apiError?.code === 'ETIMEDOUT') {
      return `${fallback}：处理超时，后台可能已经完成，请刷新页面确认。`;
    }
    return `${fallback}：无法连接服务器，请检查后端服务。`;
  }
  if ((apiError.response.status ?? 0) >= 500) {
    return `${fallback}：服务器内部错误，请管理员检查数据库迁移状态。`;
  }
  if (typeof data === 'string' && data.trim() && data !== 'Internal Server Error') return data;
  return fallback;
}
