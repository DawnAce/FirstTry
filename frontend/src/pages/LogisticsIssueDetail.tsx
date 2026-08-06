import { useState } from 'react';
import type { Key } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  Select,
  Tag,
  message,
  Drawer,
  Timeline,
  DatePicker,
  InputNumber,
  Popconfirm,
  Card,
  Popover,
  Empty,
  Alert,
  Segmented,
  Spin,
} from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  DeleteOutlined,
  HistoryOutlined,
  DownloadOutlined,
  FilterOutlined,
  LeftOutlined,
  FileTextOutlined,
  ReloadOutlined,
  MoreOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ShippingDetail, ShippingDetailCreate, ShippingDetailUpdate } from '../api/shippingDetails';
import {
  getShippingDetails,
  createShippingDetail,
  updateShippingDetail,
  deleteShippingDetail,
  batchUpdateShippingDetails,
  batchDeleteShippingDetails,
  clearShippingDetailsByIssue,
  getShippingCompanies,
} from '../api/shippingDetails';
import { getIssue } from '../api/issues';
import { getOperationLogs } from '../api/operationLogs';
import type { OperationLog } from '../api/operationLogs';
import { getReport } from '../api/reports';
import {
  downloadIssueShippingExport,
  getIssueShippingExportFallbackFilename,
  resolveDownloadFilename,
} from '../api/exports';
import dayjs from 'dayjs';
import { useAuth } from '../contexts/AuthContext';
import { DrawerTitle, LargeStatusIcon, StatusPill } from '../components/UiPrimitives';
import {
  addManualPackage,
  deleteShippingPackage,
  getFulfillmentSummary,
  setNoTrackingRequired,
} from '../api/shippingWaybills';
import {
  logisticsApiErrorMessage,
  resolveFulfillmentPanelState,
  resolvePlanReconciliationState,
} from './logisticsIssueState';
import ShippingDetailCardList from './ShippingDetailCardList';

const CHANNEL_OPTIONS = ['渠道订阅', '对公订阅', '个人订阅', '记者站', '赠阅', '库房留存', '报社留存'] as const;
const SUB_CHANNEL_OPTIONS = ['监管', '政府'] as const;
const FREQUENCY_OPTIONS = ['周', '半月', '月'] as const;
const TRANSPORT_OPTIONS = ['中通物流', '邮政物流', '包车运输', '库房留存'] as const;
const SHIPPING_STATUS_OPTIONS = ['正常', '停发'] as const;

const channelColors: Record<string, string> = {
  '渠道订阅': 'blue', '对公订阅': 'blue', '个人订阅': 'green', '记者站': 'purple',
  '赠阅': 'orange', '库房留存': 'default', '报社留存': 'cyan',
};
const transportColors: Record<string, string> = {
  '中通物流': 'blue', '邮政物流': 'green', '包车运输': 'orange', '库房留存': 'default',
};
const sourceTypeMeta: Record<string, { label: string; color: string }> = {
  manual: { label: '手工录入', color: 'default' },
  order_generated: { label: '订单生成', color: 'blue' },
  historical_import: { label: '历史导入', color: 'default' },
  complaint_makeup: { label: '投诉补发', color: 'volcano' },
};
const syncStatusMeta: Record<string, { label: string; color: string }> = {
  synced: { label: '已同步', color: 'green' },
  manually_modified: { label: '人工修改', color: 'orange' },
  orphaned: { label: '孤立', color: 'red' },
};
const issueStatusLabel: Record<string, string> = { draft: '草稿', confirmed: '已确认', exported: '已导出' };
const issueStatusColor: Record<string, string> = { draft: 'orange', confirmed: 'green', exported: 'blue' };

const fieldLabels: Record<string, string> = {
  issue_number: '期号', sheet_name: '工作表', channel: '渠道', sub_channel: '子渠道', transport: '运输方式',
  frequency: '频率', status: '状态', name: '姓名', address: '地址', phone: '电话',
  quantity: '份数', deadline: '截止日期', notes: '备注', extra_info: '附加信息',
  station_name: '站点', station_hall: '站厅', contact_person: '联系人',
  seq_number: '序号', period_count: '期数', confirmation: '确认', company: '签约公司',
  shipped_at: '发货时间',
};

interface ShippingFilters {
  channel?: string;
  sub_channel?: string;
  frequency?: string;
  transport?: string;
  status?: string;
  search?: string;
  company?: string[];
  fulfillment_status?: string;
}

const fulfillmentMeta: Record<string, { label: string; color: string }> = {
  pending: { label: '待录入运单', color: 'default' },
  partial: { label: '部分已发货', color: 'orange' },
  shipped: { label: '已完成核销', color: 'green' },
  no_tracking_required: { label: '无需运单', color: 'blue' },
};

const matchesFulfillmentView = (detail: ShippingDetail, filter?: string) => {
  if (!filter || filter === 'all') return true;
  if (filter === 'completed') {
    return detail.fulfillment_status === 'shipped' || detail.fulfillment_status === 'no_tracking_required';
  }
  if (filter === 'pending') return detail.fulfillment_status === 'pending';
  if (filter === 'issue') return detail.fulfillment_status === 'partial' || detail.sync_status !== 'synced';
  return true;
};

