import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Alert, Button, Card, Collapse, Descriptions, Drawer, Empty, Input, Space, Spin, Switch, Table, Tag, Typography } from 'antd';
import { getOrderSource, listOrderSources, sourceQueryKeys } from '../api/orderSources';
import type { OrderSource, SourceSnapshot } from '../api/orderSources';
import { PageHeader } from '../components/UiPrimitives';
import { useAuth } from '../contexts/AuthContext';
import OrderSourceLinkEditor from './OrderSourceLinkEditor';
import OrderSourceRefundEditor from './OrderSourceRefundEditor';
import OrderSourceDeliveryEditor from './OrderSourceDeliveryEditor';
import SourceFinancialSummary from './SourceFinancialSummary';

const normalizeSearch = (value: string) => value.replace(/[\s，,。；;：:（）()-]+/g, '').toLocaleLowerCase();
const kindLabel = (kind: string) => ({ shipping_fee: '运费交易', subscription: '订阅来源', record: '留存记录' }[kind] ?? kind);

function Snapshot({ value }: { value: SourceSnapshot }) {
  return <Space orientation="vertical" style={{ width: '100%' }}>
    <Descriptions size="small" column={1} items={[
      { key: 'file', label: '来源', children: `${value.filename || '未留存文件名'} · ${value.source_sheet || ''} 第 ${value.source_row ?? '未知'} 行` },
      { key: 'name', label: '收件人', children: value.recipient_name || '未填写' },
      { key: 'phone', label: '电话', children: value.recipient_phone || '未填写' },
      { key: 'address', label: '地址', children: value.recipient_address || '未填写' },
      { key: 'date', label: '下单时间', children: value.order_date || '未填写' },
      { key: 'pay', label: '支付时间', children: value.payment_time || '未填写' },
      { key: 'status', label: '平台状态', children: value.status_raw },
      { key: 'amount', label: '原付款金额', children: `¥${value.paid_amount}` },
      { key: 'notes', label: '原备注', children: value.notes || '无' },
    ]} />
    {value.product_lines.map((line, index) => <div key={index}>{line.raw}</div>)}
    {value.raw_cells && <Collapse items={[{ key: 'raw', label: '查看全部原始字段', children:
      <Descriptions size="small" column={1} items={Object.entries(value.raw_cells).map(([key, text]) => ({ key, label: key, children: text || '空' }))} /> }]} />}
  </Space>;
}

