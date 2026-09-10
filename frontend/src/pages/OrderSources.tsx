import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Alert, Button, Card, Collapse, Descriptions, Drawer, Empty, Input, Space, Spin, Switch, Table, Tag, Typography } from 'antd';
import { getOrderSource, listOrderSources, sourceQueryKeys } from '../api/orderSources';
import type { OrderSource, SourceSnapshot } from '../api/orderSources';
import { PageHeader } from '../components/UiPrimitives';
import { useAuth } from '../contexts/AuthContext';
import OrderSourceLinkEditor from './OrderSourceLinkEditor';

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

export default function OrderSources({ orderId }: { orderId?: number }) {
  const { isAdmin } = useAuth();
  const [linking, setLinking] = useState(false);
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [pending, setPending] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(() => Number(searchParams.get('source')) || null);
  const params = { search, pending, order_id: orderId, skip: (page - 1) * 20, limit: 20 };
  const list = useQuery({ queryKey: sourceQueryKeys.list(params), queryFn: async () => (await listOrderSources(params)).data });
  const detail = useQuery({ queryKey: sourceQueryKeys.detail(selectedId), queryFn: async () => (await getOrderSource(selectedId!)).data, enabled: selectedId !== null });
  const source = detail.data;
  return <Space orientation="vertical" style={{ width: '100%' }}>
    {!orderId && <PageHeader title="来源交易" description="保留每笔原始交易，核对运费、退款及关联订阅" actions={<Link to="/orders"><Button>返回订单</Button></Link>} />}
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
          { title: '原始状态', render: (_, row) => row.snapshot.status_raw },
          { title: '关联', render: (_, row) => row.links.some(link => link.active) ? <Tag color="green">已关联</Tag> : <Tag color="orange">待关联</Tag> },
        ]} />}
    <Drawer title="来源交易详情" open={selectedId !== null} onClose={() => { setSelectedId(null); setLinking(false); }} size={720}>
      {detail.isLoading ? <Spin /> : detail.isError ? <Alert type="error" title="详情加载失败" action={<Button onClick={() => detail.refetch()}>重试</Button>} /> : source &&
        <Space orientation="vertical" style={{ width: '100%' }}>
          <Typography.Title level={5}>{source.external_order_no} <Tag>{kindLabel(source.kind)}</Tag></Typography.Title>
          <Snapshot value={source.snapshot} />
          <Card size="small" title="关联订单">
            {source.links.filter(link => link.active).map(link => <div key={link.id}>
              <Link to={`/orders/${link.order_id}?source=${source.id}`}>查看关联订单 #{link.order_id}</Link> · ¥{link.amount}
            </div>)}
            {!source.links.some(link => link.active) && <Typography.Text type="secondary">尚未关联订阅，原始记录已保存。</Typography.Text>}
            {isAdmin && source.kind === 'shipping_fee' && <div style={{ marginTop: 12 }}><Button onClick={() => setLinking(true)}>查找或更正关联订阅</Button></div>}
            {source.links.some(link => !link.active) && <Collapse items={[{ key: 'old-links', label: '查看历史关联', children: source.links.filter(link => !link.active).map(link => <p key={link.id}>原订单 #{link.order_id} · ¥{link.amount} · {link.reason}</p>) }]} />}
          </Card>
          <Collapse key={`${source.id}-${search}`} defaultActiveKey={search ? source.versions.filter(version => normalizeSearch(JSON.stringify(version.snapshot)).includes(normalizeSearch(search))).map(version => version.revision) : []}
            items={source.versions.map(version => ({ key: version.revision, label: `原始版本 ${version.revision}`, children: <Snapshot value={version.snapshot} /> }))} />
          {linking && <OrderSourceLinkEditor source={source} onClose={() => setLinking(false)} />}
        </Space>}
    </Drawer>
  </Space>;
}
