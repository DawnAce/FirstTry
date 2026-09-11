import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Input, InputNumber, Modal, Space, Table, Tag, Typography } from 'antd';
import { getImportDraft, getImportFeeCandidates, saveImportFeeLinks } from '../api/orderImport';
import type { ImportFeeAllocation, ImportFeeCandidate, ImportPreviewOut, ImportPreviewRow } from '../api/orderImport';
import { getApiErrorMessage } from '../api/errorMessage';
import { publicationLabel } from './orderUtils';

const keyOf = (row: { draft_key?: string; target_id?: number | null }) => row.draft_key || `target:${row.target_id}`;
type Selection = { allocation: ImportFeeAllocation; label: string };

export default function OrderImportFeeEditor({ row, sessionId, version, disabled, onApplied, onClose }: {
  row: ImportPreviewRow; sessionId: string; version: number; disabled: boolean;
  onApplied: (data: ImportPreviewOut, number: string) => void; onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Record<string, Selection> | null>(null);
  const [reason, setReason] = useState('');
  const candidates = useQuery({ queryKey: ['order-import', sessionId, 'fee-candidates', row.external_order_no, version, search],
    queryFn: async () => (await getImportFeeCandidates(sessionId, row.external_order_no, search)).data });
  const selections = selected ?? Object.fromEntries((candidates.data?.allocations ?? []).map(allocation => {
    const candidate = candidates.data?.rows.find(row => keyOf(row) === keyOf(allocation));
    return [keyOf(allocation), { allocation, label: candidate ? `${candidate.external_order_no} · ${candidate.recipient_name}` : allocation.draft_key || `收件目标 ${allocation.target_id}` }];
  }));
  const save = useMutation({ mutationFn: ({ allocations, reason }: { allocations: ImportFeeAllocation[]; reason: string }) => saveImportFeeLinks(sessionId, row.external_order_no, version, reason, allocations),
    onSuccess: res => { onApplied(res.data, row.external_order_no); onClose(); } });
  const refresh = useMutation({ mutationFn: () => getImportDraft(sessionId),
    onSuccess: res => { setSelected({}); onApplied(res.data, row.external_order_no); save.reset(); void candidates.refetch(); } });
  const busy = disabled || save.isPending || refresh.isPending;
  const staleSelection = candidates.data?.rows.some(candidate => selections[keyOf(candidate)] &&
    selections[keyOf(candidate)].allocation.expected_target_version !== candidate.expected_target_version);
  const choose = (candidate: ImportFeeCandidate, checked: boolean) => {
    const next = { ...selections };
    const key = keyOf(candidate);
    if (checked) next[key] = { label: `${candidate.external_order_no || candidate.order_code} · ${candidate.recipient_name} · ${publicationLabel(candidate.publication)}`,
      allocation: { ...(candidate.draft_key ? { draft_key: candidate.draft_key } : { order_id: candidate.order_id!, order_item_id: candidate.order_item_id!, target_id: candidate.target_id! }),
        amount: Object.keys(next).length ? '0.00' : row.paid_amount, expected_target_version: candidate.expected_target_version } };
    else delete next[key];
    setSelected(next);
    save.reset();
  };
  return <Modal open title={`查找关联订阅 · ${row.external_order_no}`} width={1080} onCancel={save.isPending ? undefined : onClose} footer={null}>
    <Space orientation="vertical" className="order-import-workflow">
      <Alert type="info" showIcon title="选择这笔运费对应的订阅明细和收件人"
        description={`原运费 ¥${row.paid_amount}。候选包含已有订单及本批待导入订阅；确认整批导入后保存关联，随后可核对转投生效期。`} />
      <Input.Search aria-label="搜索运费关联订阅" placeholder="搜索主单号、姓名、电话或地址" disabled={busy} allowClear
        onSearch={value => { setSelected(selections); setSearch(value); }} />
      {candidates.isError ? <Alert type="error" title={getApiErrorMessage(candidates.error, '候选加载失败')}
        action={<Button onClick={() => candidates.refetch()}>重试</Button>} /> : <Table<ImportFeeCandidate>
        size="small" rowKey={keyOf} loading={candidates.isLoading} dataSource={candidates.data?.rows ?? []} scroll={{ x: 900 }}
        pagination={{ pageSize: 5, showSizeChanger: false }} locale={{ emptyText: '未找到候选，可补充搜索词，或先保存运费到待关联列表' }}
        rowSelection={{ selectedRowKeys: Object.keys(selections), preserveSelectedRowKeys: true, hideSelectAll: true,
          getCheckboxProps: () => ({ disabled: busy }), onSelect: choose }} columns={[
          { title: '订阅订单', width: 180, render: (_, candidate) => <><Tag>{candidate.draft_key ? '本批待导入' : '已有订单'}</Tag><div>{candidate.order_code || candidate.external_order_no}</div>{publicationLabel(candidate.publication)}</> },
          { title: '收件资料', width: 230, render: (_, candidate) => <>{candidate.recipient_name} · {candidate.recipient_phone || '电话未填'}<br />{candidate.recipient_address}</> },
          { title: '订期', width: 180, render: (_, candidate) => `${candidate.coverage_start_date || '未填写'} 至 ${candidate.coverage_end_date || '未填写'}` },
          { title: '匹配依据', render: (_, candidate) => <><Tag color={candidate.confidence === 'high' ? 'green' : 'orange'}>{candidate.confidence === 'high' ? '高度匹配' : '疑似关联'}</Tag>{candidate.evidence.join('；')}</> },
        ]} />}
      {candidates.data?.truncated && <Alert type="warning" title="候选较多，请补充搜索词缩小范围；当前结果不视为唯一匹配。" />}
      {staleSelection && <Alert showIcon type="warning" title="已选订阅发生变化，请刷新并重新选择。"
        action={<Button disabled={busy} onClick={() => refresh.mutate()}>刷新并重新选择</Button>} />}
      <Typography.Text strong>本次分配：合计须为 ¥{row.paid_amount}</Typography.Text>
      {Object.entries(selections).map(([key, entry]) => <Space wrap key={key}>
        <span>{entry.label}</span><InputNumber stringMode min="0" precision={2} aria-label={`运费分配 ${key}`} disabled={busy} value={entry.allocation.amount}
          onChange={value => { setSelected({ ...selections, [key]: { ...entry, allocation: { ...entry.allocation, amount: value ?? '0' } } }); save.reset(); }} />
        <Button size="small" disabled={busy} onClick={() => { const next = { ...selections }; delete next[key]; setSelected(next); }}>移除</Button>
      </Space>)}
      <Input.TextArea aria-label="运费关联依据" placeholder="填写选择该订阅及分摊金额的依据" value={reason} disabled={busy} maxLength={1000} rows={2} onChange={event => setReason(event.target.value)} />
      <Space wrap>
        <Button type="primary" loading={save.isPending} disabled={busy || staleSelection || !Object.keys(selections).length || !reason.trim()}
          onClick={() => save.mutate({ reason, allocations: Object.values(selections).map(entry => entry.allocation) })}>确认关联到导入草稿</Button>
        <Button disabled={busy} onClick={() => save.mutate({ reason: reason.trim() || '暂未确定原订阅，先保存到待关联列表', allocations: [] })}>暂不关联，留存后处理</Button>
      </Space>
      {save.isError && <Alert showIcon type="error" title={getApiErrorMessage(save.error, '关联草稿未保存')}
        action={<Button loading={refresh.isPending} onClick={() => refresh.mutate()}>刷新并重新选择</Button>} />}
      {refresh.isError && <Alert type="error" title={getApiErrorMessage(refresh.error, '草稿刷新失败')} />}
    </Space>
  </Modal>;
}
