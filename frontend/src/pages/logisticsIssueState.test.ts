import { describe, expect, it } from 'vitest';
import {
  logisticsApiErrorMessage,
  resolveFulfillmentPanelState,
  resolvePlanReconciliationState,
} from './logisticsIssueState';

const planBase = {
  detailsLoading: false,
  detailsError: false,
  detailsLoaded: true,
  reportLoading: false,
  reportError: false,
  detailCount: 53,
  isMatch: true as boolean | null,
};

describe('resolvePlanReconciliationState', () => {
  it('shows a load failure instead of treating a failed request as an empty list', () => {
    const state = resolvePlanReconciliationState({ ...planBase, detailsError: true, detailCount: 0 });
    expect(state.kind).toBe('error');
    expect(state.label).toBe('发货计划加载失败');
  });

  it('only shows an empty plan after a successful zero-row response', () => {
    const state = resolvePlanReconciliationState({ ...planBase, detailCount: 0 });
    expect(state.kind).toBe('empty');
    expect(state.label).toBe('尚未建立发货计划');
  });

  it('recognizes an existing matched confirmation plan', () => {
    const state = resolvePlanReconciliationState(planBase);
    expect(state.kind).toBe('match');
    expect(state.label).toBe('计划明细一致');
  });
});

describe('resolveFulfillmentPanelState', () => {
  it('distinguishes a plan awaiting waybills from a missing plan', () => {
    expect(resolveFulfillmentPanelState({ loading: false, error: false, status: 'pending' }).label)
      .toBe('待录入运单');
  });

  it('does not turn a failed summary request into pending shipment', () => {
    expect(resolveFulfillmentPanelState({ loading: false, error: true }).kind).toBe('error');
  });
});

describe('logisticsApiErrorMessage', () => {
  it('shows an actionable backend detail when available', () => {
    expect(logisticsApiErrorMessage(
      { response: { status: 400, data: { detail: '未在文件中识别到有效运单' } } },
      '运单文件解析失败',
    )).toBe('未在文件中识别到有效运单');
  });

  it('points administrators to migrations on internal server errors', () => {
    expect(logisticsApiErrorMessage(
      { response: { status: 500, data: 'Internal Server Error' } },
      '运单文件解析失败',
    )).toContain('检查数据库迁移状态');
  });
});
