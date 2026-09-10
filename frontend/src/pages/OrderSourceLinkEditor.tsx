import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Input, InputNumber, Modal, Space, Table, Tag, Typography, message } from 'antd';
import { getSourceCandidates, previewSourceLinks, saveSourceLinks } from '../api/orderSources';
import type { OrderSource, SourceCandidate, SourceLinkPayload } from '../api/orderSources';
import { publicationLabel } from './orderUtils';

export default function OrderSourceLinkEditor({ source, onClose }: { source: OrderSource; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Record<number, { candidate: SourceCandidate; amount: string }>>({});
  const [reason, setReason] = useState('');
  const [review, setReview] = useState<SourceLinkPayload | null>(null);
  const candidates = useQuery({ queryKey: ['order-sources', source.id, 'candidates', search], queryFn: async () => (await getSourceCandidates(source.id, search)).data });
  const errorMessage = (error: { response?: { data?: { detail?: string } } }) => message.error(error.response?.data?.detail || '操作失败，请重试');
  const preview = useMutation({ mutationFn: async (body: SourceLinkPayload) => { await previewSourceLinks(source.id, body); return body; }, onSuccess: setReview, onError: errorMessage });
  const save = useMutation({ mutationFn: (body: SourceLinkPayload) => saveSourceLinks(source.id, body), onSuccess: () => {
    void queryClient.invalidateQueries(); message.success('关联已保存，投递安排需另行确认'); onClose();
  }, onError: errorMessage });
  const selectedRows = Object.values(selected);
  const payload = (): SourceLinkPayload => ({ version: source.version, reason, allocations: selectedRows.map(({ candidate: row, amount }) => ({
    order_id: row.order_id, order_item_id: row.order_item_id, target_id: row.target_id, amount,
    expected_target_version: row.expected_target_version,
  })) });
  const busy = preview.isPending || save.isPending;
  return <Modal open title={`关联订阅 · ${source.external_order_no}`} width={1100} onCancel={onClose} footer={null} destroyOnHidden>
    <Space orientation="vertical" style={{ width: '100%' }}>
      <Alert type="info" showIcon title="姓名、电话、地址及订期共同参与推荐。请核对具体订阅和收件目标，关联不会自动转中通。"
        description={`原收件人：${source.snapshot.recipient_name || '未填写'}；电话：${source.snapshot.recipient_phone || '未填写'}；地址：${source.snapshot.recipient_address || '未填写'}。原付款 ¥${source.paid_amount}。`} />
      <Input.Search aria-label="查找关联订阅" placeholder="搜索主单号、姓名、电话或地址" onSearch={setSearch} allowClear disabled={busy} />
      {candidates.isError ? <Alert type="error" title="候选加载失败" action={<Button onClick={() => candidates.refetch()}>重试</Button>} /> :
        <Table<SourceCandidate> size="small" rowKey="target_id" loading={candidates.isLoading} dataSource={candidates.data?.rows ?? []}
          pagination={{ pageSize: 5, showSizeChanger: false }} scroll={{ x: 1100 }}
          locale={{ emptyText: '暂无候选，可更换关键词；原始记录会继续保留。' }}
          rowSelection={{ selectedRowKeys: Object.keys(selected).map(Number), preserveSelectedRowKeys: true,
            getCheckboxProps: () => ({ disabled: busy }),
            onSelect: (row, checked) => { setReview(null); setSelected(prev => { const next = { ...prev }; if (checked) next[row.target_id] = { candidate: row, amount: Object.keys(prev).length ? '0.00' : source.paid_amount }; else delete next[row.target_id]; return next; }); },
            hideSelectAll: true }} columns={[
            { title: '候选订阅', width: 170, render: (_, row) => <>{row.order_code || row.external_order_no}<br />{row.order_date} 下单<br />{publicationLabel(row.publication)}</> },
            { title: '收件资料', width: 250, render: (_, row) => <>{row.recipient_name} · {row.recipient_phone || '未填电话'}<br />{row.recipient_address}</> },
            { title: '订期', width: 190, render: (_, row) => `${row.coverage_start_date || '未填写'} 至 ${row.coverage_end_date || '未填写'}` },
            { title: '匹配依据', render: (_, row) => <><Tag color={row.confidence === 'high' ? 'green' : 'orange'}>{row.confidence === 'high' ? '高度匹配' : '疑似关联'}</Tag>{row.evidence.join('；')}</> },
          ]} />}
      {candidates.data?.truncated && <Alert type="warning" title="候选超过100条，请补充搜索词缩小范围。" />}
      <Typography.Text strong>本次分配（合计应为 ¥{source.paid_amount}）</Typography.Text>
      {selectedRows.map(({ candidate: row, amount }) => <Space key={row.target_id} wrap>
        <span>{row.order_code || row.external_order_no} · {row.recipient_name} · {publicationLabel(row.publication)}</span>
        <InputNumber stringMode min="0" precision={2} value={amount} aria-label={`分配金额 ${row.target_id}`} disabled={busy}
          onChange={value => { setReview(null); setSelected(prev => ({ ...prev, [row.target_id]: { candidate: row, amount: value ?? '0' } })); }} />
      </Space>)}
      {!selectedRows.length && <Typography.Text type="secondary">未选订阅。有已有关联时，确认空分配将解除原关联。</Typography.Text>}
      <Input.TextArea aria-label="关联原因" placeholder="填写核对依据或更正原因" value={reason} disabled={busy} maxLength={1000}
        onChange={event => { setReason(event.target.value); setReview(null); }} />
      <Button onClick={() => preview.mutate(payload())} loading={preview.isPending} disabled={!reason.trim() || busy || (!selectedRows.length && !source.links.some(link => link.active))}>
        {selectedRows.length ? '预览关联' : '预览解除关联'}
      </Button>
      {review && <Alert type="warning" title={review.allocations.length ? `确认将原始交易关联至 ${review.allocations.length} 个订阅收件目标` : '确认解除当前全部关联，原始交易及历史继续保留'}
        description="仅更新来源归属，金额分配已校验；订阅份数、原价格及投递保持原值。"
        action={<Button type="primary" loading={save.isPending} onClick={() => save.mutate(review)}>确认保存关联</Button>} />}
    </Space>
  </Modal>;
}
