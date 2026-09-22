import { describe, expect, it } from 'vitest';

import { getApiErrorMessage, isApiConnectionError } from './errorMessage';

describe('getApiErrorMessage', () => {
  it('uses a backend detail string', () => {
    expect(getApiErrorMessage({ response: { data: { detail: '附件类型不正确' } } }, '保存失败'))
      .toBe('附件类型不正确');
  });

  it('joins FastAPI validation messages', () => {
    const error = {
      response: {
        status: 422,
        data: { detail: [{ msg: '请选择结算对象' }, { msg: '日期格式错误' }] },
      },
    };
    expect(getApiErrorMessage(error, '保存失败')).toBe('请选择结算对象；日期格式错误');
  });

  it('turns an opaque server error into an actionable message', () => {
    const error = { response: { status: 500, data: 'Internal Server Error' } };
    expect(getApiErrorMessage(error, '保存失败'))
      .toBe('保存失败：服务器处理异常；若系统刚升级，请确认数据库迁移已完成');
  });

  it.each(['ECONNABORTED', 'ETIMEDOUT'])('explains %s without assuming the write failed', (code) => {
    expect(getApiErrorMessage({ code }, '导入失败'))
      .toBe('请求等待超时，服务器可能仍在处理，请先核对操作结果，勿重复提交');
    expect(isApiConnectionError({ code })).toBe(true);
  });

  it('explains a lost connection without exposing the request or credentials', () => {
    expect(getApiErrorMessage({ code: 'ERR_NETWORK', message: 'sensitive request details' }, '导入失败'))
      .toBe('网络连接已中断，尚未收到服务器处理结果，请先核对操作结果，勿重复提交');
  });

  it('keeps a server rejection distinct from a connection failure', () => {
    const error = { code: 'ERR_NETWORK', response: { status: 409, data: { detail: '草稿已变化，请刷新' } } };
    expect(isApiConnectionError(error)).toBe(false);
    expect(getApiErrorMessage(error, '导入失败')).toBe('草稿已变化，请刷新');
    expect(isApiConnectionError(null)).toBe(false);
    expect(getApiErrorMessage(new Error('internal details'), '导入失败')).toBe('导入失败');
  });
});
