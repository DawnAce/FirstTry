import { useMemo, useState } from 'react';
import type { Key } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
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
  Upload,
  Checkbox,
} from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  DeleteOutlined,
  HistoryOutlined,
  DownloadOutlined,
  FilterOutlined,
  LeftOutlined,
  ReloadOutlined,
  MoreOutlined,
  UploadOutlined,
  InboxOutlined,
  FileExcelOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ShippingDetail,
  ShippingDetailCreate,
  ShippingDetailUpdate,
  ShippingPlanImportAdjustment,
  ShippingPlanImportPreview,
} from '../api/shippingDetails';
import {
  getShippingDetails,
  createShippingDetail,
  updateShippingDetail,
  deleteShippingDetail,
  batchUpdateShippingDetails,
  batchDeleteShippingDetails,
  clearShippingDetailsByIssue,
  previewShippingPlanImport,
  commitShippingPlanImport,
  resetActualShippingRecipient,
  updateActualShippingRecipient,
} from '../api/shippingDetails';
import { getIssue } from '../api/issues';
import { getOperationLogs, getRecentOperationLogs } from '../api/operationLogs';
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

const CHANNEL_OPTIONS = ['渠道订阅', '对公订阅', '个人订阅', '记者站', '赠阅', '自用', '库房留存', '报社留存'] as const;
const SUB_CHANNEL_OPTIONS_BY_CHANNEL: Record<string, readonly string[]> = {
  '赠阅': ['监管', '政府', '客情维护'],
  '自用': ['业务', '会议'],
};
const SUB_CHANNEL_OPTIONS = ['监管', '政府', '客情维护', '业务', '会议'] as const;
const FREQUENCY_OPTIONS = ['周', '半月', '月'] as const;
const TRANSPORT_OPTIONS = ['中通物流', '邮政物流', '包车运输', '库房留存'] as const;
const SHIPPING_STATUS_OPTIONS = ['正常', '停发'] as const;

const channelColors: Record<string, string> = {
  '渠道订阅': 'blue', '对公订阅': 'blue', '个人订阅': 'green', '记者站': 'purple',
  '赠阅': 'orange', '自用': 'geekblue', '库房留存': 'default', '报社留存': 'cyan',
};
const transportColors: Record<string, string> = {
  '中通物流': 'blue', '邮政物流': 'green', '包车运输': 'orange', '库房留存': 'default',
};
const sourceTypeMeta: Record<string, { label: string; color: string }> = {
  manual: { label: '手工录入', color: 'default' },
  order_generated: { label: '订单生成', color: 'blue' },
  historical_import: { label: '历史导入', color: 'default' },
  complaint_makeup: { label: '投诉补发', color: 'volcano' },
  recurring_generated: { label: '固定生成', color: 'cyan' },
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
  actual_name: '实际收件人', actual_address: '实际地址', actual_phone: '实际电话',
  actual_adjustment_reason: '实发调整原因', actual_adjusted_at: '实发调整时间',
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
  no_shipment_required: { label: '无需发货', color: 'green' },
  warehouse_stock_in: { label: '库存入库', color: 'cyan' },
};

