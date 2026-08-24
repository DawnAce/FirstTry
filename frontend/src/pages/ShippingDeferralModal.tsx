import { useMemo, useState } from 'react';
import { Alert, Empty, Input, Modal, Segmented, Select, Table, Tag, message } from 'antd';
import type { TableColumnsType } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { addConsolidatedPackage } from '../api/shippingWaybills';
import type { ShippingDeferral } from '../api/shippingWaybills';
import { logisticsApiErrorMessage } from './logisticsIssueState';
import { isLegacyDeferral, isOverdueDeferral, summarizeShippingDeferrals } from './shippingDeferralUtils';

type DeferralFilter = 'all' | 'overdue' | 'twice_monthly' | 'month_end' | 'legacy';

interface ShippingDeferralModalProps {
  open: boolean;
  title: string;
  items: ShippingDeferral[];
  loading?: boolean;
  scope: 'global' | 'issue';
  onClose: () => void;
}

const deferralTypeLabel = (type: ShippingDeferral['deferral_type']): string => (
  type === 'twice_monthly_consolidation' ? '每月两次合寄' : '月底合寄'
);

export default function ShippingDeferralModal({
  open,
  title,
  items,
  loading = false,
  scope,
  onClose,
}: ShippingDeferralModalProps) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<DeferralFilter>('all');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [carrier, setCarrier] = useState('中通');
  const [trackingNo, setTrackingNo] = useState('');
  const [saving, setSaving] = useState(false);
  const today = dayjs().format('YYYY-MM-DD');
  const summary = useMemo(() => summarizeShippingDeferrals(items, today), [items, today]);

  const visibleItems = useMemo(() => items.filter((item) => {
    if (filter === 'overdue') return isOverdueDeferral(item, today);
    if (filter === 'twice_monthly') return item.deferral_type === 'twice_monthly_consolidation';
    if (filter === 'month_end') return item.deferral_type === 'month_end_consolidation';
    if (filter === 'legacy') return isLegacyDeferral(item);
    return true;
  }), [filter, items, today]);

  const handleSubmit = async () => {
    if (!selectedIds.length || !trackingNo.trim()) return;
    setSaving(true);
    try {
      const response = await addConsolidatedPackage(carrier, trackingNo.trim(), selectedIds);
      message.success(`合寄运单已核销 ${response.data.quantity.toLocaleString()} 份`);
      setSelectedIds([]);
      setTrackingNo('');
      onClose();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['shippingDeferrals', 'pending'] }),
        queryClient.invalidateQueries({ queryKey: ['shippingFulfillment'] }),
        queryClient.invalidateQueries({ queryKey: ['shippingDetails'] }),
        queryClient.invalidateQueries({ queryKey: ['shippingDetailsAll'] }),
        queryClient.invalidateQueries({ queryKey: ['logistics-overview'] }),
      ]);
    } catch (error) {
      message.error(logisticsApiErrorMessage(error, '合寄核销失败'));
    } finally {
      setSaving(false);
    }
  };

  const columns: TableColumnsType<ShippingDeferral> = [
    { title: '来源刊期', dataIndex: 'issue_number', width: 90, render: (value: number) => `第 ${value} 期` },
    {
      title: '合寄方式', dataIndex: 'deferral_type', width: 130,
      render: (value: ShippingDeferral['deferral_type']) => (
        <Tag color={value === 'twice_monthly_consolidation' ? 'purple' : 'blue'}>{deferralTypeLabel(value)}</Tag>
      ),
    },
    {
      title: '目标批次', key: 'target', width: 155,
      render: (_, row) => row.target_issue_number
        ? `第 ${row.target_issue_number} 期${row.target_publish_date ? ` · ${dayjs(row.target_publish_date).format('MM-DD')}` : ''}`
        : row.target_publish_date ? dayjs(row.target_publish_date).format('YYYY-MM-DD') : <Tag color="orange">历史未分批</Tag>,
    },
    { title: '收件人', dataIndex: 'detail_name_snapshot', width: 130 },
    { title: '电话', dataIndex: 'detail_phone_snapshot', width: 130 },
    { title: '地址', dataIndex: 'detail_address_snapshot', ellipsis: true },
    { title: '份数', dataIndex: 'quantity', width: 70, align: 'right' },
  ];

  const filterOptions: Array<{ label: string; value: DeferralFilter }> = [
    { label: `全部 ${summary.recordCount}`, value: 'all' },
    ...(scope === 'global' ? [
      { label: `已逾期 ${summary.overdueCount}`, value: 'overdue' as const },
    ] : []),
    { label: `每月两次 ${summary.twiceMonthlyCount}`, value: 'twice_monthly' },
    { label: `月底合寄 ${summary.monthEndCount}`, value: 'month_end' },
    ...(scope === 'global' ? [
      { label: `历史未分批 ${summary.legacyCount}`, value: 'legacy' as const },
    ] : []),
  ];

  return (
    <Modal
      rootClassName="zto-compact-modal"
      title={title}
      open={open}
      width={1000}
      okText="登记运单并完成核销"
      okButtonProps={{ loading: saving, disabled: !selectedIds.length || !trackingNo.trim() }}
      onOk={() => void handleSubmit()}
      onCancel={onClose}
      afterClose={() => {
        setFilter('all');
        setSelectedIds([]);
        setTrackingNo('');
      }}
    >
      <Alert
        showIcon
        type={scope === 'global' ? 'info' : 'warning'}
        title={scope === 'global'
          ? `全系统当前未完成 ${summary.recordCount} 条，共 ${summary.quantity.toLocaleString()} 份`
          : `这里只显示目标批次为本期的 ${summary.recordCount} 条合寄明细`}
        description={scope === 'global'
          ? '每个来源刊期、每条收件明细计一条；历史未指定目标批次的记录单独列出，不再混入任一期的“本期应寄”。'
          : '同一张运单只能选择同一合寄方式、同一目标批次和同一收件人的记录；系统会把份数分别核销到各来源刊期。'}
      />
      <Segmented<DeferralFilter>
        className="waybill-reason-input"
        value={filter}
        options={filterOptions}
        onChange={(value) => {
          setFilter(value);
          setSelectedIds([]);
        }}
      />
      <div className="waybill-consolidated-fields">
        <Select
          value={carrier}
          options={['中通', '顺丰', '邮政', '邮政挂号'].map((value) => ({ value, label: value }))}
          onChange={setCarrier}
        />
        <Input value={trackingNo} placeholder="输入实际合寄运单号" onChange={(event) => setTrackingNo(event.target.value)} />
      </div>
      <Table<ShippingDeferral>
        rowKey="id"
        size="small"
        pagination={{ pageSize: 8, showSizeChanger: false }}
        loading={loading}
        dataSource={visibleItems}
        rowSelection={{
          selectedRowKeys: selectedIds,
          onChange: (keys) => setSelectedIds(keys.map(Number)),
        }}
        columns={columns}
        locale={{ emptyText: <Empty description="当前没有待合寄记录" /> }}
      />
    </Modal>
  );
}
