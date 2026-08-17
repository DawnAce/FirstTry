import { useState } from 'react';
import type { Key } from 'react';
import { Checkbox, Pagination, Tag, Tooltip } from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  InboxOutlined,
  RightOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import type { ShippingDetail } from '../api/shippingDetails';
import { getPackageCopy } from './shippingDetailCardUtils';

const PAGE_SIZE = 20;

const fulfillmentMeta: Record<ShippingDetail['fulfillment_status'], { label: string; color: string }> = {
  pending: { label: '待发货', color: 'default' },
  partial: { label: '部分核销', color: 'orange' },
  shipped: { label: '已核销', color: 'green' },
  no_tracking_required: { label: '已核销', color: 'green' },
  no_shipment_required: { label: '无需发货', color: 'green' },
  warehouse_stock_in: { label: '库存入库', color: 'cyan' },
};

interface ShippingDetailCardListProps {
  records: ShippingDetail[];
  mode: 'plan' | 'actual';
  selectedRowKeys: Key[];
  canSelect: boolean;
  onSelectedRowKeysChange: (keys: Key[]) => void;
  onOpenDetail: (record: ShippingDetail) => void;
}

function getRowTone(record: ShippingDetail, mode: 'plan' | 'actual') {
  if (mode === 'plan') {
    if (record.sync_status === 'orphaned') return 'danger';
    if (record.status === '停发' || record.sync_status === 'manually_modified') return 'warning';
    return 'primary';
  }
  if (record.fulfillment_status === 'partial' || record.fulfillment_status === 'pending') return 'warning';
  if (record.shipping_requirement === 'no_tracking_required' || ['no_tracking_required', 'no_shipment_required', 'warehouse_stock_in'].includes(record.fulfillment_status)) return 'success';
  return 'primary';
}

function StatusIcon({ record, mode }: { record: ShippingDetail; mode: 'plan' | 'actual' }) {
  if (mode === 'plan') {
    if (record.sync_status === 'orphaned' || record.status === '停发') return <WarningOutlined />;
    return <InboxOutlined />;
  }
  if (record.shipping_requirement === 'no_tracking_required' || ['no_tracking_required', 'no_shipment_required', 'warehouse_stock_in'].includes(record.fulfillment_status)) {
    return <CheckCircleOutlined />;
  }
  if (record.fulfillment_status === 'partial') return <WarningOutlined />;
  if (record.fulfillment_status === 'pending') return <ClockCircleOutlined />;
  return record.package_count > 0 ? <InboxOutlined /> : <CheckCircleOutlined />;
}

export default function ShippingDetailCardList({
  records,
  mode,
  selectedRowKeys,
  canSelect,
  onSelectedRowKeysChange,
  onOpenDetail,
}: ShippingDetailCardListProps) {
  const [page, setPage] = useState(1);

  const pageCount = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRecords = records.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const handleSelect = (record: ShippingDetail, checked: boolean) => {
    const next = checked
      ? [...selectedRowKeys, record.id]
      : selectedRowKeys.filter((key) => Number(key) !== record.id);
    onSelectedRowKeysChange(next);
  };

  return (
    <>
      <div className="zto-card-list" role="list">
        {pageRecords.map((record, index) => {
          const fulfillment = fulfillmentMeta[record.fulfillment_status] || fulfillmentMeta.pending;
          const packageCopy = getPackageCopy(record);
          const selected = selectedRowKeys.some((key) => Number(key) === record.id);
          const ordinal = (currentPage - 1) * PAGE_SIZE + index + 1;
          const recipientName = mode === 'actual' ? (record.actual_name || record.name) : record.name;
          const recipientPhone = mode === 'actual' ? (record.actual_phone || record.phone) : record.phone;
          return (
            <article
              key={record.id}
              className={`zto-detail-card-row ${selected ? 'is-selected' : ''}`}
              role="listitem"
              onClick={() => onOpenDetail(record)}
            >
              {canSelect ? (
                <span className="zto-card-select" onClick={(event) => event.stopPropagation()}>
                  <Checkbox
                    checked={selected}
                    disabled={record.source_type === 'complaint_makeup'}
                    aria-label={`选择${record.name}`}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => handleSelect(record, event.target.checked)}
                  />
                </span>
              ) : <span />}

              <span className="zto-card-ordinal" aria-label={`序号 ${ordinal}`} title={`序号 ${ordinal}`}>
                {ordinal}
              </span>

              <span className={`zto-card-status-icon is-${getRowTone(record, mode)}`} aria-hidden>
                <StatusIcon record={record} mode={mode} />
              </span>

              <div className="zto-card-field zto-card-recipient">
                <span>收件人</span>
                <strong>{recipientName || '—'}</strong>
                <small>{recipientPhone || '—'}{mode === 'actual' && record.actual_name ? ' · 已调整' : ''}</small>
              </div>

              <div className="zto-card-field zto-card-channel">
                <span>渠道</span>
                <strong>{record.channel || '—'}</strong>
                {record.sub_channel ? <small>{record.sub_channel}</small> : null}
              </div>

              <div className="zto-card-field zto-card-plan">
                <span>{mode === 'plan' ? '计划份数' : '应发 / 已核销'}</span>
                <strong>{mode === 'plan' ? `${record.quantity.toLocaleString()} 份` : `${record.quantity.toLocaleString()} / ${record.handled_quantity.toLocaleString()} 份`}</strong>
              </div>

              <div className="zto-card-field zto-card-package">
                {mode === 'plan' ? (
                  <>
                    <span>签约公司 / 地址</span>
                    <strong>{record.company || '—'}</strong>
                    <small>{record.address || '—'}</small>
                  </>
                ) : (
                  <>
                    <span>包裹 / 运单</span>
                    <Tooltip title={record.packages.map((item) => item.tracking_no).filter(Boolean).join('、')}>
                      <strong>{packageCopy.title}</strong>
                    </Tooltip>
                    {packageCopy.detail ? <small>{packageCopy.detail}</small> : null}
                  </>
                )}
              </div>

              <div className="zto-card-field zto-card-fulfillment">
                <span>状态</span>
                {mode === 'plan'
                  ? <Tag color={record.status === '停发' ? 'orange' : record.sync_status === 'orphaned' ? 'red' : 'green'}>{record.sync_status === 'orphaned' ? '来源失效' : record.status || '正常'}</Tag>
                  : <Tag color={fulfillment.color}>{fulfillment.label}</Tag>}
              </div>

              <button
                type="button"
                className="zto-card-detail-button"
                aria-label={`查看${record.name}详情`}
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenDetail(record);
                }}
              >
                <RightOutlined />
              </button>
            </article>
          );
        })}
      </div>

      {records.length > PAGE_SIZE ? (
        <div className="zto-card-pagination">
          <Pagination
            current={currentPage}
            pageSize={PAGE_SIZE}
            total={records.length}
            showSizeChanger={false}
            showTotal={(total) => `共 ${total} 条记录`}
            onChange={setPage}
          />
        </div>
      ) : null}
    </>
  );
}
