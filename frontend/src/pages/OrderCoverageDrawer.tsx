import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Checkbox, DatePicker, Drawer, Empty, Input, Modal, Select, Space, Table, Typography, message } from 'antd';
import type { TableColumnsType } from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { applyCoverage, coverageQueryKey, getCoverageCandidates, previewCoverage } from '../api/orderCoverage';
import type { CoverageApplyResult, CoverageCandidate, CoverageFilters, CoveragePreview, CoveragePreviewRow } from '../api/orderCoverage';
import { getApiErrorMessage } from '../api/errorMessage';
import { coverageError, fillCoverage, monthCoverage } from './orderCoverageUtils';
import type { CoverageDraft } from './orderCoverageUtils';
import { DrawerTitle } from '../components/UiPrimitives';

const publications = [{ value: 'cbj', label: '中国经营报' }, { value: 'business_school', label: '商学院' }];
const deliveries = [{ value: 'post_office', label: '邮局' }, { value: 'zto_mf', label: '中通' }];
const publicationName = (value: string | null) => publications.find(p => p.value === value)?.label ?? '其他刊物';
const termName = (value: string | null) => value === 'one_year' ? '全年' : value === 'half_year' ? '半年' : '自定义订期';
const deliveryName = (value: string | null) => deliveries.find(d => d.value === value)?.label ?? '未指定投递';

interface Props {
  importSessionId?: string;
  orderIds?: number[];
  onClose: () => void;
  onApplied?: (result: CoverageApplyResult) => void;
}

