type ApiErrorResponse = {
  response?: {
    status?: number;
    data?: unknown;
  };
};

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