const matchesFulfillmentView = (detail: ShippingDetail, filter?: string) => {
  if (!filter || filter === 'all') return true;
  if (filter === 'completed') {
    return ['shipped', 'no_tracking_required', 'no_shipment_required', 'warehouse_stock_in'].includes(detail.fulfillment_status);
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
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAdmin, canMutate } = useAuth();
  const requestedSection = searchParams.get('section') === 'actual' ? 'actual' : 'plan';
  const activeSection = requestedSection;
  const [shippingFilters, setShippingFilters] = useState<ShippingFilters>({});
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<ShippingDetail | null>(null);
  const [form] = Form.useForm();
  const [logDrawerOpen, setLogDrawerOpen] = useState(false);
  const [logRecordId, setLogRecordId] = useState<number | null>(null);
  const [logRecordName, setLogRecordName] = useState<string>('');
  const [issueLogDrawerOpen, setIssueLogDrawerOpen] = useState(false);
  const [actionMenuRecordId, setActionMenuRecordId] = useState<number | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
  const [detailDrawerRecord, setDetailDrawerRecord] = useState<ShippingDetail | null>(null);
  const [batchDeadline, setBatchDeadline] = useState<dayjs.Dayjs | null>(null);
  const [exporting, setExporting] = useState(false);
  const [clearingIssue, setClearingIssue] = useState(false);
  const [changeLogOpen, setChangeLogOpen] = useState(false);
  const [packageRecord, setPackageRecord] = useState<ShippingDetail | null>(null);
  const [packageForm] = Form.useForm();
  const [planImportOpen, setPlanImportOpen] = useState(() => searchParams.get('action') === 'import' && isAdmin);
  const [planImportFile, setPlanImportFile] = useState<File | null>(null);
  const [planImportPreview, setPlanImportPreview] = useState<ShippingPlanImportPreview | null>(null);
  const [planImportReason, setPlanImportReason] = useState('');
  const [planImportPreviewing, setPlanImportPreviewing] = useState(false);
  const [planImportCommitting, setPlanImportCommitting] = useState(false);
  const [planImportAdjustmentsConfirmed, setPlanImportAdjustmentsConfirmed] = useState(false);
  const [actualRecipientRecord, setActualRecipientRecord] = useState<ShippingDetail | null>(null);
  const [actualRecipientSaving, setActualRecipientSaving] = useState(false);
  const [actualRecipientForm] = Form.useForm();

  const switchSection = (section: 'plan' | 'actual') => {
    setSelectedRowKeys([]);
    setSearchParams({ section }, { replace: true });
  };

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

  // Load the per-issue list once. Filters are cheap to apply locally and this
  // avoids requesting the same up-to-10k rows twice on every page entry.
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
      const res = await getShippingDetails({ issue_number: currentIssueNumber, limit: 10000 });
      return res.data;
    },
    enabled: currentIssueNumber != null,
  });

  const details = useMemo(() => allDetails.filter((detail) => {
    if (shippingFilters.channel && detail.channel !== shippingFilters.channel) return false;
    if (shippingFilters.sub_channel && detail.sub_channel !== shippingFilters.sub_channel) return false;
    if (shippingFilters.frequency && detail.frequency !== shippingFilters.frequency) return false;
    if (shippingFilters.transport && detail.transport !== shippingFilters.transport) return false;
    if (activeSection === 'plan' && shippingFilters.status && detail.status !== shippingFilters.status) return false;
    if (shippingFilters.search) {
      const keyword = shippingFilters.search.trim();
      const searchable = activeSection === 'actual'
        ? [detail.actual_name, detail.actual_phone, detail.actual_address, detail.name, detail.phone, detail.address]
        : [detail.name, detail.phone, detail.address, detail.company];
      if (!searchable.some((value) => value?.includes(keyword))) return false;
    }
    if (shippingFilters.company?.length && !shippingFilters.company.includes(detail.company ?? '')) return false;
    return true;
  }), [activeSection, allDetails, shippingFilters]);
  const isLoading = allDetailsLoading;
  const detailsIsError = allDetailsIsError;
  const detailsError = allDetailsError;
  const refetchDetails = refetchAllDetails;

  const companyOptions = useMemo(
    () => [...new Set(allDetails.map((detail) => detail.company).filter((value): value is string => !!value))].sort(),
    [allDetails],
  );

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

  const { data: issueOperationLogs = [], isLoading: issueLogsLoading } = useQuery({
    queryKey: ['operationLogs', 'issue', currentIssueNumber],
    queryFn: async () => {
      if (currentIssueNumber == null) return [];
      return (await getRecentOperationLogs({ issue_number: currentIssueNumber, limit: 100 })).data;
    },
    enabled: issueLogDrawerOpen && currentIssueNumber != null,
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

  const closePlanImport = () => {
    if (planImportPreviewing || planImportCommitting) return;
    setPlanImportOpen(false);
    setPlanImportFile(null);
    setPlanImportPreview(null);
    setPlanImportReason('');
    setPlanImportAdjustmentsConfirmed(false);
  };

  const handlePreviewPlanImport = async () => {
    if (!planImportFile) {
      message.warning('请先选择中通发货明细文件');
      return;
    }
    setPlanImportPreviewing(true);
    setPlanImportPreview(null);
    setPlanImportAdjustmentsConfirmed(false);
    try {
      const response = await previewShippingPlanImport(issueId, planImportFile);
      setPlanImportPreview(response.data);
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } } };
      message.error(err.response?.data?.detail || '中通明细预览失败');
    } finally {
      setPlanImportPreviewing(false);
    }
  };

  const handleCommitPlanImport = async () => {
    if (!planImportPreview?.can_commit || !planImportPreview.import_session_id) return;
    if (planImportPreview.adjustments.length > 0 && !planImportAdjustmentsConfirmed) {
      message.warning('请先逐条核对并确认导入格式修正');
      return;
    }
    if (planImportReason.trim().length < 2) {
      message.warning('请填写本次上传或替换计划的原因');
      return;
    }
    setPlanImportCommitting(true);
    try {
      const response = await commitShippingPlanImport(
        issueId,
        planImportPreview.import_session_id,
        planImportReason.trim(),
        planImportAdjustmentsConfirmed,
      );
      message.success(
        `已导入 ${response.data.created_count} 条中通明细，当前计划 ${response.data.resulting_quantity.toLocaleString()} 份${
          response.data.restored_waybill_rows
            ? `；已恢复 ${response.data.restored_waybill_rows} 条运单、${response.data.restored_waybill_quantity.toLocaleString()} 份实发`
            : ''
        }${response.data.unresolved_waybill_rows ? `；另有 ${response.data.unresolved_waybill_rows} 条运单待人工关联` : ''}`,
      );
      setPlanImportOpen(false);
      setPlanImportFile(null);
      setPlanImportPreview(null);
      setPlanImportReason('');
      setPlanImportAdjustmentsConfirmed(false);
      refreshShippingDetails();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } } };
      message.error(err.response?.data?.detail || '上传发货计划失败');
    } finally {
      setPlanImportCommitting(false);
    }
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

  const handleOpenActualRecipient = (record: ShippingDetail) => {
    setDetailDrawerRecord(null);
    setActualRecipientRecord(record);
    actualRecipientForm.setFieldsValue({
      name: record.actual_name || record.name,
      phone: record.actual_phone || record.phone,
      address: record.actual_address || record.address,
      reason: record.actual_adjustment_reason || '',
    });
  };

  const handleSaveActualRecipient = async () => {
    if (!actualRecipientRecord) return;
    setActualRecipientSaving(true);
    try {
      const values = await actualRecipientForm.validateFields();
      await updateActualShippingRecipient(actualRecipientRecord.id, values);
      message.success('实际收件信息已调整，发货计划保持不变');
      setActualRecipientRecord(null);
      actualRecipientForm.resetFields();
      refreshShippingDetails();
    } catch (error) {
      message.error(logisticsApiErrorMessage(error, '调整实际收件信息失败'));
    } finally {
      setActualRecipientSaving(false);
    }
  };

  const handleResetActualRecipient = async () => {
    if (!actualRecipientRecord) return;
    setActualRecipientSaving(true);
    try {
      await resetActualShippingRecipient(actualRecipientRecord.id);
      message.success('实际发货已恢复沿用计划收件信息');
      setActualRecipientRecord(null);
      actualRecipientForm.resetFields();
      refreshShippingDetails();
    } catch (error) {
      message.error(logisticsApiErrorMessage(error, '恢复计划收件信息失败'));
    } finally {
      setActualRecipientSaving(false);
    }
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
      message.success(value ? '已标记为无需运单' : '已恢复为需要运单');
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
    form.setFieldsValue(record);
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
      if (editingRecord) {
        const updateData: ShippingDetailUpdate = { ...values, sub_channel };
        await updateShippingDetail(editingRecord.id, updateData);
        message.success('更新成功');
      } else {
        if (currentIssueNumber == null) return;
        const createData: ShippingDetailCreate = {
          ...values,
          sub_channel: sub_channel || undefined,
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
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } } };
      message.error(err.response?.data?.detail || '批量删除失败');
    }
  };

  const handleClearCurrentIssueShippingDetails = async () => {
    if (currentIssueNumber == null) return;
    setClearingIssue(true);
    try {
      const res = await clearShippingDetailsByIssue(currentIssueNumber);
      message.success(`已清空第 ${currentIssueNumber} 期 ${res.data.affected_count} 条发货计划`);
      setSelectedRowKeys([]);
      refreshShippingDetails();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } } };
      message.error(err.response?.data?.detail || '清空本期发货计划失败');
    } finally {
      setClearingIssue(false);
    }
  };

  const confirmationSummary = report?.confirmation_summary;
  const allShippingTotal = allDetails.filter((detail) => detail.source_type !== 'complaint_makeup').reduce((sum, detail) => sum + (detail.quantity ?? 0), 0);
  const check = report?.shipping_check;
  const advancedFilterCount = [shippingFilters.frequency, shippingFilters.transport, shippingFilters.sub_channel].filter(Boolean).length;
  const currentIsMatch = confirmationSummary?.plan_is_reconciled ?? confirmationSummary?.plan_is_match ?? null;
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
    ? confirmationSummary?.plan_unexplained_delta ?? confirmationSummary?.plan_delta ?? null
    : null;
  const hasDrift = planMetricsReady && !!confirmationSummary?.has_shipping_drift;
  const hasAttributedChanges = !!fulfillment?.adjustments.length;
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
    || (activeSection === 'plan' && shippingFilters.status)
    || shippingFilters.search
    || shippingFilters.company?.length
    || (activeSection === 'actual' && shippingFilters.fulfillment_status)
  );
  const visibleDetails = activeSection === 'actual'
    ? details.filter((detail) => matchesFulfillmentView(detail, shippingFilters.fulfillment_status))
    : details;
  const visibleShippingTotal = visibleDetails
    .filter((detail) => detail.source_type !== 'complaint_makeup')
    .reduce((sum, detail) => sum + (detail.quantity ?? 0), 0);
  const visibleActualTotal = visibleDetails
    .filter((detail) => detail.source_type !== 'complaint_makeup')
    .reduce((sum, detail) => sum + detail.physical_shipped_quantity, 0);
  const fulfillmentTabCounts = {
    all: details.length,
    completed: details.filter((detail) => matchesFulfillmentView(detail, 'completed')).length,
    pending: details.filter((detail) => matchesFulfillmentView(detail, 'pending')).length,
    issue: details.filter((detail) => matchesFulfillmentView(detail, 'issue')).length,
  };

  const retryPlanData = () => {
    void Promise.all([refetchAllDetails(), refetchReport()]);
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
        onClick={() => navigate(activeSection === 'plan' ? '/logistics/plans' : '/logistics/shipments')}
      >
        返回{activeSection === 'plan' ? '发货计划' : '实际发货'}列表
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
          <Button icon={<DownloadOutlined />} onClick={handleExportShipping} disabled={currentIssue?.id == null} loading={exporting}>导出本期</Button>
          <Button icon={<HistoryOutlined />} onClick={() => setIssueLogDrawerOpen(true)}>操作记录</Button>
        </div>
      </div>

      <div className="zto-section-bar">
        <div className="zto-section-tabs" role="tablist" aria-label="快递管理内容">
          <button
            type="button"
            role="tab"
            aria-selected={activeSection === 'plan'}
            className={activeSection === 'plan' ? 'is-active' : ''}
            onClick={() => switchSection('plan')}
          >
            <strong>发货计划</strong>
            <span>收件人、地址与应发份数，不含运单</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeSection === 'actual'}
            className={activeSection === 'actual' ? 'is-active' : ''}
            onClick={() => switchSection('actual')}
          >
            <strong>实际发货</strong>
            <span>运单、实发份数与核销结果</span>
          </button>
        </div>
        <div className="zto-section-actions">
          {activeSection === 'plan' ? (
            <>
              {canMutate && <Button icon={<PlusOutlined />} onClick={handleOpenCreate}>新增明细</Button>}
              {isAdmin && <Button type="primary" icon={<UploadOutlined />} onClick={() => setPlanImportOpen(true)}>上传 / 替换计划</Button>}
              {(canMutate || isAdmin) && (
                <Popover
                  trigger="click"
                  placement="bottomRight"
                  content={(
                    <div className="zto-action-menu">
                      <Button type="text" onClick={() => setChangeLogOpen(true)}>查看变更与归因</Button>
                      {canMutate && <Button type="text" icon={<ReloadOutlined />} onClick={handleReverify}>重新校验计划</Button>}
                      {isAdmin && (
                        <Popconfirm
                          title={`确认清空第 ${currentIssueNumber ?? '-'} 期发货计划？`}
                          description="只允许清空没有运单、实发或核销记录的计划。"
                          okText="清空"
                          cancelText="取消"
                          onConfirm={handleClearCurrentIssueShippingDetails}
                          disabled={currentIssueNumber == null}
                        >
                          <Button type="text" danger loading={clearingIssue} disabled={currentIssueNumber == null}>清空本期计划</Button>
                        </Popconfirm>
                      )}
                    </div>
                  )}
                >
                  <Button icon={<MoreOutlined />}>维护计划</Button>
                </Popover>
              )}
            </>
          ) : (
            canMutate && <Button type="primary" icon={<UploadOutlined />} onClick={() => navigate(`/logistics/issues/${issueId}/waybills/import`)}>上传运单明细</Button>
          )}
        </div>
      </div>

      {activeSection === 'plan' && currentIssue && dayjs(currentIssue.publish_date).year() === 2026 && (
        <Alert
          type="info"
          showIcon
          title="2026年「上犹」的3个政府单位全年期数发货明细已全部列出。"
          description="每期固定30份；手动上传的发货计划若包含相同明细，系统将在导入时自动忽略。"
          style={{ marginBottom: 16 }}
        />
      )}

      {activeSection === 'plan' && <Card className="zto-reconcile-card" styles={{ body: { padding: 0 } }}>
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
            <span>已归因停发</span>
            <strong className={confirmationSummary?.plan_attributed_quantity ? 'is-success' : ''}>
              {confirmationSummary?.plan_attributed_quantity?.toLocaleString() ?? '0'}
            </strong>
            <small>份</small>
          </div>
          <div className="zto-reconcile-metric">
            <span>未解释差异</span>
            <strong className={planMetricsReady ? (currentIsMatch === false ? 'is-danger' : currentIsMatch === true ? 'is-success' : '') : ''}>
              {displayedDelta == null ? '—' : displayedDelta.toLocaleString()}
            </strong>
            <small>{displayedDelta == null ? '暂无数据' : '份'}</small>
          </div>
        </div>
        {(hasDrift || hasAttributedChanges) && confirmationSummary && (
          <div className="zto-change-strip">
            <span className="zto-change-icon">!</span>
            <div className="zto-change-copy">
              <strong>{confirmationSummary.plan_is_reconciled ? '确认后变更已归因' : '确认后明细有变更'}</strong>
              <span>
                {confirmationSummary.plan_is_reconciled
                  ? `${confirmationSummary.confirmed_shipping_total.toLocaleString()} = 当前计划 ${confirmationSummary.current_shipping_total.toLocaleString()} + 已归因停发 ${confirmationSummary.plan_attributed_quantity.toLocaleString()}`
                  : `仍有 ${Math.abs(confirmationSummary.plan_unexplained_delta).toLocaleString()} 份差异未解释。`}
              </span>
            </div>
            <span className="zto-change-snapshot">
              确认时 {confirmationSummary.confirmed_shipping_total.toLocaleString()} → 当前 {confirmationSummary.current_shipping_total.toLocaleString()}，
              <b>{snapshotDelta > 0 ? '+' : ''}{snapshotDelta.toLocaleString()} 份</b>
            </span>
            <div className="zto-change-actions">
              <Button size="small" onClick={() => setChangeLogOpen(true)}>查看变更与归因</Button>
            </div>
          </div>
        )}
      </Card>}

      {activeSection === 'actual' && <Card className="zto-fulfillment-card" styles={{ body: { padding: 0 } }}>
        <div className="zto-reconcile-main has-five-metrics">
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
              <span>实际发货与核销</span>
              <strong>{fulfillment?.status === 'shipped' && fulfillment.shipment_status === 'partial' ? '核销已完成 · 部分发货' : fulfillmentPanelState.label}</strong>
              <small>{fulfillment?.status === 'shipped' && fulfillment.shipment_status === 'partial' ? '无需发货或转库留存份数已明确归因，实际寄出的份数少于计划应发。' : fulfillmentPanelState.description}</small>
              {fulfillmentPanelState.kind === 'error' && (
                <Button className="zto-inline-retry" size="small" icon={<ReloadOutlined />} onClick={retryFulfillmentData}>重新加载</Button>
              )}
            </div>
          </div>
          <div className="zto-reconcile-metric">
            <span>计划应发</span>
            <strong>{fulfillment?.planned_quantity?.toLocaleString() ?? '—'}</strong>
            <small>份 · 当前计划</small>
          </div>
          <div className="zto-reconcile-metric">
            <span>实际发出</span>
            <strong>{fulfillment?.actual_shipped_quantity?.toLocaleString() ?? '—'}</strong>
            <small>{fulfillment ? `有运单 ${fulfillment.tracked_quantity.toLocaleString()} + 无需运单 ${fulfillment.no_tracking_quantity.toLocaleString()}` : '份'}</small>
          </div>
          <div className="zto-reconcile-metric">
            <span>无需发货</span>
            <strong>{fulfillment?.no_shipment_quantity?.toLocaleString() ?? '—'}</strong>
            <small>{fulfillment ? `份 · 未归属 ${fulfillment.unattributed_adjustment_quantity.toLocaleString()}` : '等待数据'}</small>
          </div>
          <div className="zto-reconcile-metric">
            <span>转库留存</span>
            <strong>{fulfillment?.warehouse_stock_in_quantity?.toLocaleString() ?? '—'}</strong>
            <small>份 · 库存入库</small>
          </div>
          <div className="zto-reconcile-metric">
            <span>核销待补</span>
            <strong className={fulfillment ? (fulfillment.pending_quantity ? 'is-danger' : 'is-success') : ''}>{fulfillment?.pending_quantity?.toLocaleString() ?? '—'}</strong>
            <small>{fulfillment ? '份' : '等待数据'}</small>
          </div>
        </div>
        {!!(fulfillment?.pending_quantity || fulfillment?.unattributed_adjustment_quantity) && (
          <div className="zto-fulfillment-warning">
            <span className="zto-change-icon">!</span>
            <div>
              <strong>{fulfillment.unattributed_adjustment_quantity
                ? `有 ${fulfillment.unattributed_adjustment_quantity.toLocaleString()} 份无需发货记录待补充归属`
                : `还有 ${fulfillment.pending_quantity.toLocaleString()} 份待处理`}</strong>
              <span>{fulfillment.unattributed_adjustment_quantity
                ? '原因和份数已记录，但尚未对应到具体收件明细，因此不能用于计划对平。'
                : fulfillment.latest_import?.unresolved_quantity
                ? `${fulfillment.latest_import.unmatched_rows}个未匹配运单、${fulfillment.latest_import.unresolved_quantity.toLocaleString()}份仍可继续人工关联。`
                : '可补录运单，或对停刊、取消寄送份数登记无需发货原因。'}</span>
            </div>
            <Button size="small" onClick={() => navigate(`/logistics/issues/${issueId}/waybills/import`)}>继续处理</Button>
          </div>
        )}
      </Card>}

      {allDetailsIsError ? (
        <Card className="zto-empty-card">
          <Alert
            showIcon
            type="error"
            title={activeSection === 'plan' ? '发货计划加载失败' : '实际发货数据加载失败'}
            description={logisticsApiErrorMessage(allDetailsError, activeSection === 'plan' ? '无法读取本期发货计划' : '无法读取本期实际发货数据')}
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
                <div className="zto-empty-title">本期尚无发货计划</div>
                <div className="zto-empty-copy">请先在“发货计划”中上传计划或新增明细，再录入实际运单。</div>
              </div>
            }
          >
            {canMutate && activeSection === 'plan' && <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenCreate}>新增第一条</Button>}
          </Empty>
        </Card>
      ) : (
        <Card className="zto-list-card" styles={{ body: { padding: 0 } }}>
          <div className="zto-list-head">
            <div className="zto-list-title">
              <h2>{activeSection === 'plan' ? '发货计划明细' : '实际发货明细'}</h2>
              <span>{activeSection === 'plan' ? '只维护收件信息与应发份数，不在这里录入运单' : '以发货计划为底单，查看运单、实发与核销情况'}</span>
            </div>
            <div className="zto-list-head-actions">
              <span>
                <b>{allDetails.length.toLocaleString()}</b> 条 ·{' '}
                {activeSection === 'plan' ? '计划' : '实际寄出'} <b>{activeSection === 'plan' ? allShippingTotal.toLocaleString() : (fulfillment?.actual_shipped_quantity ?? 0).toLocaleString()}</b> 份
              </span>
              {activeSection === 'actual' && !!fulfillment?.latest_import?.unmatched_rows && (
                <Button
                  className="zto-import-exception-button"
                  onClick={() => navigate(`/logistics/issues/${issueId}/waybills/import`)}
                >
                  导入异常 {fulfillment.latest_import.unmatched_rows.toLocaleString()} 行
                </Button>
              )}
            </div>
          </div>
          {activeSection === 'actual' && <div className="zto-fulfillment-tabs">
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
          </div>}
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
            {activeSection === 'plan' && <Select
              placeholder="全部状态"
              className="zto-filter-status"
              allowClear
              value={shippingFilters.status}
              onChange={(value) => setShippingFilters((f) => ({ ...f, status: value }))}
            >
              {SHIPPING_STATUS_OPTIONS.map((st) => <Select.Option key={st} value={st}>{st}</Select.Option>)}
            </Select>}
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
                共 <b>{detailsIsError ? '—' : visibleDetails.length}</b> 条 · {activeSection === 'plan' ? '计划' : '实际寄出'} <b>{detailsIsError ? '—' : (activeSection === 'plan' ? visibleShippingTotal : visibleActualTotal).toLocaleString()}</b> 份
              </span>
            </div>
          </div>

          {activeSection === 'plan' && canMutate && selectedRowKeys.length > 0 && (
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
                  mode={activeSection}
                  canSelect={canMutate && activeSection === 'plan'}
                  onSelectedRowKeysChange={setSelectedRowKeys}
                  onOpenDetail={setDetailDrawerRecord}
                />
              ) : (
                <Empty className="zto-filter-empty" image={Empty.PRESENTED_IMAGE_SIMPLE} description={activeSection === 'plan' ? '没有符合当前条件的计划明细' : '没有符合当前条件的实际发货明细'} />
              )}
            </Spin>
          )}
        </Card>
      )}

      <Modal
        rootClassName="zto-compact-modal"
        title={`上传 / 替换发货计划 · 第 ${currentIssueNumber ?? '-'} 期`}
        open={planImportOpen}
        onCancel={closePlanImport}
        width={820}
        footer={[
          <Button key="cancel" onClick={closePlanImport} disabled={planImportPreviewing || planImportCommitting}>取消</Button>,
          <Button key="preview" onClick={handlePreviewPlanImport} loading={planImportPreviewing} disabled={!planImportFile || planImportCommitting}>预览校验</Button>,
          <Button
            key="commit"
            type="primary"
            danger={!!planImportPreview?.replaced_row_count}
            onClick={handleCommitPlanImport}
            loading={planImportCommitting}
            disabled={
              !planImportPreview?.can_commit
              || planImportReason.trim().length < 2
              || (!!planImportPreview.adjustments.length && !planImportAdjustmentsConfirmed)
            }
          >
            确认导入
          </Button>,
        ]}
      >
        <Alert
          type="info"
          showIcon
          title="只替换中通发货计划，不修改印数"
          description="支持系统中通模板和原始多工作表文件。订单生成、投诉补发以及确认时印数基准会保留。"
          style={{ marginBottom: 16 }}
        />
        <Upload.Dragger
          accept=".xlsx"
          maxCount={1}
          beforeUpload={() => false}
          showUploadList={false}
          onChange={({ fileList }) => {
            setPlanImportFile(fileList[0]?.originFileObj ?? null);
            setPlanImportPreview(null);
            setPlanImportAdjustmentsConfirmed(false);
          }}
        >
          {planImportFile ? (
            <>
              <p className="ant-upload-drag-icon"><FileExcelOutlined /></p>
              <p className="ant-upload-text">{planImportFile.name}</p>
              <p className="ant-upload-hint">点击或拖拽可重新选择文件</p>
            </>
          ) : (
            <>
              <p className="ant-upload-drag-icon"><InboxOutlined /></p>
              <p className="ant-upload-text">点击或拖拽上传发货计划明细</p>
              <p className="ant-upload-hint"><FileExcelOutlined /> 仅支持 .xlsx，上传后先预览，不会立即写入</p>
            </>
          )}
        </Upload.Dragger>

        {planImportPreview && (
          <div style={{ marginTop: 18 }}>
            {planImportPreview.errors.map((error) => (
              <Alert key={error} type="error" showIcon title={error} style={{ marginBottom: 8 }} />
            ))}
            {planImportPreview.warnings.map((warning) => (
              <Alert key={warning} type="warning" showIcon title={warning} style={{ marginBottom: 8 }} />
            ))}
            {planImportPreview.adjustments.length > 0 && (
              <Card
                size="small"
                title={`导入格式修正（${planImportPreview.adjustments.length} 条）`}
                extra={<Tag color="orange">确认导入后生效</Tag>}
                style={{ marginTop: 12 }}
              >
                <Alert
                  type="info"
                  showIcon
                  title="请逐条核对格式修正前后内容"
                  description="以下内容已用于本次预览；只有勾选确认后，才可执行导入。"
                  style={{ marginBottom: 12 }}
                />
                <Table<ShippingPlanImportAdjustment>
                  size="small"
                  rowKey={(_, index) => String(index)}
                  dataSource={planImportPreview.adjustments}
                  pagination={false}
                  scroll={{ x: 860 }}
                  columns={[
                    { title: '工作表', dataIndex: 'sheet_name', width: 120 },
                    { title: '收件人', dataIndex: 'name', width: 120 },
                    { title: '份数', dataIndex: 'quantity', width: 70, align: 'right' },
                    {
                      title: '修正前',
                      width: 210,
                      render: (_, adjustment) => (
                        <div>
                          <div>子渠道：{adjustment.original_value || '—'}</div>
                          <small>备注：{adjustment.original_notes || '—'}</small>
                        </div>
                      ),
                    },
                    { title: '具体操作', dataIndex: 'operation', width: 210 },
                    {
                      title: '修正后',
                      width: 240,
                      render: (_, adjustment) => (
                        <div>
                          <div>子渠道：{adjustment.resulting_value || '（清空）'}</div>
                          <small>备注：{adjustment.resulting_notes || '—'}</small>
                        </div>
                      ),
                    },
                  ]}
                />
                <Checkbox
                  checked={planImportAdjustmentsConfirmed}
                  onChange={(event) => setPlanImportAdjustmentsConfirmed(event.target.checked)}
                  style={{ marginTop: 12 }}
                >
                  我已逐条核对以上 {planImportPreview.adjustments.length} 条导入格式修正
                </Checkbox>
              </Card>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, margin: '14px 0' }}>
              <Card size="small"><div>文件明细</div><strong>{planImportPreview.imported_row_count} 条 · {planImportPreview.imported_quantity.toLocaleString()} 份</strong></Card>
              <Card size="small"><div>将替换</div><strong>{planImportPreview.replaced_row_count} 条 · {planImportPreview.replaced_quantity.toLocaleString()} 份</strong></Card>
              <Card size="small"><div>保留</div><strong>{planImportPreview.preserved_row_count} 条 · {planImportPreview.preserved_quantity.toLocaleString()} 份</strong></Card>
              <Card size="small"><div>导入后计划</div><strong>{planImportPreview.resulting_row_count} 条 · {planImportPreview.resulting_quantity.toLocaleString()} 份</strong></Card>
            </div>
            {planImportPreview.sample_rows.length > 0 && (
              <Table
                size="small"
                rowKey={(_, index) => String(index)}
                dataSource={planImportPreview.sample_rows}
                pagination={false}
                title={() => `抽样预览（前 ${planImportPreview.sample_rows.length} 条）`}
                columns={[
                  { title: '工作表', dataIndex: 'sheet_name', width: 130 },
                  { title: '渠道', dataIndex: 'channel', width: 110 },
                  { title: '姓名', dataIndex: 'name', width: 110 },
                  { title: '地址', dataIndex: 'address', ellipsis: true },
                  { title: '份数', dataIndex: 'quantity', width: 70, align: 'right' },
                ]}
              />
            )}
            <Input.TextArea
              value={planImportReason}
              onChange={(event) => setPlanImportReason(event.target.value)}
              placeholder="请填写本次上传或替换计划的原因"
              maxLength={255}
              rows={2}
              style={{ marginTop: 14 }}
            />
          </div>
        )}
      </Modal>

      <Modal
        rootClassName="zto-compact-modal"
        title={`调整实际收件信息${actualRecipientRecord ? ` · ${actualRecipientRecord.name}` : ''}`}
        open={!!actualRecipientRecord}
        okText="保存实际信息"
        confirmLoading={actualRecipientSaving}
        onOk={handleSaveActualRecipient}
        onCancel={() => { setActualRecipientRecord(null); actualRecipientForm.resetFields(); }}
      >
        <Alert
          showIcon
          type="info"
          title="这里只调整本次实际发货信息"
          description="发货计划中的原收件人、电话和地址会完整保留，不会被反向修改。"
        />
        <Form form={actualRecipientForm} layout="vertical" className="zto-actual-recipient-form">
          <Form.Item name="name" label="实际收件人" rules={[{ required: true, message: '请输入实际收件人' }]}>
            <Input placeholder="请输入实际收件人" />
          </Form.Item>
          <Form.Item name="phone" label="实际电话">
            <Input placeholder="请输入实际联系电话" />
          </Form.Item>
          <Form.Item name="address" label="实际地址">
            <Input.TextArea placeholder="请输入实际收件地址" rows={2} />
          </Form.Item>
          <Form.Item name="reason" label="调整原因" rules={[{ required: true, min: 2, message: '请填写调整原因' }]}>
            <Input.TextArea placeholder="例如：收件人临时要求改寄新地址" rows={2} maxLength={255} showCount />
          </Form.Item>
        </Form>
        {actualRecipientRecord?.actual_name && (
          <Button type="link" danger loading={actualRecipientSaving} onClick={handleResetActualRecipient}>恢复沿用计划收件信息</Button>
        )}
      </Modal>

      <Modal
        rootClassName="zto-compact-modal"
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
        rootClassName="zto-compact-modal"
        title={editingRecord ? '编辑计划明细' : '新增计划明细'}
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
                const subChannel = form.getFieldValue('sub_channel');
                if (subChannel && !(SUB_CHANNEL_OPTIONS_BY_CHANNEL[value] ?? []).includes(subChannel)) {
                  form.setFieldValue('sub_channel', null);
                }
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
              const subChannelOptions = SUB_CHANNEL_OPTIONS_BY_CHANNEL[channel];
              if (subChannelOptions) {
                return (
                <Form.Item label="子渠道" name="sub_channel">
                  <Select placeholder="请选择子渠道" allowClear>
                    {subChannelOptions.map((sc) => <Select.Option key={sc} value={sc}>{sc}</Select.Option>)}
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
        rootClassName="zto-compact-modal"
        title="确认后变更与差异归因"
        open={changeLogOpen}
        onCancel={() => setChangeLogOpen(false)}
        footer={null}
        width={720}
      >
        {(() => {
          const changed = allDetails.filter((d) => d.sync_status !== 'synced');
          const adjustments = fulfillment?.adjustments ?? [];
          return <div className="zto-change-modal-sections">
            <section>
              <h3>非运单核销归因</h3>
              {adjustments.length ? <Table
                size="small"
                rowKey="id"
                dataSource={adjustments}
                pagination={false}
                columns={[
                  { title: '收件人', dataIndex: 'detail_name_snapshot', render: (value: string | null) => value || <Tag color="orange">待补充归属</Tag> },
                  { title: '渠道', dataIndex: 'detail_channel_snapshot', render: (value: string | null) => value || '—' },
                  { title: '核销类型', dataIndex: 'adjustment_type', render: (value: string) => value === 'warehouse_stock_in' ? <Tag color="cyan">转库留存/库存入库</Tag> : <Tag color="green">无需发货</Tag> },
                  { title: '原因', dataIndex: 'reason' },
                  { title: '份数', dataIndex: 'quantity', width: 70, align: 'right' },
                  { title: '状态', key: 'state', width: 110, render: (_: unknown, item) => item.is_attributed
                    ? <Tag color="green">已归因</Tag>
                    : <Button type="link" size="small" onClick={() => navigate(`/logistics/issues/${issueId}/waybills/import`)}>补充归属</Button> },
                ]}
              /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无非运单核销记录" />}
            </section>
            <section>
              <h3>人工修改 / 孤立明细</h3>
              {changed.length ? <Table
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
              /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本期无人工修改 / 孤立明细" />}
            </section>
          </div>;
        })()}
      </Modal>

      <Drawer
        title={detailDrawerRecord ? (
          <DrawerTitle
            icon="🚚"
            title={(activeSection === 'actual' ? detailDrawerRecord.actual_name : detailDrawerRecord.name) || detailDrawerRecord.name || (activeSection === 'plan' ? '计划明细' : '实际发货明细')}
            description={`${detailDrawerRecord.channel || '未分类'} · ${activeSection === 'plan' ? '发货计划' : '实际发货'} #${detailDrawerRecord.id}`}
            tone={activeSection === 'plan' ? 'neutral' : detailDrawerRecord.fulfillment_status === 'partial' ? 'warning' : detailDrawerRecord.fulfillment_status === 'pending' ? 'neutral' : 'success'}
            status={(
              <StatusPill tone={activeSection === 'plan' ? (detailDrawerRecord.status === '停发' ? 'warning' : 'success') : detailDrawerRecord.fulfillment_status === 'partial' ? 'warning' : detailDrawerRecord.fulfillment_status === 'pending' ? 'neutral' : 'success'}>
                {activeSection === 'plan' ? detailDrawerRecord.status : (fulfillmentMeta[detailDrawerRecord.fulfillment_status] || fulfillmentMeta.pending).label}
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
            {activeSection === 'actual' && canMutate && (
              <Button onClick={() => handleOpenActualRecipient(detailDrawerRecord)}>调整实发信息</Button>
            )}
            {activeSection === 'actual' && canMutate && detailDrawerRecord.shipping_requirement !== 'no_tracking_required' && detailDrawerRecord.handled_quantity < detailDrawerRecord.quantity && (
              <Button onClick={() => handleOpenPackage(detailDrawerRecord)}>补录运单</Button>
            )}
            {canMutate && (activeSection === 'plan' || detailDrawerRecord.shipping_requirement === 'no_tracking_required' || !detailDrawerRecord.package_count) && (
              <Popover
                trigger="click"
                placement="topRight"
                open={actionMenuRecordId === detailDrawerRecord.id}
                onOpenChange={(open) => setActionMenuRecordId(open ? detailDrawerRecord.id : null)}
                content={(
                  <div className="zto-action-menu">
                    {activeSection === 'actual' && (detailDrawerRecord.shipping_requirement === 'no_tracking_required' ? (
                      <Button type="text" onClick={() => handleNoTracking(detailDrawerRecord, false)}>恢复需要运单</Button>
                    ) : !detailDrawerRecord.package_count ? (
                      <Button type="text" onClick={() => handleNoTracking(detailDrawerRecord, true)}>标记无需运单</Button>
                    ) : null)}
                    {activeSection === 'plan' && (detailDrawerRecord.source_type !== 'complaint_makeup' ? (
                      <Popconfirm title="确认删除？" onConfirm={() => handleDelete(detailDrawerRecord.id)}>
                        <Button type="text" danger icon={<DeleteOutlined />}>删除计划明细</Button>
                      </Popconfirm>
                    ) : <Button type="text" disabled>请在邮局工单取消</Button>)}
                  </div>
                )}
              >
                <Button icon={<MoreOutlined />}>更多</Button>
              </Popover>
            )}
            {activeSection === 'plan' && canMutate && <Button type="primary" onClick={() => handleEdit(detailDrawerRecord)}>编辑计划</Button>}
          </div>
        ) : null}
      >
        {detailDrawerRecord && (
          <div className="zto-detail-drawer">
            {activeSection === 'actual' && <div className="zto-detail-metrics">
              <div><span>应发</span><strong>{detailDrawerRecord.quantity.toLocaleString()}</strong></div>
              <div><span>实际发出</span><strong>{detailDrawerRecord.physical_shipped_quantity.toLocaleString()}</strong></div>
              <div><span>待发</span><strong>{Math.max(detailDrawerRecord.quantity - detailDrawerRecord.handled_quantity, 0).toLocaleString()}</strong></div>
            </div>}

            <section className="zto-detail-section">
              <h3>{activeSection === 'actual' ? '计划收件信息' : '收件与计划信息'}</h3>
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

            {activeSection === 'actual' && <section className="zto-detail-section">
              <h3>实际收件信息</h3>
              <div className="zto-detail-facts">
                <div><span>实际收件人</span><strong>{detailDrawerRecord.actual_name || detailDrawerRecord.name || '—'}</strong></div>
                <div><span>实际电话</span><strong>{detailDrawerRecord.actual_phone || detailDrawerRecord.phone || '—'}</strong></div>
                <div className="is-wide"><span>实际地址</span><strong>{detailDrawerRecord.actual_address || detailDrawerRecord.address || '—'}</strong></div>
                <div><span>信息来源</span><strong>{detailDrawerRecord.actual_name ? <Tag color="orange">实际发货已调整</Tag> : <Tag color="blue">沿用发货计划</Tag>}</strong></div>
                {detailDrawerRecord.actual_adjustment_reason && <div><span>调整原因</span><strong>{detailDrawerRecord.actual_adjustment_reason}</strong></div>}
              </div>
            </section>}

            {activeSection === 'actual' && <section className="zto-detail-section">
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
                  {!!detailDrawerRecord.no_shipment_quantity && (
                    <Alert
                      showIcon
                      type="success"
                      title={`${detailDrawerRecord.no_shipment_quantity.toLocaleString()} 份无需发货`}
                      description={detailDrawerRecord.no_shipment_reason || '已登记无需发货原因'}
                    />
                  )}
                  {!!detailDrawerRecord.warehouse_stock_in_quantity && (
                    <Alert
                      showIcon
                      type="success"
                      title={`${detailDrawerRecord.warehouse_stock_in_quantity.toLocaleString()} 份转库留存/库存入库`}
                      description={detailDrawerRecord.warehouse_stock_in_reason || '已登记进入马飞中通库房备货'}
                    />
                  )}
                </div>
              ) : detailDrawerRecord.fulfillment_status === 'warehouse_stock_in' ? (
                <Alert showIcon type="success" title="转库留存/库存入库，已完成核销" description={detailDrawerRecord.warehouse_stock_in_reason || '已登记进入马飞中通库房备货'} />
              ) : detailDrawerRecord.fulfillment_status === 'no_shipment_required' ? (
                <Alert showIcon type="success" title="无需发货，已完成核销" description={detailDrawerRecord.no_shipment_reason || '已登记无需发货原因'} />
              ) : detailDrawerRecord.shipping_requirement === 'no_tracking_required' ? (
                <Alert showIcon type="success" title="无需运单，系统已按计划份数完成核销" />
              ) : (
                <Alert showIcon type="warning" title="尚未录入运单，本条仍待发货" />
              )}
            </section>}

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
                {activeSection === 'actual' && <div><span>发货时间</span><strong>{detailDrawerRecord.shipped_at ? dayjs(detailDrawerRecord.shipped_at).format('YYYY-MM-DD') : '—'}</strong></div>}
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
            title="本期操作记录"
            description={`第 ${currentIssueNumber ?? '-'} 期 · 计划与实际发货的全部操作`}
            status={<StatusPill tone="neutral">{issueLogsLoading ? '加载中' : `${issueOperationLogs.length} 条记录`}</StatusPill>}
          />
        )}
        open={issueLogDrawerOpen}
        onClose={() => setIssueLogDrawerOpen(false)}
        size={520}
        rootClassName="app-drawer-root"
      >
        <div className="app-drawer-panel">
          {issueLogsLoading ? (
            <div className="zto-log-empty">加载中...</div>
          ) : issueOperationLogs.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本期暂无操作记录" />
          ) : (
            <Timeline
              items={issueOperationLogs.map((log) => ({
                color: log.status === 'failed' ? 'red' : 'blue',
                children: (
                  <div className="zto-issue-log-item">
                    <div>
                      <strong>{log.action_label}</strong>
                      <Tag color={log.status === 'failed' ? 'red' : 'green'}>{log.status === 'failed' ? '失败' : '成功'}</Tag>
                    </div>
                    <span>{log.username || '系统'} · {dayjs(log.created_at).format('YYYY-MM-DD HH:mm:ss')}</span>
                    {log.record_name && <small>{log.record_name}</small>}
                  </div>
                ),
              }))}
            />
          )}
        </div>
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
