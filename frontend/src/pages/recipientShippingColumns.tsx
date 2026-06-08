import { Tag } from 'antd';
import type { TableColumnsType } from 'antd';
import dayjs from 'dayjs';
import type {
  ShippingDetail,
  ShippingDetailSourceType,
  ShippingDetailSyncStatus,
} from '../api/shippingDetails';

const channelColors: Record<string, string> = {
  '渠道订阅': 'blue',
  '对公订阅': 'blue',
  '个人订阅': 'green',
  '记者站': 'purple',
  '赠阅': 'orange',
  '库房留存': 'gray',
  '报社留存': 'cyan',
};

const transportColors: Record<string, string> = {
  '中通物流': 'blue',
  '邮政物流': 'green',
  '包车运输': 'orange',
  '库房留存': 'default',
};

const sourceTypeLabels: Record<ShippingDetailSourceType, string> = {
  manual: '手工',
  order_generated: '订单生成',
  historical_import: '历史导入',
};

const sourceTypeColors: Record<ShippingDetailSourceType, string> = {
  manual: 'default',
  order_generated: 'blue',
  historical_import: 'default',
};

const syncStatusLabels: Record<ShippingDetailSyncStatus, string> = {
  synced: '已同步',
  manually_modified: '人工修改',
  orphaned: '孤立',
};

const syncStatusColors: Record<ShippingDetailSyncStatus, string> = {
  synced: 'green',
  manually_modified: 'orange',
  orphaned: 'red',
};

const toNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const renderSourceType = (value: unknown) => {
  const sourceType = toNonEmptyString(value);

  if (!sourceType) {
    return '-';
  }

  const knownSourceType = sourceType as ShippingDetailSourceType;
  return (
    <Tag color={sourceTypeColors[knownSourceType] ?? 'default'}>
      {sourceTypeLabels[knownSourceType] ?? sourceType}
    </Tag>
  );
};

const renderSyncStatus = (value: unknown) => {
  const syncStatus = toNonEmptyString(value);

  if (!syncStatus) {
    return '-';
  }

  const knownSyncStatus = syncStatus as ShippingDetailSyncStatus;
  return (
    <Tag color={syncStatusColors[knownSyncStatus] ?? 'default'}>
      {syncStatusLabels[knownSyncStatus] ?? syncStatus}
    </Tag>
  );
};

export const shippingDetailDisplayColumns: TableColumnsType<ShippingDetail> = [
  { title: '姓名', dataIndex: 'name', key: 'name', width: 80 },
  {
    title: '渠道',
    dataIndex: 'channel',
    key: 'channel',
    width: 80,
    render: (v: string) => v ? <Tag color={channelColors[v] || 'gray'}>{v}</Tag> : '-',
  },
  {
    title: '子渠道',
    dataIndex: 'sub_channel',
    key: 'sub_channel',
    width: 80,
    render: (v: string | null) => v ? <Tag color={v === '监管' ? 'orange' : 'gold'}>{v}</Tag> : '-',
  },
  {
    title: '签约公司',
    dataIndex: 'company',
    key: 'company',
    width: 120,
    render: (v: string | null) => v ?? '-',
  },
  {
    title: '来源',
    dataIndex: 'source_type',
    key: 'source_type',
    width: 90,
    render: renderSourceType,
  },
  {
    title: '同步状态',
    dataIndex: 'sync_status',
    key: 'sync_status',
    width: 100,
    render: renderSyncStatus,
  },
  {
    title: '地址',
    dataIndex: 'address',
    key: 'address',
    width: 180,
    ellipsis: true,
    render: (v: string | null) => v ?? '-',
  },
  { title: '电话', dataIndex: 'phone', key: 'phone', width: 120, render: (v: string | null) => v ?? '-' },
  { title: '份数', dataIndex: 'quantity', key: 'quantity', width: 60, render: (v: number) => v ?? '-' },
  { title: '频率', dataIndex: 'frequency', key: 'frequency', width: 60, render: (v: string | null) => v ?? '-' },
  {
    title: '运输方式',
    dataIndex: 'transport',
    key: 'transport',
    width: 100,
    render: (v: string | null) => v ? <Tag color={transportColors[v] || 'default'}>{v}</Tag> : '-',
  },
  {
    title: '发货时间',
    dataIndex: 'shipped_at',
    key: 'shipped_at',
    width: 100,
    render: (v: string | null) => v ? dayjs(v).format('YYYY-MM-DD') : '-',
  },
  {
    title: '截止日期',
    dataIndex: 'deadline',
    key: 'deadline',
    width: 90,
    render: (v: string | null) => (!v || v === '-' || v === '长期')
      ? <Tag style={{ backgroundColor: '#000', color: '#fff', borderRadius: 4, border: 'none' }}>长期</Tag>
      : v,
  },
  {
    title: '状态',
    dataIndex: 'status',
    key: 'status',
    width: 70,
    render: (v: string) => v ? <Tag color={v === '正常' ? 'green' : 'red'}>{v}</Tag> : '-',
  },
  {
    title: '备注',
    dataIndex: 'notes',
    key: 'notes',
    width: 100,
    ellipsis: true,
    render: (v: string | null) => v ?? '-',
  },
];