export default function OrderSources({ orderId, financeView }: { orderId?: number; financeView?: boolean }) {
  const { isAdmin } = useAuth();
  const [searchParams] = useSearchParams();
  const [linking, setLinking] = useState(() => searchParams.get('action') === 'link');
  const [refundOpen, setRefundOpen] = useState(false);
  const [delivery, setDelivery] = useState<{ linkId?: number; changeId?: number } | null>(null);
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [pending, setPending] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(() => Number(searchParams.get('source')) || null);
  const params = { search, pending, kind: financeView ? 'shipping_fee' : undefined, order_id: orderId, skip: (page - 1) * 20, limit: 20 };
  const list = useQuery({ queryKey: sourceQueryKeys.list(params), queryFn: async () => (await listOrderSources(params)).data });
  const detail = useQuery({ queryKey: sourceQueryKeys.detail(selectedId), queryFn: async () => (await getOrderSource(selectedId!)).data, enabled: selectedId !== null });
  const source = detail.data;
  return <Space orientation="vertical" style={{ width: '100%' }}>
    {!orderId && !financeView && <PageHeader title="来源交易" description="保留每笔原始交易，核对运费、退款及关联订阅" actions={<Link to="/orders"><Button>返回订单</Button></Link>} />}
    {financeView && <SourceFinancialSummary />}
    <Space wrap>
      <Input.Search aria-label="搜索原始交易" placeholder="原始单号、姓名、电话、地址、商品或备注" defaultValue={search}
        allowClear onSearch={value => { setSearch(value); setPage(1); }} style={{ width: 360, maxWidth: '100%' }} />
      {!orderId && <Space><Switch checked={pending} onChange={value => { setPending(value); setPage(1); }} aria-label="仅看待关联" />仅看待关联</Space>}
    </Space>
    {list.isError ? <Alert type="error" title="来源交易加载失败" action={<Button onClick={() => list.refetch()}>重试</Button>} /> :
      <Table<OrderSource> rowKey="id" loading={list.isLoading} dataSource={list.data?.rows ?? []} scroll={{ x: 760 }}
        pagination={{ current: page, pageSize: 20, total: list.data?.total ?? 0, onChange: setPage, showSizeChanger: false }}
        locale={{ emptyText: <Empty description="暂无来源交易" /> }} columns={[
          { title: '原始单号', dataIndex: 'external_order_no', render: (text, row) => <Button type="link" onClick={() => setSelectedId(row.id)}>{text}</Button> },
          { title: '类型', dataIndex: 'kind', render: kindLabel },
          { title: '收件人', render: (_, row) => row.snapshot.recipient_name || '未填写' },
          { title: '原付款', dataIndex: 'paid_amount', render: amount => `¥${amount}` },
          { title: '费用核对', render: (_, row) => row.kind !== 'shipping_fee' ? '订阅原件' : row.refund_pending || row.allocation_valid === false ? <Tag color="orange">待核对</Tag> : `净额 ¥${row.net_amount ?? row.paid_amount}` },
          { title: '原始状态', render: (_, row) => row.snapshot.status_raw },
          { title: '关联', render: (_, row) => row.links.some(link => link.active) ? <Tag color="green">已关联</Tag> : <Tag color="orange">待关联</Tag> },
        ]} />}
    <Drawer title="来源交易详情" open={selectedId !== null} onClose={() => { setSelectedId(null); setLinking(false); setRefundOpen(false); setDelivery(null); }} size={720}>
      {detail.isLoading ? <Spin /> : detail.isError ? <Alert type="error" title="详情加载失败" action={<Button onClick={() => detail.refetch()}>重试</Button>} /> : source &&
        <Space orientation="vertical" style={{ width: '100%' }}>
          <Typography.Title level={5}>{source.external_order_no} <Tag>{kindLabel(source.kind)}</Tag></Typography.Title>
          <Snapshot value={source.snapshot} />
          {source.kind === 'shipping_fee' && <Card size="small" title="运费与退款核对">
            <p>累计已核对退款：{source.verified_refund_amount == null ? '未登记' : `¥${source.verified_refund_amount}`} · 日期：{source.verified_refund_date || '未填写'}</p>
            {(source.refund_pending || source.allocation_valid === false) && <Alert type="warning" title="退款或分配金额待核对，暂不确定主单的完整净收。" />}
            {Number(source.verified_refund_amount) > 0 && source.links.some(link => link.active && link.delivery_from_issue) && <Alert type="warning" title="运费已退但仍有中通安排，请另行核对后续投递。" />}
            {isAdmin && <Button onClick={() => setRefundOpen(true)}>核对或更正运费退款</Button>}
          </Card>}
          <Card size="small" title="关联订单">
            {source.links.filter(link => link.active).map(link => <div key={link.id}>
              <Link to={`/orders/${link.order_id}?source=${source.id}`}>查看关联订单 #{link.order_id}</Link> · 运费 ¥{link.amount} · 退款 ¥{source.refund_pending ? '待核' : source.verified_refund_amount && Number(source.verified_refund_amount) > 0 ? link.refund_amount ?? '待分配' : '0.00'}
              {isAdmin && source.kind === 'shipping_fee' && link.target_id && <Button type="link" onClick={() => setDelivery({ linkId: link.id })}>确认或更正投递</Button>}
            </div>)}
            {!source.links.some(link => link.active) && <Typography.Text type="secondary">尚未关联订阅，原始记录已保存。</Typography.Text>}
            {isAdmin && source.kind === 'shipping_fee' && <div style={{ marginTop: 12 }}><Button onClick={() => setLinking(true)}>查找或更正关联订阅</Button></div>}
            {source.links.some(link => !link.active) && <Collapse items={[{ key: 'old-links', label: '查看历史关联', children: source.links.filter(link => !link.active).map(link => <p key={link.id}>原订单 #{link.order_id} · ¥{link.amount} · {link.reason}</p>) }]} />}
          </Card>
          <Collapse key={`${source.id}-${search}`} defaultActiveKey={search ? source.versions.filter(version => normalizeSearch(JSON.stringify(version.snapshot)).includes(normalizeSearch(search))).map(version => version.revision) : []}
            items={source.versions.map(version => ({ key: version.revision, label: `原始版本 ${version.revision}`, children: <Snapshot value={version.snapshot} /> }))} />
          {!!source.delivery_changes?.length && <Card size="small" title="转投历史">
            {source.delivery_changes.map(change => <p key={change.id}>第 {change.effective_from_issue} 期 · {change.effective_date} · {change.status === 'reverted' ? '已撤回' : '已确认'} · {change.reason}
              {isAdmin && change.status === 'applied' && <Button type="link" onClick={() => setDelivery({ changeId: change.id })}>核对撤回</Button>}
            </p>)}
          </Card>}
          {!!source.events?.length && <Collapse items={[{ key: 'events', label: '查看核对与更正记录', children: source.events.map(event => <p key={event.id}>{event.created_at} · {({ imported: '留存原件', source_updated: '来源更新', linked: '关联订阅', unlinked: '解除关联', refund_verified: '核对退款', delivery_applied: '确认转投', delivery_reverted: '撤回转投' } as Record<string, string>)[event.action] || event.action} · {String(event.payload.reason || '')}</p>) }]} />}
          {refundOpen && <OrderSourceRefundEditor source={source} onClose={() => setRefundOpen(false)} />}
          {delivery && <OrderSourceDeliveryEditor source={source} {...delivery} onClose={() => setDelivery(null)} />}
          {linking && isAdmin && source.kind === 'shipping_fee' && <OrderSourceLinkEditor source={source} onClose={() => setLinking(false)} />}
        </Space>}
    </Drawer>
  </Space>;
}
