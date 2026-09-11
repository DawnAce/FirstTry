import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Form, Input, InputNumber, Modal, Select, Space, Tag, Typography } from 'antd';
import { getImportDraft, reviewImportDraft } from '../api/orderImport';
import type { ImportPreviewOut, ImportPreviewRow, ImportReviewChange } from '../api/orderImport';
import { listProducts, productQueryKeys } from '../api/products';
import { getApiErrorMessage } from '../api/errorMessage';
import { DELIVERY_OPTIONS } from './ProductForm';
import { deliveryMethodLabel, publicationLabel } from './orderUtils';

const STATUS_OPTIONS = [
  { value: 'paid', label: '已付款／待发货' }, { value: 'shipped', label: '已发货／已完成' },
  { value: 'pending_payment', label: '待付款（跳过建单）' }, { value: 'cancelled', label: '已取消（跳过建单）' },
  { value: 'refunded', label: '已退款' }, { value: 'partial_refund', label: '部分退款' },
];

export default function OrderImportReviewEditor({ row, sessionId, version, disabled, onApplied, onClose }: {
  row: ImportPreviewRow; sessionId: string; version: number; disabled: boolean;
  onApplied: (data: ImportPreviewOut, number: string) => void; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ImportReviewChange | null>(null);
  const [form] = Form.useForm<ImportReviewChange>();
  const products = useQuery({ queryKey: productQueryKeys.list({ active: true }), enabled: editing?.kind === 'product',
    queryFn: async () => (await listProducts({ active: true })).data });
  const save = useMutation({ mutationFn: (value: ImportReviewChange) => reviewImportDraft(sessionId, row.external_order_no, version, { ...editing!, ...value }),
    onSuccess: res => { onApplied(res.data, row.external_order_no); setEditing(null); void qc.invalidateQueries({ queryKey: ['order-coverage'] }); } });
  const refresh = useMutation({ mutationFn: () => getImportDraft(sessionId), onSuccess: res => { onApplied(res.data, row.external_order_no); setEditing(null); save.reset(); } });
  const start = (change: ImportReviewChange) => { setEditing(change); form.resetFields(); form.setFieldsValue(change); save.reset(); };
  const busy = disabled || save.isPending || refresh.isPending;
  const names = Array.isArray(row.source_snapshot?.product_lines) ? row.source_snapshot.product_lines as { name: string; is_shipping: boolean }[] : [];
  const pending = row.reviews?.filter(review => review.status === 'pending').length ?? 0;
  return <Modal open title={`核对本单识别 · ${row.external_order_no}`} width={760} onCancel={busy ? undefined : onClose} footer={null}>
    <Space orientation="vertical" className="order-import-workflow">
      <Alert showIcon type={pending ? 'warning' : 'info'} title={pending ? `还有 ${pending} 项需要核对` : '识别结果可查看或更正'}
        description="修改先应用到导入预览，确认整批导入后才保存订单。原始交易内容保留。" />
      {row.reviews?.map(review => <div className="order-import-issue-review" data-reviewed={review.status === 'confirmed'} key={review.id}>
        <Tag color={review.status === 'confirmed' ? 'green' : 'orange'}>{review.status === 'confirmed' ? '已核对' : '待核对'}</Tag>
        <strong>{review.title}{review.item_index != null ? ` · 明细 ${review.item_index + 1}` : ''}</strong>
        <div>{review.reason}</div>
        {review.kind === 'delivery' && <div>商品配置：{deliveryMethodLabel(review.original as never)} · 建议：{deliveryMethodLabel(review.suggested as never)} · 当前：{deliveryMethodLabel(review.value as never)}</div>}
        {review.kind === 'coverage' && <div>保留的人工订期：{review.value}</div>}
        <Button disabled={busy} size="small" onClick={() => start({ kind: review.kind, item_index: review.item_index,
          value: review.kind === 'delivery' && review.status === 'pending' ? review.suggested : review.value,
          amounts: row.items.filter(item => item.billing_type !== 'free_gift').map(item => item.subtotal), reason: '' })}>
          {review.status === 'confirmed' ? '修改核对结果' : '核对并处理'}
        </Button>
      </div>)}
      {!editing && <Space wrap>
        <Button disabled={busy} onClick={() => start({ kind: 'status', value: row.commercial_status, reason: '' })}>更正交易状态</Button>
        <Button disabled={busy} onClick={() => start({ kind: 'date', value: String(row.order_date ?? row.source_snapshot?.order_date ?? ''), reason: '' })}>补充或更正下单日期</Button>
        <Button disabled={busy || !names.some(line => !line.is_shipping)} onClick={() => start({ kind: 'product', reason: '' })}>更正本单商品</Button>
        {row.items.length > 0 && <Button disabled={busy} onClick={() => start({ kind: 'amount', amounts: row.items.filter(item => item.billing_type !== 'free_gift').map(item => item.subtotal), reason: '' })}>核对金额分摊</Button>}
        {row.items.map((item, index) => item.delivery_method && <Button key={index} disabled={busy} onClick={() => start({ kind: 'delivery', item_index: index, value: item.delivery_method, reason: '' })}>修改明细 {index + 1} 投递</Button>)}
      </Space>}
      {editing && <Form form={form} layout="vertical" disabled={busy} onFinish={value => save.mutate(value)}>
        {editing.kind === 'delivery' && <Form.Item name="value" label="本条明细的最终投递方式" rules={[{ required: true }]}><Select options={DELIVERY_OPTIONS} /></Form.Item>}
        {editing.kind === 'status' && <Form.Item name="value" label={`真实交易状态（原文：${row.status_raw || '未填写'}）`} rules={[{ required: true }]}><Select options={STATUS_OPTIONS} /></Form.Item>}
        {editing.kind === 'date' && <Form.Item name="value" label="下单日期" rules={[{ required: true, pattern: /^\d{4}-\d{2}-\d{2}$/, message: '请填写 YYYY-MM-DD' }]}><Input placeholder="YYYY-MM-DD" /></Form.Item>}
        {editing.kind === 'product' && <>
          <Alert type="warning" showIcon title="更正商品后重算本单明细，并清除本单原有投递、金额和订期核对；其他订单不受影响。" />
          <Form.Item name="item_index" label="原始商品行" rules={[{ required: true }]}><Select options={names.flatMap((line, index) => line.is_shipping ? [] : [{ value: index, label: line.name }])} /></Form.Item>
          <Form.Item name="product_id" label="本单应使用的商品" rules={[{ required: true }]}><Select loading={products.isLoading} showSearch={{ optionFilterProp: 'label' }} options={products.data?.map(product => ({ value: product.id, label: `${product.display_name} · ${product.code}` }))} /></Form.Item>
          {products.isError && <Alert type="error" title="商品加载失败" action={<Button onClick={() => products.refetch()}>重试</Button>} />}
          <Typography.Text type="secondary">本次只更正本单关联；公共商品别名仍在原有商品关联入口维护。</Typography.Text>
        </>}
        {editing.kind === 'amount' && <>
          <p>原实付 ¥{row.money?.paid ?? row.paid_amount} · 运费 ¥{row.money?.shipping ?? '0'} · 已排除商品 ¥{row.money?.excluded ?? '0'} · 明细应合计 ¥{row.money?.items ?? row.paid_amount}</p>
          {Number(row.money?.items) < 0 && <Alert type="error" showIcon title="原表中的运费和已排除商品金额超过实付，请核对原表金额后重新上传。" />}
          {row.items.filter(item => item.billing_type !== 'free_gift').map((item, index) => <Form.Item key={index} name={['amounts', index]} label={`明细 ${index + 1} · ${publicationLabel(item.publication as never)}（${item.total_quantity} 份）`} rules={[{ required: true }]}>
            <InputNumber stringMode min="0" precision={2} style={{ width: '100%' }} />
          </Form.Item>)}
          <Typography.Text type="secondary">调整本单分摊，原始实付金额保留；不合法的分摊无法保存。</Typography.Text>
        </>}
        <Form.Item name="reason" label="核对依据" rules={[{ required: true, whitespace: true, message: '请填写核对依据' }]}><Input.TextArea maxLength={1000} rows={2} /></Form.Item>
        <Space><Button type="primary" htmlType="submit" loading={save.isPending}>应用并确认核对</Button><Button onClick={() => setEditing(null)}>取消修改</Button></Space>
      </Form>}
      {save.isError && <Alert showIcon type="error" title={getApiErrorMessage(save.error, '核对未保存，请检查后重试')}
        action={<Button loading={refresh.isPending} onClick={() => refresh.mutate()}>刷新核对内容</Button>} />}
      {refresh.isError && <Alert type="error" title={getApiErrorMessage(refresh.error, '草稿刷新失败')} />}
    </Space>
  </Modal>;
}
