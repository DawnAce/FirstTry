import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, DatePicker, Input, InputNumber, Modal, Space, message } from 'antd';
import dayjs from 'dayjs';
import { previewSourceRefund, saveSourceRefund } from '../api/orderSources';
import type { OrderSource, SourceRefundPayload } from '../api/orderSources';
import { getApiErrorMessage } from '../api/errorMessage';

export default function OrderSourceRefundEditor({ source, onClose }: { source: OrderSource; onClose: () => void }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState<string | null>(source.verified_refund_amount);
  const [date, setDate] = useState<string | null>(source.verified_refund_date);
  const [reason, setReason] = useState('');
  const links = source.links.filter(link => link.active);
  const [allocations, setAllocations] = useState<Record<number, string>>({});
  const [review, setReview] = useState<SourceRefundPayload | null>(null);
  const onError = (error: unknown) => message.error(getApiErrorMessage(error, '核对失败，请重试'));
  const preview = useMutation({ mutationFn: async (body: SourceRefundPayload) => { await previewSourceRefund(source.id, body); return body; }, onSuccess: setReview, onError });
  const save = useMutation({ mutationFn: (body: SourceRefundPayload) => saveSourceRefund(source.id, body), onSuccess: () => {
    void qc.invalidateQueries(); message.success('运费退款已核对，主订阅状态不变'); onClose();
  }, onError });
  const busy = preview.isPending || save.isPending;
  return <Modal open title={`核对运费退款 · ${source.external_order_no}`} onCancel={onClose} footer={null}>
    <Space orientation="vertical" style={{ width: '100%' }}>
      <Alert type="info" title={`原付款 ¥${source.paid_amount}，请按实际凭据填写累计退款。没有退款填0；保存会替换上次核对结果并留历史。`} />
      <label>累计退款金额 <InputNumber stringMode min="0" precision={2} value={amount} aria-label="累计退款金额" disabled={busy}
        onChange={value => { setAmount(value); setReview(null); }} /></label>
      <DatePicker aria-label="实际退款日期" value={date ? dayjs(date) : null} disabled={busy} disabledDate={value => value.isAfter(dayjs(), 'day')}
        onChange={value => { setDate(value?.format('YYYY-MM-DD') ?? null); setReview(null); }} />
      {links.length > 1 && links.map(link => <label key={link.id}>订单 #{link.order_id} · 目标 #{link.target_id}（运费 ¥{link.amount}）退款：
        <InputNumber stringMode min="0" precision={2} aria-label={`退款分配 ${link.id}`} disabled={busy} value={allocations[link.id] ?? link.refund_amount ?? '0'}
          onChange={value => { setAllocations(old => ({ ...old, [link.id]: value ?? '0' })); setReview(null); }} />
      </label>)}
      <Input.TextArea aria-label="退款凭据或更正依据" placeholder="填写退款凭据编号、核对依据或更正原因" value={reason} disabled={busy} maxLength={1000}
        onChange={e => { setReason(e.target.value); setReview(null); }} />
      <Button loading={preview.isPending} disabled={busy || !reason.trim() || amount == null} onClick={() => preview.mutate({ version: source.version, amount: amount ?? '0', refunded_at: date, reason,
        allocations: links.length > 1 ? links.map(link => ({ link_id: link.id, amount: allocations[link.id] ?? link.refund_amount ?? '0' })) : [] })}>预览退款核对</Button>
      {review && <Alert type="warning" title={`确认累计退款 ¥${review.amount}，主订阅不会停发`} description="若运费退款后还要改变投递，请另外核对生效刊期。"
        action={<Button type="primary" loading={save.isPending} onClick={() => save.mutate(review)}>确认退款核对</Button>} />}
    </Space>
  </Modal>;
}