export default function LogisticsIssueDetail() {
  const { id } = useParams<{ id: string }>();
  const issueId = Number(id);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { isAdmin, canMutate } = useAuth();
  const [shippingFilters, setShippingFilters] = useState<ShippingFilters>({});
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<ShippingDetail | null>(null);
  const [form] = Form.useForm();
  const [logDrawerOpen, setLogDrawerOpen] = useState(false);
  const [logRecordId, setLogRecordId] = useState<number | null>(null);
  const [logRecordName, setLogRecordName] = useState<string>('');
  const [actionMenuRecordId, setActionMenuRecordId] = useState<number | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
  const [detailDrawerRecord, setDetailDrawerRecord] = useState<ShippingDetail | null>(null);
  const [batchDeadline, setBatchDeadline] = useState<dayjs.Dayjs | null>(null);
  const [exporting, setExporting] = useState(false);
  const [clearingIssue, setClearingIssue] = useState(false);
  const [changeLogOpen, setChangeLogOpen] = useState(false);
  const [packageRecord, setPackageRecord] = useState<ShippingDetail | null>(null);
  const [packageForm] = Form.useForm();

  const { data: currentIssue } = useQuery({
    queryKey: ['issue', issueId],
    queryFn: async () => (await getIssue(issueId)).data,
    enabled: Number.isFinite(issueId),
  });

  const currentIssueNumber = currentIssue?.issue_number;

  const handleExportShipping = async () => {
    if (currentIssue?.id == null) return;
    setExporting(true);
    try {
      const res = await downloadIssueShippingExport(currentIssue.id);
      const contentDisposition = res.headers['content-disposition'];
      const fallback = getIssueShippingExportFallbackFilename(currentIssue);
      const filename = resolveDownloadFilename(
        typeof contentDisposition === 'string' ? contentDisposition : undefined,
        fallback,
      );
      const url = URL.createObjectURL(res.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      message.error('导出失败');
    } finally {
      setExporting(false);
    }
  };

  const {
    data: details = [],
    isLoading,
    isError: detailsIsError,
    error: detailsError,
    refetch: refetchDetails,
  } = useQuery({
    queryKey: ['shippingDetails', currentIssueNumber, shippingFilters],
    queryFn: async () => {
      if (currentIssueNumber == null) return [];
      const params: Record<string, any> = { issue_number: currentIssueNumber };
      if (shippingFilters.channel) params.channel = shippingFilters.channel;
      if (shippingFilters.sub_channel) params.sub_channel = shippingFilters.sub_channel;
      if (shippingFilters.frequency) params.frequency = shippingFilters.frequency;
      if (shippingFilters.transport) params.transport = shippingFilters.transport;
      if (shippingFilters.status) params.status = shippingFilters.status;
      if (shippingFilters.search) params.search = shippingFilters.search;
      if (shippingFilters.company?.length) params.company = shippingFilters.company.join(',');
      const res = await getShippingDetails(params);
      return res.data;
    },
    enabled: currentIssueNumber != null,
  });

  // Unfiltered per-issue list — powers 摘要条 / 处理状态 / 空态判定（不受筛选影响）。
  const {
    data: allDetails = [],
    isLoading: allDetailsLoading,
    isError: allDetailsIsError,
    isSuccess: allDetailsLoaded,
    error: allDetailsError,
    refetch: refetchAllDetails,
  } = useQuery({
    queryKey: ['shippingDetailsAll', currentIssueNumber],
    queryFn: async () => {
      if (currentIssueNumber == null) return [];
      const res = await getShippingDetails({ issue_number: currentIssueNumber });
      return res.data;
    },
    enabled: currentIssueNumber != null,
  });

  const { data: companyOptions = [] } = useQuery({
    queryKey: ['shippingCompanies', currentIssueNumber],
    queryFn: async () => {
      if (currentIssueNumber == null) return [];
      const res = await getShippingCompanies({ issue_number: currentIssueNumber });
      return res.data;
    },
    enabled: currentIssueNumber != null,
  });

  const {
    data: report,
    isLoading: reportLoading,
    isError: reportIsError,
    refetch: refetchReport,
  } = useQuery({
    queryKey: ['report', issueId],
    queryFn: async () => {
      if (!Number.isFinite(issueId)) return null;
      const res = await getReport(issueId);
      return res.data;
    },
    enabled: Number.isFinite(issueId),
  });

  const {
    data: fulfillment,
    isLoading: fulfillmentLoading,
    isError: fulfillmentIsError,
    refetch: refetchFulfillment,
  } = useQuery({
    queryKey: ['shippingFulfillment', issueId],
    queryFn: async () => (await getFulfillmentSummary(issueId)).data,
    enabled: Number.isFinite(issueId),
  });

  const { data: operationLogs = [], isLoading: logsLoading } = useQuery({
    queryKey: ['operationLogs', logRecordId],
    queryFn: async () => {
      if (logRecordId == null) return [];
      const res = await getOperationLogs({ table_name: 'shipping_details', record_id: logRecordId });
      return res.data;
    },
    enabled: logRecordId != null,
  });

  const handleShowLogs = (record: ShippingDetail) => {
    setActionMenuRecordId(null);
    setDetailDrawerRecord(null);
    setLogRecordId(record.id);
    setLogRecordName(record.name);
    setLogDrawerOpen(true);
  };

  const handleReverify = () => {
    queryClient.invalidateQueries({ queryKey: ['report', issueId] });
    queryClient.invalidateQueries({ queryKey: ['shippingDetails'] });
    queryClient.invalidateQueries({ queryKey: ['shippingDetailsAll'] });
    message.success('已重新校验');
  };

  const refreshShippingDetails = () => {
    queryClient.invalidateQueries({ queryKey: ['shippingDetails'] });
    queryClient.invalidateQueries({ queryKey: ['shippingDetailsAll'] });
    queryClient.invalidateQueries({ queryKey: ['shippingCompanies'] });
    queryClient.invalidateQueries({ queryKey: ['operationLogs'] });
    queryClient.invalidateQueries({ queryKey: ['report', issueId] });
    queryClient.invalidateQueries({ queryKey: ['shippingFulfillment', issueId] });
  };

  const handleOpenPackage = (record: ShippingDetail) => {
    setActionMenuRecordId(null);
    setDetailDrawerRecord(null);
    setPackageRecord(record);
    packageForm.setFieldsValue({ carrier: '中通', quantity: Math.max(record.quantity - record.handled_quantity, 1) });
  };

  const handleAddPackage = async () => {
    if (!packageRecord) return;
    try {
      const values = await packageForm.validateFields();
      await addManualPackage(packageRecord.id, values);
      message.success('运单已补录');
      setPackageRecord(null);
      packageForm.resetFields();
      refreshShippingDetails();
    } catch (error) {
      message.error(logisticsApiErrorMessage(error, '补录运单失败'));
    }
  };

  const handleDeletePackage = async (packageId: number) => {
    try {
      await deleteShippingPackage(packageId);
      message.success('运单已删除');
      setDetailDrawerRecord(null);
      refreshShippingDetails();
    } catch (error) {
      message.error(logisticsApiErrorMessage(error, '删除运单失败'));
    }
  };

  const handleNoTracking = async (record: ShippingDetail, value: boolean) => {
    setActionMenuRecordId(null);
    setDetailDrawerRecord(null);
    try {
      await setNoTrackingRequired(record.id, value);
      message.success(value ? '已标记为无需发货' : '已恢复为需要运单');
      refreshShippingDetails();
    } catch (error) {
      message.error(logisticsApiErrorMessage(
        error,
        value ? '标记失败，请先检查是否已有运单' : '恢复失败',
      ));
    }
  };

  const handleEdit = (record: ShippingDetail) => {
    setDetailDrawerRecord(null);
    setEditingRecord(record);
    form.setFieldsValue({
      ...record,
      shipped_at: record.shipped_at ? dayjs(record.shipped_at) : null,
    });
    setModalVisible(true);
  };

  const handleDelete = async (recordId: number) => {
    try {
      await deleteShippingDetail(recordId);
      message.success('删除成功');
      setDetailDrawerRecord(null);
      refreshShippingDetails();
    } catch {
      message.error('删除失败');
    }
  };

  const handleOpenCreate = () => {
    if (currentIssueNumber == null) return;
    setEditingRecord(null);
    form.resetFields();
    setModalVisible(true);
  };

  const handleCloseModal = () => {
    setModalVisible(false);
    setEditingRecord(null);
    form.resetFields();
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const sub_channel = form.getFieldValue('sub_channel') || null;
      const shipped_at = values.shipped_at ? dayjs(values.shipped_at).format('YYYY-MM-DD') : null;
      if (editingRecord) {
        const updateData: ShippingDetailUpdate = { ...values, sub_channel, shipped_at };
        await updateShippingDetail(editingRecord.id, updateData);
        message.success('更新成功');
      } else {
        if (currentIssueNumber == null) return;
        const createData: ShippingDetailCreate = {
          ...values,
          sub_channel: sub_channel || undefined,
          shipped_at,
          issue_number: currentIssueNumber,
          sheet_name: '手动添加',
        };
        await createShippingDetail(createData);
        message.success('创建成功');
      }
      handleCloseModal();
      refreshShippingDetails();
    } catch {
      message.error('操作失败');
    }
  };

  const getSelectedIds = () => selectedRowKeys.map((key) => Number(key));

  const handleBatchStatus = async (status: string) => {
    try {
      const res = await batchUpdateShippingDetails({ ids: getSelectedIds(), updates: { status } });
      message.success(`已更新 ${res.data.affected_count} 条记录`);
      setSelectedRowKeys([]);
      refreshShippingDetails();
    } catch {
      message.error('批量修改状态失败');
    }
  };

  const handleBatchDeadline = async () => {
    if (!batchDeadline) {
      message.warning('请选择截止日期');
      return;
    }
    try {
      const res = await batchUpdateShippingDetails({
        ids: getSelectedIds(),
        updates: { deadline: batchDeadline.format('YYYY-MM-DD') },
      });
      message.success(`已更新 ${res.data.affected_count} 条记录`);
      setBatchDeadline(null);
      setSelectedRowKeys([]);
      refreshShippingDetails();
    } catch {
      message.error('批量修改截止日期失败');
    }
  };

  const handleBatchDelete = async () => {
    try {
      const res = await batchDeleteShippingDetails({ ids: getSelectedIds() });
      message.success(`已删除 ${res.data.affected_count} 条记录`);
      setSelectedRowKeys([]);
      refreshShippingDetails();
    } catch {
      message.error('批量删除失败');
    }
  };

  const handleClearCurrentIssueShippingDetails = async () => {
    if (currentIssueNumber == null) return;
    setClearingIssue(true);
    try {
      const res = await clearShippingDetailsByIssue(currentIssueNumber);
      message.success(`已清空第 ${currentIssueNumber} 期 ${res.data.affected_count} 条 ZTO-MF`);
      setSelectedRowKeys([]);
      refreshShippingDetails();
    } catch {
      message.error('清空本期发货明细失败');
    } finally {
      setClearingIssue(false);
    }
  };

  const confirmationSummary = report?.confirmation_summary;
  const allShippingTotal = allDetails.filter((detail) => detail.source_type !== 'complaint_makeup').reduce((sum, detail) => sum + (detail.quantity ?? 0), 0);
  const check = report?.shipping_check;
  const advancedFilterCount = [shippingFilters.frequency, shippingFilters.transport, shippingFilters.sub_channel].filter(Boolean).length;
  const anomalyRows = allDetails.filter((d) => d.sync_status !== 'synced');
  const currentIsMatch = confirmationSummary?.plan_is_match ?? null;
  const planState = resolvePlanReconciliationState({
    detailsLoading: allDetailsLoading,
    detailsError: allDetailsIsError,
    detailsLoaded: allDetailsLoaded,
    reportLoading,
    reportError: reportIsError,
    detailCount: allDetails.length,
    isMatch: currentIsMatch,
  });
  const planMetricsReady = allDetailsLoaded && !allDetailsIsError && !!report && !reportIsError;
  const displayedReportTotal = planMetricsReady
    ? confirmationSummary?.confirmed_shipping_total ?? null
    : null;
  const displayedShippingTotal = planMetricsReady
    ? check?.shipping_total ?? confirmationSummary?.current_shipping_total ?? allShippingTotal
    : null;
  const displayedDelta = planMetricsReady
    ? confirmationSummary?.plan_delta ?? null
    : null;
  const hasDrift = planMetricsReady && !!confirmationSummary?.has_shipping_drift;
  const fulfillmentPanelState = resolveFulfillmentPanelState({
    loading: fulfillmentLoading,
    error: fulfillmentIsError,
    status: fulfillment?.status,
  });
  const snapshotDelta = confirmationSummary
    ? confirmationSummary.current_shipping_total - confirmationSummary.confirmed_shipping_total
    : 0;
  const hasShippingFilters = !!(
    shippingFilters.channel
    || shippingFilters.sub_channel
    || shippingFilters.frequency
    || shippingFilters.transport
    || shippingFilters.status
    || shippingFilters.search
    || shippingFilters.company?.length
    || shippingFilters.fulfillment_status
  );
  const visibleDetails = details.filter((detail) => matchesFulfillmentView(detail, shippingFilters.fulfillment_status));
  const visibleShippingTotal = visibleDetails
    .filter((detail) => detail.source_type !== 'complaint_makeup')
    .reduce((sum, detail) => sum + (detail.quantity ?? 0), 0);
  const fulfillmentTabCounts = {
    all: details.length,
    completed: details.filter((detail) => matchesFulfillmentView(detail, 'completed')).length,
    pending: details.filter((detail) => matchesFulfillmentView(detail, 'pending')).length,
    issue: details.filter((detail) => matchesFulfillmentView(detail, 'issue')).length,
  };

  const retryPlanData = () => {
    void Promise.all([refetchAllDetails(), refetchDetails(), refetchReport()]);
  };

  const retryFulfillmentData = () => {
    void refetchFulfillment();
  };

  return (
    <div className="zto-page">
      <Button
        type="link"
        size="small"
        icon={<LeftOutlined />}
        className="zto-page-back"
        onClick={() => navigate('/logistics/issues')}
      >
        期数总览
      </Button>

      <div className="zto-page-head">
        <div className="zto-title-line">
          <h1>快递管理 · ZTO-MF</h1>
          {currentIssue && (
            <>
              <span className="zto-issue-meta">
                第 {currentIssue.issue_number} 期 · {dayjs(currentIssue.publish_date).format('YYYY-MM-DD')}
              </span>
              <Tag color={issueStatusColor[currentIssue.status] || 'default'} className="zto-issue-tag">
                {(currentIssue.status === 'confirmed' || currentIssue.status === 'exported') ? '✓ ' : ''}
                {issueStatusLabel[currentIssue.status] || currentIssue.status}
              </Tag>
            </>
          )}
        </div>
        <div className="zto-head-actions">
          <Button icon={<FileTextOutlined />} onClick={() => navigate(`/report/${issueId}`)}>去报数</Button>
          <Button icon={<DownloadOutlined />} onClick={handleExportShipping} disabled={currentIssue?.id == null} loading={exporting}>导出本期</Button>
          {canMutate && <Button icon={<UploadOutlined />} onClick={() => navigate(`/logistics/issues/${issueId}/waybills/import`)}>导入运单</Button>}
          {canMutate && <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenCreate}>新增明细</Button>}
          {isAdmin && (
            <Popover
              trigger="click"
              placement="bottomRight"
              content={
                <Popconfirm
                  title={`确认清空第 ${currentIssueNumber ?? '-'} 期 ZTO-MF？`}
                  description="只删除该期 ZTO-MF，不会删除期号和报数数据。此操作不可恢复。"
                  okText="清空"
                  cancelText="取消"
                  onConfirm={handleClearCurrentIssueShippingDetails}
                  disabled={currentIssueNumber == null}
                >
                  <Button type="text" danger loading={clearingIssue} disabled={currentIssueNumber == null}>清空本期明细</Button>
                </Popconfirm>
              }
            >
              <Button icon={<MoreOutlined />} aria-label="更多本期操作" />
            </Popover>
          )}
        </div>
      </div>

      <Card className="zto-reconcile-card" styles={{ body: { padding: 0 } }}>
        <div className="zto-reconcile-main">
          <div className={`zto-reconcile-result ${planState.tone}`}>
            <div className="zto-reconcile-icon">
              {planState.kind === 'match'
                  ? <LargeStatusIcon variant="check" />
                  : planState.kind === 'error' || planState.kind === 'mismatch'
                    ? <LargeStatusIcon variant="close" />
                    : planState.kind === 'empty'
                      ? <LargeStatusIcon variant="inbox" />
                      : <LargeStatusIcon variant="reload" />}
            </div>
            <div>
              <span>发货计划对账</span>
              <strong>{planState.label}</strong>
              <small>{planState.description}</small>
              {planState.kind === 'error' && (
                <Button className="zto-inline-retry" size="small" icon={<ReloadOutlined />} onClick={retryPlanData}>重新加载</Button>
              )}
            </div>
          </div>
          <div className="zto-reconcile-metric">
            <span>确认时计划</span>
            <strong>{displayedReportTotal == null ? '—' : displayedReportTotal.toLocaleString()}</strong>
            <small>{displayedReportTotal == null ? '暂无数据' : '份'}</small>
          </div>
          <div className="zto-reconcile-metric">
            <span>当前计划</span>
            <strong>{displayedShippingTotal == null ? '—' : displayedShippingTotal.toLocaleString()}</strong>
            <small>{displayedShippingTotal == null ? '等待数据' : '份'}</small>
          </div>
          <div className="zto-reconcile-metric">
            <span>明细差异</span>
            <strong className={planMetricsReady ? (currentIsMatch === false ? 'is-danger' : currentIsMatch === true ? 'is-success' : '') : ''}>
              {displayedDelta == null ? '—' : displayedDelta.toLocaleString()}
            </strong>
            <small>{displayedDelta == null ? '暂无数据' : '份'}</small>
          </div>
          <div className="zto-reconcile-metric">
            <span>明细记录</span>
            <strong>{allDetailsLoaded && !allDetailsIsError ? allDetails.length.toLocaleString() : '—'}</strong>
            <small>{allDetailsLoaded && !allDetailsIsError ? `条 · 异常 ${anomalyRows.length.toLocaleString()} 条` : '等待数据'}</small>
          </div>
        </div>
        {hasDrift && confirmationSummary && (
          <div className="zto-change-strip">
            <span className="zto-change-icon">!</span>
            <div className="zto-change-copy">
              <strong>确认后明细有变更</strong>
              <span>
                {currentIsMatch
                  ? `当前仍与报数一致，请确认这 ${Math.abs(snapshotDelta).toLocaleString()} 份变更是否符合预期。`
                  : '当前明细已偏离确认时快照，且与报数不一致。'}
              </span>
            </div>
            <span className="zto-change-snapshot">
              确认时 {confirmationSummary.confirmed_shipping_total.toLocaleString()} → 当前 {confirmationSummary.current_shipping_total.toLocaleString()}，
              <b>{snapshotDelta > 0 ? '+' : ''}{snapshotDelta.toLocaleString()} 份</b>
            </span>
            <div className="zto-change-actions">
              <Button size="small" onClick={() => setChangeLogOpen(true)}>查看变更</Button>
              {canMutate && <Button size="small" className="zto-reverify-btn" icon={<ReloadOutlined />} onClick={handleReverify}>重新校验</Button>}
            </div>
          </div>
        )}
      </Card>

      <Card className="zto-fulfillment-card" styles={{ body: { padding: 0 } }}>
        <div className="zto-reconcile-main">
          <div className={`zto-reconcile-result ${fulfillmentPanelState.tone}`}>
            <div className="zto-reconcile-icon">
              {fulfillmentPanelState.kind === 'shipped'
                ? <LargeStatusIcon variant="check" />
                : fulfillmentPanelState.kind === 'exception' || fulfillmentPanelState.kind === 'error'
                  ? <LargeStatusIcon variant="close" />
                  : fulfillmentPanelState.kind === 'loading'
                    ? <LargeStatusIcon variant="reload" />
                    : <LargeStatusIcon variant="inbox" />}
            </div>
            <div>
              <span>实际发货核销</span>
              <strong>{fulfillmentPanelState.label}</strong>
              <small>{fulfillmentPanelState.description}</small>
              {fulfillmentPanelState.kind === 'error' && (
                <Button className="zto-inline-retry" size="small" icon={<ReloadOutlined />} onClick={retryFulfillmentData}>重新加载</Button>
              )}
            </div>
          </div>
          <div className="zto-reconcile-metric">
            <span>确认印数</span>
            <strong>{fulfillment?.expected_quantity?.toLocaleString() ?? '—'}</strong>
            <small>份 · 固定基准</small>
          </div>
          <div className="zto-reconcile-metric">
            <span>已处理</span>
            <strong>{fulfillment?.handled_quantity?.toLocaleString() ?? '—'}</strong>
            <small>{fulfillment ? `运单 ${fulfillment.tracked_quantity.toLocaleString()} + 无需运单 ${fulfillment.no_tracking_quantity.toLocaleString()}${fulfillment.adjustment_quantity ? ` + 无需发货 ${fulfillment.adjustment_quantity.toLocaleString()}` : ''}` : '份'}</small>
          </div>
          <div className="zto-reconcile-metric">
            <span>待补</span>
            <strong className={fulfillment ? (fulfillment.pending_quantity ? 'is-danger' : 'is-success') : ''}>{fulfillment?.pending_quantity?.toLocaleString() ?? '—'}</strong>
            <small>{fulfillment ? '份' : '等待数据'}</small>
          </div>
          <div className="zto-reconcile-metric">
            <span>运单</span>
            <strong>{fulfillment?.package_count?.toLocaleString() ?? '—'}</strong>
            <small>个</small>
          </div>
        </div>
        {!!fulfillment?.pending_quantity && (
          <div className="zto-fulfillment-warning">
            <span className="zto-change-icon">!</span>
            <div>
              <strong>还有 {fulfillment.pending_quantity.toLocaleString()} 份待处理</strong>
              <span>{fulfillment.latest_import?.unresolved_quantity
                ? `${fulfillment.latest_import.unmatched_rows}个未匹配运单、${fulfillment.latest_import.unresolved_quantity.toLocaleString()}份仍可继续人工关联。`
                : '可补录运单，或对停刊、取消寄送份数登记无需发货原因。'}</span>
            </div>
            <Button size="small" onClick={() => navigate(`/logistics/issues/${issueId}/waybills/import`)}>继续处理</Button>
          </div>
        )}
      </Card>

      {allDetailsIsError ? (
        <Card className="zto-empty-card">
          <Alert
            showIcon
            type="error"
            title="发货明细加载失败"
            description={logisticsApiErrorMessage(allDetailsError, '无法读取本期发货明细')}
            action={<Button size="small" icon={<ReloadOutlined />} onClick={retryPlanData}>重新加载</Button>}
          />
        </Card>
      ) : allDetailsLoading || !allDetailsLoaded ? (
        <Card className="zto-empty-card" loading />
      ) : allDetails.length === 0 ? (
        <Card className="zto-empty-card">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <div>
                <div className="zto-empty-title">本期确实没有发货计划明细</div>
                <div className="zto-empty-copy">接口已成功返回 0 条记录；请新建明细后再进行计划对账。</div>
              </div>
            }
          >
            {canMutate && <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenCreate}>新增第一条</Button>}
          </Empty>
        </Card>
      ) : (
        <Card className="zto-list-card" styles={{ body: { padding: 0 } }}>
          <div className="zto-list-head">
            <div className="zto-list-title">
              <h2>应发清单</h2>
              <span>上传运单前后始终保留同一份计划，点击整行查看完整信息</span>
            </div>
            <div className="zto-list-head-actions">
              <span><b>{allDetails.length.toLocaleString()}</b> 条 · <b>{allShippingTotal.toLocaleString()}</b> 份</span>
              {!!fulfillment?.latest_import?.unmatched_rows && (
                <Button
                  className="zto-import-exception-button"
                  onClick={() => navigate(`/logistics/issues/${issueId}/waybills/import`)}
                >
                  导入异常 {fulfillment.latest_import.unmatched_rows.toLocaleString()} 行
                </Button>
              )}
            </div>
          </div>
          <div className="zto-fulfillment-tabs">
            <Segmented<string>
              value={shippingFilters.fulfillment_status ?? 'all'}
              options={[
                { value: 'all', label: <>全部 <b>{fulfillmentTabCounts.all}</b></> },
                { value: 'completed', label: <>已核销 <b>{fulfillmentTabCounts.completed}</b></> },
                { value: 'pending', label: <>待发 <b>{fulfillmentTabCounts.pending}</b></> },
                { value: 'issue', label: <>有异常 <b>{fulfillmentTabCounts.issue}</b></> },
              ]}
              onChange={(value) => setShippingFilters((filters) => ({
                ...filters,
                fulfillment_status: value === 'all' ? undefined : value,
              }))}
            />
          </div>
          <div className="zto-toolbar">
            <Input
              placeholder="搜索姓名、地址或电话"
              prefix={<SearchOutlined />}
              className="zto-filter-search"
              allowClear
              value={shippingFilters.search ?? ''}
              onChange={(e) => setShippingFilters((f) => ({ ...f, search: e.target.value }))}
            />
            <Select
              placeholder="全部渠道"
              className="zto-filter-channel"
              allowClear
              value={shippingFilters.channel}
              onChange={(value) => setShippingFilters((f) => ({ ...f, channel: value, sub_channel: undefined }))}
            >
              {CHANNEL_OPTIONS.map((ch) => <Select.Option key={ch} value={ch}>{ch}</Select.Option>)}
            </Select>
            <Select
              mode="multiple"
              placeholder="全部签约公司"
              className="zto-filter-company"
              allowClear
              maxTagCount="responsive"
              value={shippingFilters.company}
              onChange={(value: string[]) => setShippingFilters((f) => ({ ...f, company: value }))}
            >
              {companyOptions.map((c) => <Select.Option key={c} value={c}>{c}</Select.Option>)}
            </Select>
            <Select
              placeholder="全部状态"
              className="zto-filter-status"
              allowClear
              value={shippingFilters.status}
              onChange={(value) => setShippingFilters((f) => ({ ...f, status: value }))}
            >
              {SHIPPING_STATUS_OPTIONS.map((st) => <Select.Option key={st} value={st}>{st}</Select.Option>)}
            </Select>
            <Popover
              trigger="click"
              placement="bottomLeft"
              title="更多筛选"
              content={
                <div className="zto-more-filters">
                  <Select placeholder="频率" allowClear value={shippingFilters.frequency} onChange={(value) => setShippingFilters((f) => ({ ...f, frequency: value }))}>
                    {FREQUENCY_OPTIONS.map((fr) => <Select.Option key={fr} value={fr}>{fr}</Select.Option>)}
                  </Select>
                  <Select placeholder="运输方式" allowClear value={shippingFilters.transport} onChange={(value) => setShippingFilters((f) => ({ ...f, transport: value }))}>
                    {TRANSPORT_OPTIONS.map((tr) => <Select.Option key={tr} value={tr}>{tr}</Select.Option>)}
                  </Select>
                  <Select placeholder="子渠道" allowClear value={shippingFilters.sub_channel} onChange={(value) => setShippingFilters((f) => ({ ...f, sub_channel: value }))}>
                    {SUB_CHANNEL_OPTIONS.map((sc) => <Select.Option key={sc} value={sc}>{sc}</Select.Option>)}
                  </Select>
                </div>
              }
            >
              <Button icon={<FilterOutlined />}>更多筛选{advancedFilterCount > 0 ? ` · ${advancedFilterCount}` : ''}</Button>
            </Popover>
            <div className="zto-toolbar-tail">
              <Button type="link" disabled={!hasShippingFilters} onClick={() => setShippingFilters({})}>清除筛选</Button>
              <span className="zto-toolbar-count">
                共 <b>{detailsIsError ? '—' : visibleDetails.length}</b> 条 · 合计 <b>{detailsIsError ? '—' : visibleShippingTotal.toLocaleString()}</b> 份
              </span>
            </div>
          </div>

          {canMutate && selectedRowKeys.length > 0 && (
            <div className="zto-batchbar">
              <span className="zto-batch-lbl">已选 {selectedRowKeys.length} 条</span>
              <Button size="small" onClick={() => handleBatchStatus('正常')}>设为正常</Button>
              <Button size="small" danger onClick={() => handleBatchStatus('停发')}>设为停发</Button>
              <DatePicker size="small" placeholder="截止日期" value={batchDeadline} onChange={setBatchDeadline} />
              <Button size="small" onClick={handleBatchDeadline}>改截止日期</Button>
              <Popconfirm title={`确认删除选中的 ${selectedRowKeys.length} 条记录？`} onConfirm={handleBatchDelete}>
                <Button size="small" danger>批量删除</Button>
              </Popconfirm>
              <Button size="small" type="link" onClick={() => setSelectedRowKeys([])}>取消选择</Button>
            </div>
          )}

          {detailsIsError ? (
            <Alert
              className="zto-list-error"
              showIcon
              type="error"
              title="当前筛选结果加载失败"
              description={logisticsApiErrorMessage(detailsError, '无法读取发货明细')}
              action={<Button size="small" icon={<ReloadOutlined />} onClick={() => void refetchDetails()}>重新加载</Button>}
            />
          ) : (
            <Spin spinning={isLoading}>
              {visibleDetails.length ? (
                <ShippingDetailCardList
                  key={JSON.stringify(shippingFilters)}
                  records={visibleDetails}
                  selectedRowKeys={selectedRowKeys}
                  canSelect={canMutate}
                  onSelectedRowKeysChange={setSelectedRowKeys}
                  onOpenDetail={setDetailDrawerRecord}
                />
              ) : (
                <Empty className="zto-filter-empty" image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有符合当前条件的应发清单" />
              )}
            </Spin>
          )}
        </Card>
      )}

      <Modal
        title={`补录运单${packageRecord ? ` · ${packageRecord.name}` : ''}`}
        open={!!packageRecord}
        onOk={handleAddPackage}
        onCancel={() => { setPackageRecord(null); packageForm.resetFields(); }}
      >
        <Form form={packageForm} layout="vertical">
          <Form.Item name="carrier" label="快递公司" rules={[{ required: true, message: '请输入快递公司' }]}>
            <Select options={["中通", "顺丰", "邮政", "邮政挂号"].map((value) => ({ value, label: value }))} />
          </Form.Item>
          <Form.Item name="tracking_no" label="运单号" rules={[{ required: true, message: '请输入运单号' }]}>
            <Input placeholder="请输入运单号" />
          </Form.Item>
          <Form.Item name="quantity" label="本包裹份数" rules={[{ required: true, message: '请输入份数' }]}>
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editingRecord ? '编辑记录' : '新增记录'}
        open={modalVisible}
        onOk={handleSubmit}
        onCancel={handleCloseModal}
        okButtonProps={{ disabled: currentIssueNumber == null }}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="姓名" name="name" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input placeholder="请输入姓名" />
          </Form.Item>
          <Form.Item label="渠道" name="channel" rules={[{ required: true, message: '请选择渠道' }]}>
            <Select
              placeholder="请选择渠道"
              onChange={(value) => {
                if (value !== '赠阅') form.setFieldValue('sub_channel', null);
              }}
            >
              {CHANNEL_OPTIONS.map((ch) => <Select.Option key={ch} value={ch}>{ch}</Select.Option>)}
            </Select>
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(previous, current) => (
            previous.channel !== current.channel || previous.sub_channel !== current.sub_channel
          )}>
            {({ getFieldValue, setFieldValue }) => {
              const channel = getFieldValue('channel');
              const legacySubChannel = getFieldValue('sub_channel');
              if (channel === '赠阅') {
                return (
                <Form.Item label="子渠道" name="sub_channel">
                  <Select placeholder="请选择子渠道" allowClear>
                    {SUB_CHANNEL_OPTIONS.map((sc) => <Select.Option key={sc} value={sc}>{sc}</Select.Option>)}
                  </Select>
                </Form.Item>
                );
              }
              if (!legacySubChannel) return null;
              return (
                <Form.Item
                  label="历史子渠道"
                  help="该值来自旧文件导入，不属于当前标准子渠道。"
                >
                  <Input
                    value={legacySubChannel}
                    readOnly
                    addonAfter={<Button type="link" size="small" onClick={() => setFieldValue('sub_channel', null)}>清空</Button>}
                  />
                </Form.Item>
              );
            }}
          </Form.Item>
          <Form.Item label="签约公司" name="company">
            <Input placeholder="请输入签约公司（如：北京悦途出行）" />
          </Form.Item>
          <Form.Item label="地址" name="address">
            <Input placeholder="请输入地址" />
          </Form.Item>
          <Form.Item label="电话" name="phone">
            <Input placeholder="请输入电话" />
          </Form.Item>
          <Form.Item label="份数" name="quantity">
            <InputNumber placeholder="请输入份数" style={{ width: '100%' }} min={0} />
          </Form.Item>
          <Form.Item label="频率" name="frequency">
            <Select placeholder="请选择频率" allowClear>
              {FREQUENCY_OPTIONS.map((fr) => <Select.Option key={fr} value={fr}>{fr}</Select.Option>)}
            </Select>
          </Form.Item>
          <Form.Item label="运输方式" name="transport">
            <Select placeholder="请选择运输方式" allowClear>
              {TRANSPORT_OPTIONS.map((tr) => <Select.Option key={tr} value={tr}>{tr}</Select.Option>)}
            </Select>
          </Form.Item>
          <Form.Item label="截止日期" name="deadline">
            <Input placeholder="请输入截止日期（如：长期、2025-12-31）" />
          </Form.Item>
          <Form.Item label="发货时间" name="shipped_at">
            <DatePicker placeholder="请选择发货时间" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="状态" name="status">
            <Select placeholder="请选择状态" allowClear>
              {SHIPPING_STATUS_OPTIONS.map((st) => <Select.Option key={st} value={st}>{st}</Select.Option>)}
            </Select>
          </Form.Item>
          <Form.Item label="备注" name="notes">
            <Input.TextArea placeholder="请输入备注" rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="确认后可能变更的明细（人工修改 / 孤立）"
        open={changeLogOpen}
        onCancel={() => setChangeLogOpen(false)}
        footer={null}
        width={720}
      >
        {(() => {
          const changed = allDetails.filter((d) => d.sync_status !== 'synced');
          return changed.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 32, color: 'var(--color-text-secondary)' }}>本期无人工修改 / 孤立明细。</div>
          ) : (
            <Table
              size="small"
              rowKey="id"
              dataSource={changed}
              pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 条` }}
              columns={[
                { title: '姓名', dataIndex: 'name', width: 100 },
                { title: '渠道', dataIndex: 'channel', render: (v: string) => v || '—' },
                { title: '签约公司', dataIndex: 'company', render: (v: string | null) => v || '—' },
                { title: '份数', dataIndex: 'quantity', width: 70, align: 'right' },
                { title: '同步状态', dataIndex: 'sync_status', width: 100, render: (v: string) => <Tag color={v === 'orphaned' ? 'red' : 'orange'}>{v === 'orphaned' ? '孤立' : '人工修改'}</Tag> },
              ]}
            />
          );
        })()}
      </Modal>

      <Drawer
        title={detailDrawerRecord ? (
          <DrawerTitle
            icon="🚚"
            title={detailDrawerRecord.name || '发货明细'}
            description={`${detailDrawerRecord.channel || '未分类'} · 应发清单 #${detailDrawerRecord.id}`}
            tone={detailDrawerRecord.fulfillment_status === 'partial' ? 'warning' : detailDrawerRecord.fulfillment_status === 'pending' ? 'neutral' : 'success'}
            status={(
              <StatusPill tone={detailDrawerRecord.fulfillment_status === 'partial' ? 'warning' : detailDrawerRecord.fulfillment_status === 'pending' ? 'neutral' : 'success'}>
                {(fulfillmentMeta[detailDrawerRecord.fulfillment_status] || fulfillmentMeta.pending).label}
              </StatusPill>
            )}
          />
        ) : null}
        open={!!detailDrawerRecord}
        onClose={() => setDetailDrawerRecord(null)}
        size={520}
        rootClassName="app-drawer-root zto-detail-drawer-root"
        footer={detailDrawerRecord ? (
          <div className="app-drawer-footer zto-detail-drawer-footer">
            <Button icon={<HistoryOutlined />} onClick={() => handleShowLogs(detailDrawerRecord)}>操作日志</Button>
            {canMutate && detailDrawerRecord.shipping_requirement !== 'no_tracking_required' && (
              <Button onClick={() => handleOpenPackage(detailDrawerRecord)}>补录运单</Button>
            )}
            {canMutate && (
              <Popover
                trigger="click"
                placement="topRight"
                open={actionMenuRecordId === detailDrawerRecord.id}
                onOpenChange={(open) => setActionMenuRecordId(open ? detailDrawerRecord.id : null)}
                content={(
                  <div className="zto-action-menu">
                    {detailDrawerRecord.shipping_requirement === 'no_tracking_required' ? (
                      <Button type="text" onClick={() => handleNoTracking(detailDrawerRecord, false)}>恢复需要运单</Button>
                    ) : !detailDrawerRecord.package_count ? (
                      <Button type="text" onClick={() => handleNoTracking(detailDrawerRecord, true)}>标记无需发货</Button>
                    ) : null}
                    {detailDrawerRecord.source_type !== 'complaint_makeup' ? (
                      <Popconfirm title="确认删除？" onConfirm={() => handleDelete(detailDrawerRecord.id)}>
                        <Button type="text" danger icon={<DeleteOutlined />}>删除明细</Button>
                      </Popconfirm>
                    ) : <Button type="text" disabled>请在邮局工单取消</Button>}
                  </div>
                )}
              >
                <Button icon={<MoreOutlined />}>更多</Button>
              </Popover>
            )}
            {canMutate && <Button type="primary" onClick={() => handleEdit(detailDrawerRecord)}>编辑明细</Button>}
          </div>
        ) : null}
      >
        {detailDrawerRecord && (
          <div className="zto-detail-drawer">
            <div className="zto-detail-metrics">
              <div><span>应发</span><strong>{detailDrawerRecord.quantity.toLocaleString()}</strong></div>
              <div><span>已核销</span><strong>{detailDrawerRecord.handled_quantity.toLocaleString()}</strong></div>
              <div><span>待发</span><strong>{Math.max(detailDrawerRecord.quantity - detailDrawerRecord.handled_quantity, 0).toLocaleString()}</strong></div>
            </div>

            <section className="zto-detail-section">
              <h3>收件与计划信息</h3>
              <div className="zto-detail-facts">
                <div><span>联系电话</span><strong>{detailDrawerRecord.phone || '—'}</strong></div>
                <div><span>渠道</span><strong><Tag color={channelColors[detailDrawerRecord.channel] || 'default'}>{detailDrawerRecord.channel || '—'}</Tag></strong></div>
                <div><span>子渠道</span><strong>{detailDrawerRecord.sub_channel || '—'}</strong></div>
                <div className="is-wide"><span>收件地址</span><strong>{detailDrawerRecord.address || '—'}</strong></div>
                <div><span>签约公司</span><strong>{detailDrawerRecord.company || '—'}</strong></div>
                <div><span>运输方式</span><strong><Tag color={transportColors[detailDrawerRecord.transport] || 'default'}>{detailDrawerRecord.transport || '—'}</Tag></strong></div>
                <div><span>发送频率</span><strong>{detailDrawerRecord.frequency || '—'}</strong></div>
                <div><span>数据状态</span><strong>{detailDrawerRecord.status || '—'}</strong></div>
              </div>
            </section>

            <section className="zto-detail-section">
              <h3>实际发货</h3>
              {detailDrawerRecord.packages.length ? (
                <div className="zto-drawer-packages">
                  {detailDrawerRecord.packages.map((item) => (
                    <div className="zto-drawer-package" key={item.id}>
                      <div><strong>{item.carrier} · {item.tracking_no}</strong><span>{dayjs(item.shipped_at).format('YYYY-MM-DD')} 发出</span></div>
                      <div className="zto-drawer-package-quantity">{item.quantity.toLocaleString()} 份</div>
                      {canMutate && (
                        <Popconfirm title="确认删除这个运单？" onConfirm={() => handleDeletePackage(item.id)}>
                          <Button type="link" size="small" danger>删除</Button>
                        </Popconfirm>
                      )}
                    </div>
                  ))}
                </div>
              ) : detailDrawerRecord.shipping_requirement === 'no_tracking_required' ? (
                <Alert showIcon type="success" title="无需运单，系统已按计划份数完成核销" />
              ) : (
                <Alert showIcon type="warning" title="尚未录入运单，本条仍待发货" />
              )}
            </section>

            <section className="zto-detail-section">
              <h3>来源与同步</h3>
              <div className="zto-detail-facts">
                <div><span>来源</span><strong>{sourceTypeMeta[detailDrawerRecord.source_type]?.label || detailDrawerRecord.source_type}</strong></div>
                <div><span>同步状态</span><strong className={`zto-sync zto-sync--${detailDrawerRecord.sync_status}`}>{syncStatusMeta[detailDrawerRecord.sync_status]?.label || detailDrawerRecord.sync_status}</strong></div>
                <div><span>工作表</span><strong>{detailDrawerRecord.sheet_name || '—'}</strong></div>
                <div><span>最近更新</span><strong>{dayjs(detailDrawerRecord.updated_at).format('YYYY-MM-DD HH:mm')}</strong></div>
              </div>
            </section>

            <section className="zto-detail-section">
              <h3>更多信息</h3>
              <div className="zto-detail-facts">
                <div><span>截止日期</span><strong>{detailDrawerRecord.deadline || '长期'}</strong></div>
                <div><span>发货时间</span><strong>{detailDrawerRecord.shipped_at ? dayjs(detailDrawerRecord.shipped_at).format('YYYY-MM-DD') : '—'}</strong></div>
                <div><span>站点 / 站厅</span><strong>{[detailDrawerRecord.station_name, detailDrawerRecord.station_hall].filter(Boolean).join(' / ') || '—'}</strong></div>
                <div><span>联系人</span><strong>{detailDrawerRecord.contact_person || '—'}</strong></div>
                <div className="is-wide"><span>来源订单</span><strong>{detailDrawerRecord.order_id ? <a onClick={() => navigate(`/orders/${detailDrawerRecord.order_id}`)}>查看订单 #{detailDrawerRecord.order_id}</a> : '—'}</strong></div>
                <div className="is-wide"><span>备注 / 附加信息</span><strong>{[detailDrawerRecord.notes, detailDrawerRecord.extra_info].filter(Boolean).join(' · ') || '—'}</strong></div>
              </div>
            </section>
          </div>
        )}
      </Drawer>

      <Drawer
        title={(
          <DrawerTitle
            icon="🕘"
            title="操作日志"
            description={logRecordName || '发货明细'}
            status={<StatusPill tone="neutral">{logsLoading ? '加载中' : `${operationLogs.length} 条记录`}</StatusPill>}
          />
        )}
        open={logDrawerOpen}
        onClose={() => { setLogDrawerOpen(false); setLogRecordId(null); }}
        size={480}
        rootClassName="app-drawer-root"
        footer={(
          <div className="app-drawer-footer">
            <span className="app-drawer-footer-tip"><b>✓</b>按发生时间展示新增、编辑与删除记录</span>
            <Button type="primary" onClick={() => { setLogDrawerOpen(false); setLogRecordId(null); }}>关闭</Button>
          </div>
        )}
      >
        <div className="app-drawer-panel">
          <h3><span aria-hidden>🧾</span>变更记录</h3>
          {logsLoading ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-secondary)' }}>加载中...</div>
          ) : operationLogs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-secondary)' }}>暂无操作日志</div>
          ) : (
            <Timeline
            items={operationLogs.map((log: OperationLog) => {
              const actionLabels: Record<string, string> = { create: '新增', update: '编辑', delete: '删除' };
              const actionColors: Record<string, string> = { create: 'green', update: 'blue', delete: 'red' };
              return {
                color: actionColors[log.action] || 'gray',
                children: (
                  <div>
                    <div style={{ marginBottom: 4 }}>
                      <Tag color={actionColors[log.action]}>{actionLabels[log.action] || log.action}</Tag>
                      <span style={{ fontWeight: 500 }}>{log.username || '系统'}</span>
                      <span style={{ color: 'var(--color-text-secondary)', marginLeft: 8, fontSize: 12 }}>
                        {dayjs(log.created_at).format('YYYY-MM-DD HH:mm:ss')}
                      </span>
                    </div>
                    {log.action === 'update' && log.changes && (
                      <div style={{ fontSize: 13, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
                        {Object.entries(log.changes).map(([field, val]) => {
                          const v = val as { old: any; new: any };
                          return (
                            <div key={field} style={{ marginBottom: 2 }}>
                              <span style={{ color: 'var(--color-text-secondary)' }}>{fieldLabels[field] || field}：</span>
                              <span style={{ textDecoration: 'line-through', color: 'var(--color-text-secondary)' }}>{v.old ?? '空'}</span>
                              {' → '}
                              <span style={{ fontWeight: 500 }}>{v.new ?? '空'}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {log.action === 'create' && log.changes && (
                      <div style={{ fontSize: 13, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
                        {Object.entries(log.changes)
                          .filter(([, v]) => v != null && v !== '' && v !== 0)
                          .map(([field, v]) => (
                            <div key={field} style={{ marginBottom: 2 }}>
                              <span style={{ color: 'var(--color-text-secondary)' }}>{fieldLabels[field] || field}：</span>
                              <span>{String(v)}</span>
                            </div>
                          ))}
                      </div>
                    )}
                    {log.action === 'delete' && (
                      <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>记录已删除</div>
                    )}
                  </div>
                ),
              };
            })}
            />
          )}
        </div>
      </Drawer>
    </div>
  );
}
