type ApiErrorResponse = {
  code?: string;
  response?: {
    status?: number;
    data?: unknown;
  };
};

/** 没有收到写操作结果，不能据此认定服务器已经回滚。 */
export function isApiConnectionError(error: unknown): boolean {
  const apiError = error as ApiErrorResponse | null;
  return !apiError?.response && ['ECONNABORTED', 'ETIMEDOUT', 'ERR_NETWORK'].includes(apiError?.code ?? '');
}

function validationDetail(detail: unknown): string | null {
  if (!Array.isArray(detail)) return null;
  const messages = detail
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const message = (item as { msg?: unknown }).msg;
      return typeof message === 'string' ? message.trim() : null;
    })
    .filter((message): message is string => !!message);
  return messages.length ? messages.join('；') : null;
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (isApiConnectionError(error)) {
    return (error as ApiErrorResponse).code === 'ERR_NETWORK'
      ? '网络连接已中断，尚未收到服务器处理结果，请先核对操作结果，勿重复提交'
      : '请求等待超时，服务器可能仍在处理，请先核对操作结果，勿重复提交';
  }
  const response = (error as ApiErrorResponse | null)?.response;
  const data = response?.data;
  if (data && typeof data === 'object') {
    const detail = (data as { detail?: unknown }).detail;
    if (typeof detail === 'string' && detail.trim()) return detail.trim();
    const validationMessage = validationDetail(detail);
    if (validationMessage) return validationMessage;
  }
  if (typeof data === 'string' && data.trim() && data.trim() !== 'Internal Server Error') {
    return data.trim();
  }
  if (response?.status && response.status >= 500) {
    return `${fallback}：服务器处理异常；若系统刚升级，请确认数据库迁移已完成`;
  }
  return fallback;
}
