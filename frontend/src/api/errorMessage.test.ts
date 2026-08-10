import { describe, expect, it } from 'vitest';

import { getApiErrorMessage } from './errorMessage';

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
});