/** 关闭时卸载；两种入口复用候选、编辑与核对流程。 */
export default function OrderCoverageDrawer({ importSessionId, orderIds, onClose, onApplied }: Props) {
  const queryClient = useQueryClient();
  const [modal, modalContext] = Modal.useModal();
  const [filters, setFilters] = useState<CoverageFilters>({ missing_only: true });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Record<string, CoverageCandidate>>({});
  const [drafts, setDrafts] = useState<Record<string, CoverageDraft>>({});
  const [month, setMonth] = useState<Dayjs | null>(null);
  const [months, setMonths] = useState<number>(0);
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [method, setMethod] = useState<'month' | 'dates'>('month');
  const [reason, setReason] = useState('补录原订期');
  const [plan, setPlan] = useState<CoveragePreview | null>(null);
  const params = { ...filters, import_session_id: importSessionId, order_ids: orderIds, skip: (page - 1) * 50, limit: 50 };
  const query = useQuery({ queryKey: [...coverageQueryKey, params], queryFn: () => getCoverageCandidates(params) });
  const rows = query.data?.rows ?? [];
  const picked = Object.values(selected);
  const draftOf = (r: CoverageCandidate): CoverageDraft => drafts[r.key] ?? { start: r.coverage_start_date, end: r.coverage_end_date };
  const invalid = picked.filter(r => coverageError(draftOf(r)));
  const orderCount = new Set(picked.map(r => r.order_id ?? r.external_order_no)).size;

  const previewMutation = useMutation({
    mutationFn: () => previewCoverage(picked.map(r => ({
      key: r.key, expected_version: r.version,
      coverage_start_date: draftOf(r).start!, coverage_end_date: draftOf(r).end!,
    })), reason, importSessionId),
    onSuccess: setPlan,
    onError: e => message.error(getApiErrorMessage(e, '预览失败')),
  });
  const applyMutation = useMutation({
    mutationFn: () => applyCoverage(plan!.preview_id!),
    onSuccess: async result => {
      onApplied?.(result);
      setPlan(null);
      setSelected({});
      setDrafts({});
      setPage(1);
      // 日期影响订单进度、商学院发行量、邮局待续投等多个查询。
      await queryClient.invalidateQueries(importSessionId ? { queryKey: coverageQueryKey } : undefined);
      message.success(importSessionId ? `已将 ${result.updated} 条订期填入导入预览，确认导入后入库` : `已补齐 ${result.order_count} 单、${result.updated} 条明细`);
    },
    onError: e => message.error(getApiErrorMessage(e, '保存失败，请重新预览')),
  });
  const busy = previewMutation.isPending || applyMutation.isPending;
  const changeFilter = (change: Partial<CoverageFilters>) => { setFilters(prev => ({ ...prev, ...change })); setPage(1); };
  const edit = (row: CoverageCandidate, part: Partial<CoverageDraft>) => {
    setDrafts(prev => ({ ...prev, [row.key]: { ...draftOf(row), ...part } }));
    setSelected(prev => ({ ...prev, [row.key]: prev[row.key] ?? row }));
  };
  const batchFill = () => {
    const next = { ...drafts };
    let unfilled = 0;
    let differentStart = 0;
    for (const row of picked) {
      const duration = months || (row.subscription_term === 'one_year' ? 12 : row.subscription_term === 'half_year' ? 6 : 0);
      if (method === 'month' && !duration) { unfilled += 1; continue; }
      if (method === 'month' && row.coverage_start_date && row.coverage_start_date !== month!.startOf('month').format('YYYY-MM-DD')) {
        differentStart += 1;
        continue;
      }
      const proposal = method === 'month' ? monthCoverage(month!.format('YYYY-MM'), duration) : {
        start: range![0]!.format('YYYY-MM-DD'), end: range![1]!.format('YYYY-MM-DD'),
      };
      next[row.key] = fillCoverage(row, proposal);
    }
    setDrafts(next);
    if (unfilled) message.warning(`${unfilled} 条自定义订期需指定月数或实际日期`);
    if (differentStart) message.warning(`${differentStart} 条已有开始日期与所选月份不一致，请按实际日期逐行补录`);
  };
  const close = () => {
    if (busy) return;
    if (Object.keys(drafts).length) {
      modal.confirm({ title: '关闭补录窗口？', content: '尚未确认应用的日期不会保存。', okText: '关闭', cancelText: '继续填写', onOk: onClose });
    } else onClose();
  };
  const refresh = () => {
    const reload = () => {
      setPlan(null);
      setSelected({});
      setDrafts({});
      void query.refetch();
    };
    if (picked.length || Object.keys(drafts).length) {
      modal.confirm({ title: '刷新待补订期？', content: '将清空所选明细和未保存日期，并读取订单最新状态。', okText: '刷新', cancelText: '继续填写', onOk: reload });
    } else reload();
  };
  const columns: TableColumnsType<CoverageCandidate> = [
    { title: '订单 / 收件人', key: 'order', width: 210, render: (_, r) => <Space orientation="vertical" size={0}><Typography.Text>{r.external_order_no || `订单 ${r.order_id}`}</Typography.Text><Typography.Text>{r.recipient_name}</Typography.Text><Typography.Text type="secondary">{r.order_date} · {r.source_platform || '手工录入'}</Typography.Text></Space> },
    { title: '订阅明细', key: 'product', width: 170, render: (_, r) => <Space orientation="vertical" size={0}><span>{publicationName(r.publication)} · {termName(r.subscription_term)}</span><Typography.Text type="secondary">{deliveryName(r.delivery_method)}</Typography.Text></Space> },
    { title: '原订期', key: 'original', width: 160, render: (_, r) => <>{r.coverage_start_date || '未填'}<br />至 {r.coverage_end_date || '未填'}</> },
    { title: '拟补日期', key: 'dates', width: 310, render: (_, r) => {
      const draft = draftOf(r);
      return <Space orientation="vertical" size={4}>
        <Space size={4}>
          <DatePicker aria-label={`${r.key} 开始日期`} placeholder="开始日期" value={draft.start ? dayjs(draft.start) : null} disabled={busy || !!r.blocked_reason || !!r.coverage_start_date} onChange={v => edit(r, { start: v?.format('YYYY-MM-DD') ?? null })} />
          <DatePicker aria-label={`${r.key} 结束日期`} placeholder="结束日期" value={draft.end ? dayjs(draft.end) : null} disabled={busy || !!r.blocked_reason || !!r.coverage_end_date} onChange={v => edit(r, { end: v?.format('YYYY-MM-DD') ?? null })} />
        </Space>
        {r.blocked_reason ? <Typography.Text type="secondary">{r.blocked_reason}</Typography.Text> : selected[r.key] && coverageError(draft) ? <Typography.Text type="warning">{coverageError(draft)}</Typography.Text> : null}
      </Space>;
    } },
  ];
  const previewColumns: TableColumnsType<CoveragePreviewRow> = [
    { title: '来源单号', dataIndex: 'external_order_no', width: 180 },
    { title: '刊物', dataIndex: 'publication', render: publicationName, width: 100 },
    { title: '原订期', key: 'old', render: (_, r) => `${r.old_start || '未填'} 至 ${r.old_end || '未填'}` },
    { title: '拟补订期', key: 'new', render: (_, r) => `${r.new_start} 至 ${r.new_end}` },
    { title: '校验', dataIndex: 'error', render: e => <Typography.Text type={e ? 'danger' : 'success'}>{e || '可保存'}</Typography.Text> },
  ];
  return <Drawer open title={<DrawerTitle icon="📅" title="批量补订期" description={importSessionId ? '补齐后返回导入预览，再确认建单' : '集中补齐订阅起止日期'} />} onClose={close} size="min(1280px, 96vw)" mask={{ closable: !busy }}
    footer={<Space wrap><Typography.Text>已选 {orderCount} 单、{picked.length} 条明细（含跨页选择）</Typography.Text><Button onClick={() => setSelected({})} disabled={busy}>清空选择</Button><Button type="primary" loading={previewMutation.isPending} disabled={busy || !picked.length || picked.length > 500 || !!invalid.length || !reason.trim()} onClick={() => previewMutation.mutate()}>核对修改</Button>{invalid.length > 0 && <Typography.Text type="warning">{invalid.length} 条尚未填完整或日期无效</Typography.Text>}</Space>}>
    {modalContext}
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Alert type="info" showIcon title="只补缺失日期，原成交价格保留" description="可先处理一部分订单。日期按实际订阅约定填写；已有完整订期和退款订单请到订单详情单独核对。" />
      <Space wrap>
        <Select aria-label="刊物筛选" placeholder="全部刊物" allowClear options={publications} style={{ width: 150 }} value={filters.publication} disabled={busy} onChange={value => changeFilter({ publication: value })} />
        <Select aria-label="投递方式筛选" placeholder="全部投递方式" allowClear options={deliveries} style={{ width: 160 }} value={filters.delivery_method} disabled={busy} onChange={value => changeFilter({ delivery_method: value })} />
        <Select aria-label="平台筛选" placeholder="全部平台" allowClear options={['CBJ小程序', '微信小程序', '淘宝', '有赞'].map(value => ({ value, label: value }))} style={{ width: 150 }} value={filters.source_platform} disabled={busy} onChange={value => changeFilter({ source_platform: value })} />
        <DatePicker.RangePicker aria-label="下单日期筛选" placeholder={['下单开始日期', '下单结束日期']} disabled={busy} onChange={v => changeFilter({ order_date_start: v?.[0]?.format('YYYY-MM-DD'), order_date_end: v?.[1]?.format('YYYY-MM-DD') })} />
        <Checkbox checked={filters.missing_only} disabled={busy} onChange={e => changeFilter({ missing_only: e.target.checked })}>仅看待补订期</Checkbox>
        <Button disabled={busy} loading={query.isFetching} onClick={refresh}>刷新列表</Button>
      </Space>
      <Space wrap>
        <Select aria-label="批量填写方式" value={method} disabled={busy} options={[{ value: 'month', label: '起始月＋订阅期限' }, { value: 'dates', label: '实际起止日期' }]} onChange={setMethod} style={{ width: 180 }} />
        {method === 'month' ? <><DatePicker aria-label="批量起始月份" picker="month" placeholder="起始月份" value={month} onChange={setMonth} disabled={busy} /><Select aria-label="批量订阅月数" value={months} onChange={setMonths} disabled={busy} style={{ width: 180 }} options={[{ value: 0, label: '按明细全年／半年' }, ...[3, 6, 12].map(value => ({ value, label: `${value} 个月` }))]} /></> : <DatePicker.RangePicker aria-label="批量实际起止日期" value={range} onChange={setRange} disabled={busy} />}
        <Button disabled={busy || !picked.length || (method === 'month' ? !month : !range?.[0] || !range?.[1])} onClick={batchFill}>填入所选明细</Button>
      </Space>
      <label>补录原因<Input aria-label="补录原因" maxLength={255} value={reason} onChange={e => setReason(e.target.value)} disabled={busy} /></label>
      {picked.length > 500 && <Alert type="warning" title="每次最多保存 500 条明细，请减少所选明细后分批处理。" />}
      {query.isError ? <Alert type="error" showIcon title={getApiErrorMessage(query.error, '读取待补订单失败')} action={<Button onClick={() => void query.refetch()}>重试</Button>} /> : <>
        <Typography.Text>当前筛选 {query.data?.order_count ?? 0} 单、{query.data?.total ?? 0} 条明细</Typography.Text>
        <Table<CoverageCandidate> rowKey="key" columns={columns} dataSource={rows} loading={query.isFetching} size="small" scroll={{ x: 1000 }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前范围没有待补订期明细" /> }}
          rowSelection={{ selectedRowKeys: Object.keys(selected), preserveSelectedRowKeys: true, getCheckboxProps: r => ({ disabled: busy || !!r.blocked_reason, 'aria-label': `选择明细 ${r.key}` }), onChange: keys => {
            // 已选明细保留当时的版本，后台刷新不能使旧草稿绕过冲突校验。
            const available = { ...Object.fromEntries(rows.map(r => [r.key, r])), ...selected };
            setSelected(Object.fromEntries(keys.map(key => [String(key), available[String(key)]]).filter(([, value]) => value)));
          } }} pagination={{ current: page, pageSize: 50, total: query.data?.total ?? 0, showSizeChanger: false, onChange: setPage, disabled: busy }} />
      </>}
    </Space>
    <Modal open={!!plan} title={`核对订期修改 · ${plan?.order_count ?? 0} 单、${plan?.rows.length ?? 0} 条明细`} width={1100} onCancel={() => { if (!applyMutation.isPending) setPlan(null); }}
      okText={importSessionId ? '应用到导入预览' : '确认保存订期'} cancelText="返回修改" confirmLoading={applyMutation.isPending} okButtonProps={{ disabled: !plan?.can_apply }} onOk={() => applyMutation.mutate()} mask={{ closable: false }}>
      {!plan?.can_apply && <Alert type="error" title="存在未通过校验的明细，请返回修改或取消选择后重新预览。" />}
      <Table rowKey="key" dataSource={plan?.rows ?? []} columns={previewColumns} pagination={{ pageSize: 20 }} size="small" scroll={{ x: 950 }} />
    </Modal>
  </Drawer>;
}
