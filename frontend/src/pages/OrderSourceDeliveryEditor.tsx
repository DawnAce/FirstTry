import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Checkbox, Input, Modal, Select, Space, Table, message } from 'antd';
import { getSourceDeliveryOptions, previewSourceDelivery, saveSourceDelivery, previewSourceDeliveryUndo, saveSourceDeliveryUndo } from '../api/orderSources';
import type { OrderSource, SourceDeliveryPayload, SourceDeliveryReview, SourceDeliveryUndoPayload } from '../api/orderSources';
import { getApiErrorMessage } from '../api/errorMessage';

export default function OrderSourceDeliveryEditor({ source, linkId, changeId, onClose }: { source: OrderSource; linkId?: number; changeId?: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [issue, setIssue] = useState<number>();
  const [reason, setReason] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [review, setReview] = useState<{ body: SourceDeliveryPayload; value: SourceDeliveryReview } | null>(null);
  const [undoReview, setUndoReview] = useState<SourceDeliveryUndoPayload | null>(null);
  const options = useQuery({ queryKey: ['order-sources', source.id, 'delivery-options', linkId], enabled: !!linkId,
    queryFn: async () => (await getSourceDeliveryOptions(source.id, linkId!)).data });
  const onError = (error: unknown) => message.error(getApiErrorMessage(error, '投递核对失败，请重试'));
  const done = () => { void qc.invalidateQueries(); message.success('投递安排已更新，历史记录已保留'); onClose(); };
  const preview = useMutation({ mutationFn: async (body: SourceDeliveryPayload) => ({ body, value: (await previewSourceDelivery(source.id, body)).data }), onSuccess: setReview, onError });
  const save = useMutation({ mutationFn: (body: SourceDeliveryPayload) => saveSourceDelivery(source.id, body), onSuccess: done, onError });
  const undoPreview = useMutation({ mutationFn: async (body: SourceDeliveryUndoPayload) => ({ ...body, expected_state: (await previewSourceDeliveryUndo(source.id, body)).data.expected_state }), onSuccess: setUndoReview, onError });
  const undoSave = useMutation({ mutationFn: (body: SourceDeliveryUndoPayload) => saveSourceDeliveryUndo(source.id, body), onSuccess: done, onError });
  const busy = preview.isPending || save.isPending || undoPreview.isPending || undoSave.isPending;
  const channel = options.data?.shipping_channel === 'post_office' ? 'zto_outsource' : 'post_office';
  return <Modal open title={changeId ? '撤回尚未执行的转投' : '确认或更正投递安排'} width={850} onCancel={onClose} footer={null}>
    <Space orientation="vertical" style={{ width: '100%' }}>
      <Alert type="info" title="关联运费不会自动改变投递。请核对刊期及邮局实际手续；已执行的历史从后续刊期更正。" />
      {linkId && (options.isError ? <Alert type="error" title={getApiErrorMessage(options.error, '刊期加载失败')} action={<Button onClick={() => options.refetch()}>重试</Button>} /> : <>
        <span>{options.data?.recipient_name} · 本次改为{channel === 'zto_outsource' ? '中通' : '邮局'}</span>
        <Select aria-label="转投生效刊期" placeholder="选择正式生效刊期" style={{ width: '100%' }} value={issue} loading={options.isLoading} disabled={busy}
          options={options.data?.issues.map(row => ({ value: row.issue_number, label: `第 ${row.issue_number} 期 · ${row.publish_date}` }))}
          onChange={value => { setIssue(value); setReview(null); setConfirmed(false); }} />
      </>)}
      <Input.TextArea aria-label="投递变更依据" placeholder="填写转投、邮局手续或更正依据" maxLength={1000} disabled={busy} value={reason}
        onChange={e => { setReason(e.target.value); setReview(null); setUndoReview(null); setConfirmed(false); }} />
      <Button disabled={busy || !reason.trim() || (!!linkId && !issue)} loading={preview.isPending || undoPreview.isPending} onClick={() => {
        if (changeId) undoPreview.mutate({ version: source.version, change_id: changeId, reason });
        else preview.mutate({ version: source.version, reason, link_id: linkId!, effective_from_issue: issue!, shipping_channel: channel, postal_delivery_ids: selected, postal_confirmed: false });
      }}>{changeId ? '预览撤回' : '预览投递变更'}</Button>
      {review && <>
        <Alert type="warning" title={`${review.value.recipient_name}：${review.value.effective_date} 起${channel === 'zto_outsource' ? '改用中通，邮局截止 ' + review.value.postal_until_date : '恢复邮局投递'}`}
          description={review.value.warnings.join(' ')} />
        {!!review.value.postal_records.length && <Table size="small" rowKey="id" pagination={false} dataSource={review.value.postal_records}
          rowSelection={{ selectedRowKeys: review.value.postal_records.filter(row => row.required || selected.includes(row.id)).map(row => row.id),
            getCheckboxProps: row => ({ disabled: busy || row.required }), onChange: ids => { setSelected(ids.map(Number)); setReview(null); setConfirmed(false); } }}
          columns={[{ title: '核对停投记录', dataIndex: 'delivery_no' }, { title: '收件资料', render: (_, row) => <div style={{ whiteSpace: 'normal' }}>{row.recipient_name} · {row.recipient_phone}<br />{row.recipient_address}</div> },
            { title: '现覆盖期', render: (_, row) => `${row.start || '未填'} 至 ${row.end || '未填'}` }]} />}
        <Checkbox checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)}>已核对选中邮局记录与实际停投/起投手续，确认生效边界</Checkbox>
        <Button type="primary" loading={save.isPending} disabled={!confirmed || busy} onClick={() => save.mutate({ ...review.body, expected_state: review.value.expected_state, postal_confirmed: true })}>确认投递变更</Button>
      </>}
      {undoReview && <Alert type="warning" title="恢复转投前的目标及邮局截止，撤回记录保留" description="如邮局手续已办理，请先确认恢复安排。"
        action={<Button type="primary" loading={undoSave.isPending} onClick={() => undoSave.mutate(undoReview)}>确认撤回</Button>} />}
    </Space>
  </Modal>;
}
