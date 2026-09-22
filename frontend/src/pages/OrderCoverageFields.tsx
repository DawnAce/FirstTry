import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Col, DatePicker, Form, Radio, Row, Select, Space, Typography } from 'antd';
import { CalendarOutlined, ArrowRightOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import type { CoverageStartMode, DeliveryMethod, Publication, SubscriptionTerm } from '../api/orders';
import { previewOrderCoverage, previewOrderPricing } from '../api/orders';
import { getSchedule, getScheduleYears } from '../api/schedule';
import { coverageEnd } from './orderCoverage';

/** 期限、起投方式与实际日期独立；预览只读，已有订单不自动重定价。 */
export default function OrderCoverageFields({ index, disabled, preservePrice }: {
  index: number; disabled: boolean; preservePrice: boolean;
}) {
  const form = Form.useFormInstance();
  const path = (name: string) => ['items', index, name];
  const term = Form.useWatch<SubscriptionTerm>(path('subscription_term'), form);
  const mode = Form.useWatch<CoverageStartMode>(path('coverage_start_mode'), form) ?? 'month';
  const publication = Form.useWatch<Publication>(path('publication'), form);
  const start = Form.useWatch<Dayjs | null>(path('coverage_start'), form);
  const end = Form.useWatch<Dayjs | null>(path('coverage_end'), form);
  const month = Form.useWatch<Dayjs | null>(path('start_month'), form);
  const issue = Form.useWatch<number | null>(path('coverage_start_issue'), form);
  const year = Form.useWatch<number>(path('issue_year'), form) ?? start?.year() ?? dayjs().year();
  const adjusted = Form.useWatch<boolean>(path('end_date_adjusted'), form) ?? false;
  const method = Form.useWatch<DeliveryMethod>(path('delivery_method'), form);
  const quantity = Form.useWatch<number>(path('total_quantity'), form);
  const unitPrice = Form.useWatch<number>(path('unit_price'), form);
  const cbj = publication === 'cbj';
  const set = (name: string, value: unknown) => form.setFieldValue(path(name), value);
  const yearsQuery = useQuery({ queryKey: ['schedule-years'], queryFn: async () => (await getScheduleYears()).data, enabled: cbj && mode === 'issue' });
  const scheduleQuery = useQuery({ queryKey: ['schedule', year], queryFn: async () => (await getSchedule(year)).data, enabled: cbj && mode === 'issue' });
  const schedule = scheduleQuery.data?.filter(row => !row.is_suspended && row.issue_number != null) ?? [];
  const issueOptions = schedule.map(row => ({ value: row.issue_number!, label: `第 ${row.issue_number} 期 · ${row.publish_date}` }));
  if (issue && !issueOptions.some(row => row.value === issue)) {
    issueOptions.push({ value: issue, label: `第 ${issue} 期 · ${start?.format('YYYY-MM-DD') ?? '待核对'}` });
  }
  const startText = start?.format('YYYY-MM-DD');
  const endText = end?.format('YYYY-MM-DD');
  const validRange = !!(startText && endText && startText <= endText);
  const preview = useQuery({
    queryKey: ['orders', 'coverage-preview', startText, endText],
    queryFn: async () => (await previewOrderCoverage(startText!, endText!)).data,
    enabled: cbj && validRange,
  });
  const price = useQuery({
    queryKey: ['orders', 'pricing-preview', term, method, start?.format('YYYY-MM'), quantity],
    queryFn: async () => (await previewOrderPricing({ subscription_term: term as Exclude<SubscriptionTerm, 'custom'>,
      delivery_method: method, term_start_month: start!.format('YYYY-MM'), total_quantity: quantity || 1 })).data,
    enabled: !preservePrice && cbj && !!start && !!method && !!term && term !== 'custom',
  });
  useEffect(() => {
    if (price.data && !preservePrice && !disabled && term !== 'custom') {
      form.setFieldValue(['items', index, 'unit_price'], Number(price.data.unit_price));
    }
  }, [price.data, preservePrice, disabled, term, form, index]);
  useEffect(() => {
    if (!cbj && mode === 'issue') {
      form.setFieldValue(['items', index, 'coverage_start_mode'], 'date');
      form.setFieldValue(['items', index, 'coverage_start_issue'], null);
    }
  }, [cbj, mode, form, index]);

  const changeStart = (value: Dayjs | null, nextMode = mode, nextTerm = term) => {
    set('coverage_start', value);
    set('start_month', value?.startOf('month') ?? null);
    if (!adjusted && nextTerm && nextTerm !== 'custom') {
      set('coverage_end', value ? coverageEnd(nextTerm, value, nextMode) : null);
    }
  };
  const changeMode = (nextMode: CoverageStartMode) => {
    set('coverage_start_mode', nextMode);
    set('coverage_start_issue', null);
    if (nextMode === 'month') changeStart(start?.startOf('month') ?? month ?? null, nextMode);
    if (nextMode === 'issue') { set('issue_year', start?.year() ?? year); changeStart(null, nextMode); }
  };
  const canAdjust = term === 'custom' || adjusted;
  const selectedSchedule = schedule.find(row => row.issue_number === issue);
  const staleIssue = mode === 'issue' && !!issue && !!scheduleQuery.data &&
    (!selectedSchedule || selectedSchedule.publish_date !== startText);

  return <div className="order-coverage-fields">
    <Row gutter={[12, 0]}>
      <Col xs={24} md={12}>
        <Form.Item name={[index, 'subscription_term']} label="订阅期限" rules={[{ required: true, message: '请选择订阅期限' }]}>
          <Radio.Group optionType="button" disabled={disabled} options={[
            { label: '半年', value: 'half_year' }, { label: '一年', value: 'one_year' }, { label: '自定义', value: 'custom' },
          ]} onChange={e => {
            const next = e.target.value as SubscriptionTerm;
            if (next === 'custom') set('end_date_adjusted', true);
            else if (!adjusted && start) set('coverage_end', coverageEnd(next, start, mode));
          }} />
        </Form.Item>
      </Col>
      <Col xs={24} md={12}>
        <Form.Item name={[index, 'delivery_method']} label="投递方式" rules={[{ required: true, message: '请选择投递方式' }]}>
          <Select disabled={disabled} options={[{ label: '邮局投递', value: 'post_office' }, { label: 'ZTO-MF 快递', value: 'zto_mf' }]} />
        </Form.Item>
      </Col>
    </Row>
    <Form.Item name={[index, 'coverage_start_mode']} label="起投方式">
      <Radio.Group className="order-start-modes" disabled={disabled} onChange={e => changeMode(e.target.value)}>
        <Radio value="month"><span>按月份起订<small>从该月首个刊期开始</small></span></Radio>
        {cbj && <Radio value="issue"><span>按具体刊期起订<small>选择实际开始投递的一期</small></span></Radio>}
        {(mode === 'date' || term === 'custom' || !cbj) && <Radio value="date"><span>按实际日期<small>保留实际约定的起止日期</small></span></Radio>}
      </Radio.Group>
    </Form.Item>
    <Row gutter={[12, 0]}>
      <Col xs={24} md={12}>
        {mode === 'month' && <Form.Item name={[index, 'start_month']} label="起始月份" rules={[{ required: true, message: '请选择起始月份' }]}>
          <DatePicker picker="month" placeholder="选择月份" disabled={disabled} onChange={value => changeStart(value?.startOf('month') ?? null)} />
        </Form.Item>}
        {mode === 'issue' && <>
          <Form.Item name={[index, 'issue_year']} label="刊期年份" initialValue={year}>
            <Select aria-label="刊期年份" disabled={disabled} loading={yearsQuery.isLoading}
              options={[...new Set([...(yearsQuery.data ?? []), year])].sort((a,b) => b-a).map(y => ({value: y, label: `${y} 年`}))}
              onChange={() => { set('coverage_start_issue', null); changeStart(null); }} />
          </Form.Item>
          <Form.Item name={[index, 'coverage_start_issue']} label="起投刊期" rules={[
            { required: true, message: '请选择起投刊期' },
            { validator: async () => { if (staleIssue) throw new Error('刊期或日期已变化，请重新核对后选择'); } },
          ]}>
            <Select showSearch={{ optionFilterProp: 'label' }} placeholder="选择期号或搜索出版日期" options={issueOptions}
              disabled={disabled || scheduleQuery.isError} loading={scheduleQuery.isFetching}
              notFoundContent={scheduleQuery.isLoading ? <span>正在加载刊期…</span> : '该年没有可选的正式刊期'}
              onChange={value => { const row = schedule.find(s => s.issue_number === value); if (row) changeStart(dayjs(row.publish_date)); }} />
          </Form.Item>
          {(scheduleQuery.isError || yearsQuery.isError) && <Alert type="error" title="刊期加载失败" action={<Button size="small" onClick={() => { void scheduleQuery.refetch(); void yearsQuery.refetch(); }}>重试</Button>} />}
          {staleIssue && <Alert type="warning" title="起投日期与当前刊期不一致，请重新选择" />}
        </>}
        <Form.Item name={[index, 'coverage_start']} label="起投日期" hidden={mode !== 'date'} rules={[{ required: true, message: '请选择起投日期' }]}>
          <DatePicker disabled={disabled} onChange={value => changeStart(value)} />
        </Form.Item>
      </Col>
      <Col xs={24} md={12}>
        <Form.Item name={[index, 'coverage_end']} label={<Space>结束日期{term !== 'custom' && <Button type="link" size="small" disabled={disabled || !start} onClick={() => {
          set('end_date_adjusted', !adjusted);
          if (adjusted && start) set('coverage_end', coverageEnd(term, start, mode));
        }}>{adjusted ? '恢复自动计算' : '调整'}</Button>}</Space>}
          rules={[{ required: true, message: '请填写结束日期' }, { validator: async (_, value: Dayjs | null) => {
            if (value && start && value.isBefore(start, 'day')) throw new Error('结束日期不能早于起投日期');
          } }]} dependencies={[['items', index, 'coverage_start']]}
          extra={canAdjust ? '按实际订阅约定填写，保留所选订阅期限' : mode === 'month' ? `按 ${term === 'half_year' ? 6 : 12} 个自然月计算` : `按起投日起满${term === 'half_year' ? '半年' : '一年'}计算`}>
          <DatePicker placeholder="结束日期" disabled={disabled || !canAdjust} minDate={start ?? undefined} />
        </Form.Item>
      </Col>
    </Row>
    <Form.Item name={[index, 'end_date_adjusted']} hidden><input type="hidden" /></Form.Item>
    {validRange && <div className="order-coverage-preview" aria-live="polite">
      <strong><CalendarOutlined /> 履约覆盖预览</strong>
      <div className="order-coverage-dates"><span>{startText}</span><ArrowRightOutlined /><span>{endText}</span></div>
      {cbj && preview.isLoading && <Typography.Text type="secondary">正在核对正式刊期…</Typography.Text>}
      {cbj && preview.isError && <Alert type="error" title="覆盖期数核对失败" action={<Button size="small" onClick={() => void preview.refetch()}>重试</Button>} />}
      {cbj && preview.data && <>
        <div className="order-coverage-issues">{preview.data.first_issue && preview.data.last_issue
          ? `第 ${preview.data.first_issue.issue_number} 期（${preview.data.first_issue.publish_date}）至第 ${preview.data.last_issue.issue_number} 期（${preview.data.last_issue.publish_date}），${preview.data.expected_issue_count} 期`
          : '覆盖范围内暂无正式刊期'}</div>
        {preview.data.schedule_incomplete && <Alert type="warning" showIcon title="刊期表尚未覆盖完整订期，已保留结束日期；期数待刊期补齐后复核" />}
      </>}
      <Typography.Text type="secondary">仅纳入起止日期内的正式刊期，休刊不计入。</Typography.Text>
    </div>}
    {preservePrice && <div className="order-coverage-price-note">调整订期保留原成交价：¥{Number(unitPrice || 0).toFixed(2)} / 户</div>}
    {!preservePrice && price.data && <Typography.Paragraph type="secondary">{price.data.price_label} · 标准价 ¥{Number(price.data.unit_price).toFixed(2)} / 户</Typography.Paragraph>}
    {!preservePrice && price.isError && <Alert type="warning" title="标准套餐价预览失败，请核对并填写单价" />}
  </div>;
}
