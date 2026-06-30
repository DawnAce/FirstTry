import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Drawer, Input, Space, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import {
  customerQueryKeys,
  getCustomerDetail,
  listCustomers,
} from '../api/customers';
import type { CustomerOrderLine, CustomerRow } from '../api/customers';
import type {
  FulfillmentType,
  OrderCommercialStatus,
  OrderStatus,
  Publication,
} from '../api/orders';
import {
  commercialStatusLabel,
  formatCoverage,
  fulfillmentTypeLabel,
  publicationLabel,
  statusLabel,
} from './orderUtils';

const { Title, Text } = Typography;
const PAGE_SIZE = 20;

function PublicationTags({ pubs }: { pubs: string[] }) {
  return (
    <Space size={4} wrap>
      {pubs.map((p) => (
        <Tag key={p}>{publicationLabel(p as Publication)}</Tag>
      ))}
    </Space>
  );
}

export default function CustomerList() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<CustomerRow | null>(null);

  const params = { search: search || undefined, page, page_size: PAGE_SIZE };
  const listQuery = useQuery({
    queryKey: customerQueryKeys.list(params),
    queryFn: () => listCustomers(params).then((r) => r.data),
  });

  const detailQuery = useQuery({
    queryKey: customerQueryKeys.detail(
      selected?.recipient_name ?? '',
      selected?.recipient_phone,
    ),
    queryFn: () =>
      getCustomerDetail(
        selected!.recipient_name,
        selected!.recipient_phone,
      ).then((r) => r.data),
    enabled: selected !== null,
  });

  const columns: TableColumnsType<CustomerRow> = [
    {
      title: '收报人',
      dataIndex: 'recipient_name',
      key: 'recipient_name',
      render: (v) => <Text strong>{v}</Text>,
    },
    {
      title: '电话',
      dataIndex: 'recipient_phone',
      key: 'recipient_phone',
      render: (v) => v || <Text type="secondary">—</Text>,
    },
    {
      title: '代表地址',
      dataIndex: 'primary_address',
      key: 'primary_address',
      render: (v, r) => (
        <Space size={4} wrap>
          <Text>{v || '—'}</Text>
          {r.address_count > 1 && (
            <Tag color="orange">{r.address_count} 个地址</Tag>
          )}
        </Space>
      ),
    },
    {
      title: '在订份数',
      dataIndex: 'total_quantity',
      key: 'total_quantity',
      align: 'right',
      sorter: (a, b) => a.total_quantity - b.total_quantity,
      render: (v) => <Text strong>{v}</Text>,
    },
    {
      title: '订单数',
      dataIndex: 'order_count',
      key: 'order_count',
      align: 'right',
      sorter: (a, b) => a.order_count - b.order_count,
    },
    {
      title: '涉及刊物',
      dataIndex: 'publications',
      key: 'publications',
      render: (v: string[]) => <PublicationTags pubs={v} />,
    },
    {
      title: '最近下单',
      dataIndex: 'last_order_date',
      key: 'last_order_date',
      render: (v) => v ?? <Text type="secondary">—</Text>,
    },
  ];

  const lineColumns: TableColumnsType<CustomerOrderLine> = [
    {
      title: '订单',
      dataIndex: 'order_code',
      key: 'order_code',
      render: (v) => v || <Text type="secondary">—</Text>,
    },
    { title: '下单日期', dataIndex: 'order_date', key: 'order_date' },
    {
      title: '刊物',
      dataIndex: 'publication',
      key: 'publication',
      render: (v) => publicationLabel(v as Publication),
    },
    {
      title: '履约类型',
      dataIndex: 'fulfillment_type',
      key: 'fulfillment_type',
      render: (v) => fulfillmentTypeLabel(v as FulfillmentType),
    },
    { title: '份数', dataIndex: 'quantity', key: 'quantity', align: 'right' },
    {
      title: '覆盖期 / 期次',
      key: 'coverage',
      render: (_v, r) =>
        r.issue_label ? (
          <Tag>{r.issue_label}</Tag>
        ) : r.issue_number != null ? (
          <Tag>第 {r.issue_number} 期</Tag>
        ) : (
          formatCoverage(r.coverage_start_date, r.coverage_end_date)
        ),
    },
    {
      title: '收件地址',
      dataIndex: 'recipient_address',
      key: 'recipient_address',
    },
    {
      title: '订单状态',
      dataIndex: 'order_status',
      key: 'order_status',
      render: (v, r) => (
        <Space size={4}>
          <Tag>{statusLabel(v as OrderStatus)}</Tag>
          {r.commercial_status && (
            <Text type="secondary">
              {commercialStatusLabel(
                r.commercial_status as OrderCommercialStatus,
              )}
            </Text>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Title level={3}>客户管理</Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        当前「客户」即<Text strong>收报人</Text>
        ：按 收件人姓名 + 电话 归并订单履约目标，统计其在订份数、涉及刊物与关联订单。
        口径为「当前在订」——仅计生效订单的有效履约目标，排除草稿 / 作废 / 退款 /
        取消、已暂停或已替换的目标。如后续有其他客户口径（如按付款方）需求可再扩展。
      </Text>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Input.Search
          placeholder="搜索 收报人 / 电话 / 地址"
          allowClear
          style={{ maxWidth: 360 }}
          onSearch={(v) => {
            setSearch(v);
            setPage(1);
          }}
        />
      </Card>

      <Table<CustomerRow>
        rowKey={(r) => `${r.recipient_name}|${r.recipient_phone ?? ''}`}
        size="small"
        loading={listQuery.isLoading}
        columns={columns}
        dataSource={listQuery.data?.rows ?? []}
        onRow={(record) => ({
          onClick: () => setSelected(record),
          style: { cursor: 'pointer' },
        })}
        pagination={{
          current: page,
          pageSize: PAGE_SIZE,
          total: listQuery.data?.total ?? 0,
          onChange: setPage,
          showTotal: (t) => `共 ${t} 位收报人`,
        }}
        locale={{ emptyText: '暂无收报人（生效订单录入履约目标后自动出现）' }}
      />

      <Drawer
        width={820}
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={
          selected
            ? `收报人：${selected.recipient_name}${
                selected.recipient_phone ? ` · ${selected.recipient_phone}` : ''
              }`
            : ''
        }
      >
        {selected && (
          <>
            <Space size="large" wrap style={{ marginBottom: 12 }}>
              <Text>
                在订份数：
                <Text strong>
                  {detailQuery.data?.total_quantity ?? selected.total_quantity}
                </Text>
              </Text>
              <Text>
                关联订单：
                <Text strong>
                  {detailQuery.data?.order_count ?? selected.order_count}
                </Text>
              </Text>
              <Text>
                涉及刊物：
                <PublicationTags
                  pubs={detailQuery.data?.publications ?? selected.publications}
                />
              </Text>
            </Space>
            <Table<CustomerOrderLine>
              rowKey={(r) => String(r.target_id)}
              size="small"
              loading={detailQuery.isLoading}
              columns={lineColumns}
              dataSource={detailQuery.data?.lines ?? []}
              pagination={false}
              locale={{ emptyText: '暂无在订履约明细' }}
            />
          </>
        )}
      </Drawer>
    </div>
  );
}
