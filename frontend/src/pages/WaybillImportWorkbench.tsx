import { useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Spin,
  Table,
  Tag,
  message,
} from 'antd';
import type { TableColumnsType } from 'antd';
import {
  CheckCircleOutlined,
  EditOutlined,
  FileExcelOutlined,
  LeftOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  StopOutlined,
  SwapOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { getIssue } from '../api/issues';
import { getReport } from '../api/reports';
import { getShippingDetails } from '../api/shippingDetails';
import type { ShippingDetail } from '../api/shippingDetails';
import {
  addWaybillImportRow,
  addFulfillmentAdjustment,
  addShippingDeferrals,
  addConsolidatedPackage,
  attributeFulfillmentAdjustment,
  bulkMatchWaybillImportRows,
  confirmWaybillImport,
  getFulfillmentSummary,
  getPendingShippingDeferrals,
  getWaybillImportDraft,
  previewWaybillImport,
  updateWaybillImportRow,
  transferShippingPlanQuantity,
} from '../api/shippingWaybills';
import type {
  WaybillImportBatch,
  FulfillmentAdjustment,
  ShippingGapDetail,
  WaybillImportRow,
  WaybillImportRowInput,
} from '../api/shippingWaybills';
import { logisticsApiErrorMessage } from './logisticsIssueState';
import {
  buildWaybillGroupSuggestions,
  filterWaybillRows,
  isRecoverableWaybillDraft,
  isSupportedWaybillFilename,
  recommendedMonthEndGapIds,
} from './waybillImportUtils';
import type { RowFilter } from './waybillImportUtils';

const statusMeta: Record<WaybillImportRow['match_status'], { label: string; color: string }> = {
  matched: { label: '已匹配', color: 'green' },
  unmatched: { label: '待人工匹配', color: 'orange' },
  ambiguous: { label: '匹配不唯一', color: 'gold' },
  duplicate: { label: '重复运单', color: 'red' },
  invalid: { label: '未识别 / 无效', color: 'volcano' },
  ignored: { label: '已忽略', color: 'default' },
};

const suspendedConsolidatedShippingReason = '每月两次合寄 · 暂停寄送';
const monthEndConsolidationReason = '月底合寄 · 本期报纸随月底最后一期统一寄送';

function adjustmentReasonLabel(reason: string): string {
  return reason === '双周停刊' ? suspendedConsolidatedShippingReason : reason;
}

interface RowFormValues {
  carrier: string;
  tracking_no?: string;
  recipient_name: string;
  phone?: string;
  address?: string;
  quantity: number;
  no_tracking_required: boolean;
  shipping_detail_id?: number;
}

function detailLabel(detail: ShippingDetail): string {
  const contact = [detail.phone, detail.address].filter(Boolean).join(' · ');
  return `${detail.name} · ${detail.quantity}份${contact ? ` · ${contact}` : ''}`;
}

export default function WaybillImportWorkbench() {
  const { id } = useParams<{ id: string }>();
  const issueId = Number(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const forceReparseRef = useRef(false);
  const dragDepthRef = useRef(0);
  const [batchOverride, setBatch] = useState<WaybillImportBatch | null | undefined>(undefined);
  const [filter, setFilter] = useState<RowFilter>('unresolved');
  const [parsing, setParsing] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [editingRow, setEditingRow] = useState<WaybillImportRow | null>(null);
  const [addingRow, setAddingRow] = useState(false);
  const [savingRow, setSavingRow] = useState(false);
  const [bulkMatching, setBulkMatching] = useState(false);
  const [ignoreRow, setIgnoreRow] = useState<WaybillImportRow | null>(null);
  const [ignoreReason, setIgnoreReason] = useState('');
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const [adjustmentReason, setAdjustmentReason] = useState(suspendedConsolidatedShippingReason);
  const [adjustmentDetailId, setAdjustmentDetailId] = useState<number | undefined>();
  const [attributionAdjustment, setAttributionAdjustment] = useState<FulfillmentAdjustment | null>(null);
  const [savingAdjustment, setSavingAdjustment] = useState(false);
  const [selectedGapIds, setSelectedGapIds] = useState<number[]>([]);
  const [savingDeferral, setSavingDeferral] = useState(false);
  const [planTransferGap, setPlanTransferGap] = useState<ShippingGapDetail | null>(null);
  const [transferTargetId, setTransferTargetId] = useState<number | undefined>();
  const [creatingTransferTarget, setCreatingTransferTarget] = useState(false);
  const [transferName, setTransferName] = useState('');
  const [transferPhone, setTransferPhone] = useState('');
  const [transferAddress, setTransferAddress] = useState('');
  const [transferReason, setTransferReason] = useState('计划份数归属纠错');
  const [savingTransfer, setSavingTransfer] = useState(false);
  const [consolidatedOpen, setConsolidatedOpen] = useState(false);
  const [selectedDeferralIds, setSelectedDeferralIds] = useState<number[]>([]);
  const [consolidatedCarrier, setConsolidatedCarrier] = useState('中通');
  const [consolidatedTracking, setConsolidatedTracking] = useState('');
  const [savingConsolidated, setSavingConsolidated] = useState(false);
  const [rowForm] = Form.useForm<RowFormValues>();

  const issueQuery = useQuery({
    queryKey: ['issue', issueId],
    queryFn: async () => (await getIssue(issueId)).data,
    enabled: Number.isFinite(issueId),
  });
  const draftQuery = useQuery({
    queryKey: ['waybillImportDraft', issueId],
    queryFn: async () => (await getWaybillImportDraft(issueId)).data,
    enabled: Number.isFinite(issueId),
    retry: false,
  });
  const reportQuery = useQuery({
    queryKey: ['report', issueId],
    queryFn: async () => (await getReport(issueId)).data,
    enabled: Number.isFinite(issueId),
  });
  const fulfillmentQuery = useQuery({
    queryKey: ['shippingFulfillment', issueId],
    queryFn: async () => (await getFulfillmentSummary(issueId)).data,
    enabled: Number.isFinite(issueId),
  });
  const detailsQuery = useQuery({
    queryKey: ['shippingDetailsAll', issueQuery.data?.issue_number, 'waybill-workbench'],
    queryFn: async () => (await getShippingDetails({ issue_number: issueQuery.data!.issue_number, limit: 5000 })).data,
    enabled: issueQuery.data?.issue_number != null,
  });
  const pendingDeferralsQuery = useQuery({
    queryKey: ['shippingDeferrals', 'pending'],
    queryFn: async () => (await getPendingShippingDeferrals()).data,
  });

  const batch = batchOverride === undefined ? draftQuery.data ?? null : batchOverride;
  const details = useMemo(() => detailsQuery.data ?? [], [detailsQuery.data]);
  const detailsById = useMemo(() => new Map(details.map((detail) => [detail.id, detail])), [details]);
  const visibleRows = useMemo(() => filterWaybillRows(batch?.rows ?? [], filter), [batch, filter]);
  const groupSuggestions = useMemo(
    () => buildWaybillGroupSuggestions(batch?.rows ?? [], details),
    [batch, details],
  );
  const detailsPlanQuantity = useMemo(
    () => details.filter((detail) => detail.source_type !== 'complaint_makeup')
      .reduce((sum, detail) => sum + detail.quantity, 0),
    [details],
  );
  const confirmedPlanQuantity = reportQuery.data?.confirmation_summary?.confirmed_shipping_total ?? null;
  const currentPlanQuantity = reportQuery.data?.confirmation_summary?.current_shipping_total ?? detailsPlanQuantity;
  const confirmationSummary = reportQuery.data?.confirmation_summary;
  const planDelta = confirmedPlanQuantity == null ? null : currentPlanQuantity - confirmedPlanQuantity;
  const planAttributedQuantity = confirmationSummary?.plan_attributed_quantity ?? 0;
  const planUnexplainedDelta = confirmationSummary?.plan_unexplained_delta ?? planDelta;
  const planReconciled = confirmationSummary?.plan_is_reconciled ?? planDelta === 0;
  const adjustmentQuantity = fulfillmentQuery.data?.adjustment_quantity ?? 0;
  const deferredQuantity = fulfillmentQuery.data?.deferred_quantity ?? 0;
  const fileGapQuantity = batch?.file_gap_quantity ?? Math.max((batch?.expected_quantity ?? 0) - (batch?.parsed_quantity ?? 0), 0);
  const remainingFileGap = Math.max(fileGapQuantity - adjustmentQuantity, 0);
  const displayedHandledQuantity = (batch?.matched_quantity ?? 0) + adjustmentQuantity;
  const displayedPendingQuantity = Math.max((batch?.expected_quantity ?? 0) - displayedHandledQuantity, 0);
  const currentPendingQuantity = batch?.status === 'previewed'
    ? displayedPendingQuantity
    : fulfillmentQuery.data?.pending_quantity ?? displayedPendingQuantity;
  const unexplainedPendingQuantity = batch?.status === 'previewed'
    ? Math.max(displayedPendingQuantity - deferredQuantity, 0)
    : fulfillmentQuery.data?.unexplained_pending_quantity
      ?? Math.max(displayedPendingQuantity - deferredQuantity, 0);
  const gapDetails = fulfillmentQuery.data?.gap_details ?? [];
  const adjustmentSelectedQuantity = gapDetails.find(
    (item) => item.shipping_detail_id === adjustmentDetailId,
  )?.remaining_quantity ?? 0;
  const unassignedAdjustments = fulfillmentQuery.data?.adjustments.filter((item) => !item.is_attributed) ?? [];

  const suggestedAdjustmentDetail = useMemo(() => {
    if (!remainingFileGap) return undefined;
    const candidates = details.filter((detail) => (
      detail.source_type !== 'complaint_makeup'
      && Math.max(detail.quantity - detail.handled_quantity, 0) === remainingFileGap
    ));
    return candidates.length === 1 ? candidates[0] : undefined;
  }, [details, remainingFileGap]);

  const openFilePicker = (forceReparse: boolean) => {
    forceReparseRef.current = forceReparse;
    fileInputRef.current?.click();
  };

  const handleFile = async (file: File) => {
    const wasForceReparse = forceReparseRef.current;
    const previousBatchId = batch?.id;
    setParsing(true);
    try {
      const response = await previewWaybillImport(issueId, file, forceReparseRef.current);
      setBatch(response.data);
      setFilter(response.data.unmatched_rows > 0 ? 'unresolved' : response.data.file_gap_quantity > 0 ? 'gap' : 'all');
      queryClient.setQueryData(['waybillImportDraft', issueId], response.data);
      await queryClient.invalidateQueries({ queryKey: ['shippingFulfillment', issueId] });
      message.success(response.data.status === 'confirmed' ? '该文件已经确认导入，未重复创建运单' : '运单文件已解析，草稿会自动保留');
    } catch (error) {
      if (!(error as { response?: unknown })?.response) {
        try {
          const recovered = (await getWaybillImportDraft(issueId)).data;
          if (isRecoverableWaybillDraft(recovered, file.name, previousBatchId, wasForceReparse)) {
            setBatch(recovered);
            setFilter(recovered.unmatched_rows > 0 ? 'unresolved' : recovered.file_gap_quantity > 0 ? 'gap' : 'all');
            queryClient.setQueryData(['waybillImportDraft', issueId], recovered);
            message.warning('上传响应中断，但后台已完成解析，已自动恢复最新草稿');
            return;
          }
        } catch {
          // Fall through to the original upload error when the recovery request also fails.
        }
      }
      message.error(logisticsApiErrorMessage(error, '运单文件解析失败'));
    } finally {
      setParsing(false);
      forceReparseRef.current = false;
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const acceptFile = (file: File, forceReparse = false) => {
    if (!isSupportedWaybillFilename(file.name)) {
      message.error('仅支持 .xlsx / .xlsm 格式的运单文件');
      return;
    }
    forceReparseRef.current = forceReparse;
    void handleFile(file);
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    if (!parsing) setIsDraggingFile(true);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = parsing ? 'none' : 'copy';
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingFile(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setIsDraggingFile(false);
    if (parsing) return;
    const file = event.dataTransfer.files[0];
    if (file) acceptFile(file);
  };

  const openEdit = (row: WaybillImportRow) => {
    setEditingRow(row);
    setAddingRow(false);
    rowForm.setFieldsValue({
      carrier: row.carrier,
      tracking_no: row.tracking_no ?? undefined,
      recipient_name: row.recipient_name,
      phone: row.phone ?? undefined,
      address: row.address ?? undefined,
      quantity: row.quantity,
      no_tracking_required: row.no_tracking_required,
      shipping_detail_id: row.shipping_detail_id ?? undefined,
    });
  };

  const openAdd = () => {
    setEditingRow(null);
    setAddingRow(true);
    rowForm.resetFields();
    rowForm.setFieldsValue({ carrier: '中通', quantity: 1, no_tracking_required: false });
  };

  const closeEditor = () => {
    setEditingRow(null);
    setAddingRow(false);
    rowForm.resetFields();
  };

  const saveRow = async () => {
    if (!batch) return;
    const values = await rowForm.validateFields();
    const payload: WaybillImportRowInput = {
      ...values,
      tracking_no: values.no_tracking_required ? null : values.tracking_no || null,
      phone: values.phone || null,
      address: values.address || null,
      shipping_detail_id: values.shipping_detail_id ?? null,
      ignored: false,
    };
    setSavingRow(true);
    try {
      const response = editingRow
        ? await updateWaybillImportRow(batch.id, editingRow.id, payload)
        : await addWaybillImportRow(batch.id, payload);
      setBatch(response.data);
      queryClient.setQueryData(['waybillImportDraft', issueId], response.data);
      if (response.data.status === 'confirmed') {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['shippingDetails'] }),
          queryClient.invalidateQueries({ queryKey: ['shippingDetailsAll'] }),
          queryClient.invalidateQueries({ queryKey: ['shippingFulfillment', issueId] }),
        ]);
      }
      closeEditor();
      message.success(editingRow ? '本行修改已自动保存' : '已补充一行并重新核对');
    } catch (error) {
      message.error(logisticsApiErrorMessage(error, '保存失败'));
    } finally {
      setSavingRow(false);
    }
  };

  const toggleIgnored = async (row: WaybillImportRow) => {
    if (!batch) return;
    if (row.match_status !== 'ignored') {
      setIgnoreRow(row);
      setIgnoreReason('');
      return;
    }
    try {
      const response = await updateWaybillImportRow(batch.id, row.id, {
        ignored: false,
        shipping_detail_id: row.shipping_detail_id,
      });
      setBatch(response.data);
      queryClient.setQueryData(['waybillImportDraft', issueId], response.data);
      message.success('已恢复并重新匹配');
    } catch (error) {
      message.error(logisticsApiErrorMessage(error, '操作失败'));
    }
  };

  const confirmIgnore = async () => {
    if (!batch || !ignoreRow || !ignoreReason.trim()) return;
    setSavingRow(true);
    try {
      const response = await updateWaybillImportRow(batch.id, ignoreRow.id, {
        ignored: true,
        ignore_reason: ignoreReason.trim(),
        shipping_detail_id: null,
      });
      setBatch(response.data);
      queryClient.setQueryData(['waybillImportDraft', issueId], response.data);
      setIgnoreRow(null);
      setIgnoreReason('');
      message.success('已记录忽略原因，该行仍保留在“已忽略”中');
    } catch (error) {
      message.error(logisticsApiErrorMessage(error, '忽略失败'));
    } finally {
      setSavingRow(false);
    }
  };

  const handleBulkMatch = async (rowIds: number[], shippingDetailId: number) => {
    if (!batch) return;
    setBulkMatching(true);
    try {
      const response = await bulkMatchWaybillImportRows(batch.id, rowIds, shippingDetailId);
      setBatch(response.data);
      queryClient.setQueryData(['waybillImportDraft', issueId], response.data);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['shippingDetails'] }),
        queryClient.invalidateQueries({ queryKey: ['shippingDetailsAll'] }),
        queryClient.invalidateQueries({ queryKey: ['shippingFulfillment', issueId] }),
      ]);
      message.success(`已关联 ${rowIds.length} 个运单`);
    } catch (error) {
      message.error(logisticsApiErrorMessage(error, '批量关联失败'));
    } finally {
      setBulkMatching(false);
    }
  };

  const handleCreateDeferrals = async () => {
    const selected = gapDetails.filter((item) => (
      selectedGapIds.includes(item.shipping_detail_id) && item.remaining_quantity > 0
    ));
    if (!selected.length) return;
    setSavingDeferral(true);
    try {
      const response = await addShippingDeferrals(
        issueId,
        selected.map((item) => ({
          shipping_detail_id: item.shipping_detail_id,
          quantity: item.remaining_quantity,
        })),
        monthEndConsolidationReason,
      );
      queryClient.setQueryData(['shippingFulfillment', issueId], response.data);
      setSelectedGapIds([]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['shippingDetails'] }),
        queryClient.invalidateQueries({ queryKey: ['shippingDetailsAll'] }),
        queryClient.invalidateQueries({ queryKey: ['shippingDeferrals', 'pending'] }),
      ]);
      message.success(`已登记 ${selected.reduce((sum, item) => sum + item.remaining_quantity, 0)} 份待月底合寄`);
    } catch (error) {
      message.error(logisticsApiErrorMessage(error, '登记月底合寄失败'));
    } finally {
      setSavingDeferral(false);
    }
  };

  const handlePlanTransfer = async () => {
    if (!planTransferGap || !transferReason.trim()) return;
    if (creatingTransferTarget && !transferName.trim()) return;
    if (!creatingTransferTarget && !transferTargetId) return;
    setSavingTransfer(true);
    try {
      await transferShippingPlanQuantity(issueId, {
        source_detail_id: planTransferGap.shipping_detail_id,
        quantity: planTransferGap.remaining_quantity,
        reason: transferReason.trim(),
        ...(creatingTransferTarget ? {
          target_name: transferName.trim(),
          target_phone: transferPhone.trim() || undefined,
          target_address: transferAddress.trim() || undefined,
          target_channel: '个人订阅',
          target_sheet_name: '月底-整月',
          target_frequency: '月',
        } : { target_detail_id: transferTargetId }),
      });
      setPlanTransferGap(null);
      setTransferTargetId(undefined);
      setTransferName('');
      setTransferPhone('');
      setTransferAddress('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['report', issueId] }),
        queryClient.invalidateQueries({ queryKey: ['shippingDetails'] }),
        queryClient.invalidateQueries({ queryKey: ['shippingDetailsAll'] }),
        queryClient.invalidateQueries({ queryKey: ['shippingFulfillment', issueId] }),
      ]);
      message.success('计划份数已完成净额转移，总计划保持不变');
    } catch (error) {
      message.error(logisticsApiErrorMessage(error, '计划纠错失败'));
    } finally {
      setSavingTransfer(false);
    }
  };

  const handleConsolidatedPackage = async () => {
    if (!selectedDeferralIds.length || !consolidatedTracking.trim()) return;
    setSavingConsolidated(true);
    try {
      const response = await addConsolidatedPackage(
        consolidatedCarrier,
        consolidatedTracking.trim(),
        selectedDeferralIds,
      );
      setConsolidatedOpen(false);
      setSelectedDeferralIds([]);
      setConsolidatedTracking('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['shippingDeferrals', 'pending'] }),
        queryClient.invalidateQueries({ queryKey: ['shippingFulfillment'] }),
        queryClient.invalidateQueries({ queryKey: ['shippingDetails'] }),
        queryClient.invalidateQueries({ queryKey: ['shippingDetailsAll'] }),
      ]);
      message.success(`月底合寄运单已核销 ${response.data.quantity} 份`);
    } catch (error) {
      message.error(logisticsApiErrorMessage(error, '月底合寄核销失败'));
    } finally {
      setSavingConsolidated(false);
    }
  };

  const handleAdjustment = async () => {
    if (!adjustmentSelectedQuantity || !adjustmentReason.trim() || !adjustmentDetailId) return;
    setSavingAdjustment(true);
    try {
      const response = await addFulfillmentAdjustment(
        issueId,
        adjustmentSelectedQuantity,
        adjustmentReason.trim(),
        adjustmentDetailId,
      );
      queryClient.setQueryData(['shippingFulfillment', issueId], response.data);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['report', issueId] }),
        queryClient.invalidateQueries({ queryKey: ['shippingDetails'] }),
        queryClient.invalidateQueries({ queryKey: ['shippingDetailsAll'] }),
      ]);
      setAdjustmentOpen(false);
      message.success(`已将 ${adjustmentSelectedQuantity} 份标记为无需发货`);
    } catch (error) {
      message.error(logisticsApiErrorMessage(error, '标记无需发货失败'));
    } finally {
      setSavingAdjustment(false);
    }
  };

  const handleAttribution = async () => {
    if (!attributionAdjustment || !adjustmentDetailId) return;
    setSavingAdjustment(true);
    try {
      const response = await attributeFulfillmentAdjustment(attributionAdjustment.id, adjustmentDetailId);
      queryClient.setQueryData(['shippingFulfillment', issueId], response.data);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['report', issueId] }),
        queryClient.invalidateQueries({ queryKey: ['shippingDetails'] }),
        queryClient.invalidateQueries({ queryKey: ['shippingDetailsAll'] }),
      ]);
      setAttributionAdjustment(null);
      setAdjustmentDetailId(undefined);
      message.success('已补充无需发货记录的明细归属');
    } catch (error) {
      message.error(logisticsApiErrorMessage(error, '补充归属失败'));
    } finally {
      setSavingAdjustment(false);
    }
  };

  const handleConfirm = async () => {
    if (!batch) return;
    setConfirming(true);
    try {
      const response = await confirmWaybillImport(batch.id);
      setBatch(response.data);
      queryClient.setQueryData(['waybillImportDraft', issueId], response.data.unmatched_rows > 0 ? response.data : null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['shippingDetails'] }),
        queryClient.invalidateQueries({ queryKey: ['shippingDetailsAll'] }),
        queryClient.invalidateQueries({ queryKey: ['shippingFulfillment', issueId] }),
      ]);
      message.success(`已核销 ${response.data.matched_quantity.toLocaleString()} 份，保留 ${response.data.pending_quantity.toLocaleString()} 份待处理`);
    } catch (error) {
      message.error(logisticsApiErrorMessage(error, '确认导入失败'));
    } finally {
      setConfirming(false);
    }
  };

  const alternativesFor = (row: WaybillImportRow): ShippingDetail[] => {
    const name = row.recipient_name.trim();
    const phone = (row.phone ?? '').replace(/\D/g, '');
    return details
      .filter((detail) => detail.id !== row.shipping_detail_id)
      .map((detail) => ({
        detail,
        score: Number(detail.name === name) * 3
          + Number(Boolean(phone) && (detail.phone ?? '').replace(/\D/g, '') === phone) * 2
          + Number(Boolean(row.address) && detail.address === row.address),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.detail.quantity - a.detail.quantity)
      .slice(0, 5)
      .map((item) => item.detail);
  };

  const columns: TableColumnsType<WaybillImportRow> = [
    {
      title: '来源行', key: 'source', width: 170,
      render: (_, row) => <div className="waybill-source"><b>{row.source_sheet}</b><span>第 {row.source_row} 行</span></div>,
    },
    {
      title: '收件信息', key: 'recipient', width: 240,
      render: (_, row) => <div className="waybill-recipient"><b>{row.recipient_name || '未识别收件人'}</b><span>{row.phone || '无电话'} · {row.address || '无地址'}</span></div>,
    },
    {
      title: '承运 / 运单', key: 'tracking', width: 180,
      render: (_, row) => row.no_tracking_required
        ? <Tag color="blue">无需运单</Tag>
        : <div className="waybill-tracking"><b>{row.carrier || '—'}</b><span>{row.tracking_no || '缺少运单号'}</span></div>,
    },
    { title: '份数', dataIndex: 'quantity', width: 64, align: 'right' },
    {
      title: '核对结果', key: 'status', width: 170,
      render: (_, row) => <div className="waybill-status-cell">
        <Tag color={statusMeta[row.match_status].color}>{statusMeta[row.match_status].label}</Tag>
        <span>{row.match_reason || (row.manual_reviewed ? '已人工确认' : '自动匹配')}</span>
      </div>,
    },
    {
      title: '操作', key: 'actions', width: 120, fixed: 'right',
      render: (_, row) => (
        batch?.status === 'confirmed' && row.match_status === 'matched'
          ? <span className="waybill-muted">已生成运单</span>
          : <div className="waybill-row-actions">
            <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>核对</Button>
            <Button type="link" size="small" danger={row.match_status !== 'ignored'} onClick={() => void toggleIgnored(row)}>
              {row.match_status === 'ignored' ? '恢复' : '忽略'}
            </Button>
          </div>
      ),
    },
  ];

  const expandedRow = (row: WaybillImportRow) => {
    const matchedDetail = row.shipping_detail_id ? detailsById.get(row.shipping_detail_id) : undefined;
    const alternatives = alternativesFor(row);
    return <div className="waybill-expanded">
      <section>
        <h4>Excel 原始单元格</h4>
        {row.raw_values?.length ? <div className="waybill-raw-values">
          {row.raw_values.map((value, index) => <span key={index}><small>第 {index + 1} 列</small>{String(value) || '（空）'}</span>)}
        </div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="人工补充行，没有原始单元格" />}
      </section>
      <section>
        <h4>当前关联的发货明细</h4>
        {matchedDetail ? <div className="waybill-detail-card is-current">
          <b>{matchedDetail.name} · {matchedDetail.quantity} 份</b>
          <span>{matchedDetail.phone || '无电话'} · {matchedDetail.address || '无地址'}</span>
          <small>明细 #{matchedDetail.id} · 已处理 {matchedDetail.handled_quantity} 份 · {matchedDetail.channel}</small>
        </div> : <Alert showIcon type="warning" title="尚未关联发货明细" description="点击“核对”可选择本期确认版发货明细；这里不会新建或修改发货计划。" />}
      </section>
      <section>
        <h4>可能对应的其他明细</h4>
        {alternatives.length ? <div className="waybill-alternatives">
          {alternatives.map((detail) => <div className="waybill-detail-card" key={detail.id}>
            <b>{detail.name} · {detail.quantity} 份</b>
            <span>{detail.phone || '无电话'} · {detail.address || '无地址'}</span>
          </div>)}
        </div> : <span className="waybill-muted">没有发现相似明细，可在“核对”中搜索全部本期明细。</span>}
      </section>
    </div>;
  };

  const filterOptions: Array<{ label: string; value: RowFilter }> = batch ? [
    { label: `待处理 ${batch.unmatched_rows}`, value: 'unresolved' },
    { label: `文件未覆盖 ${remainingFileGap}`, value: 'gap' },
    { label: `全部 ${batch.rows.length}`, value: 'all' },
    { label: `已匹配 ${batch.matched_rows}`, value: 'matched' },
    { label: '待人工匹配', value: 'manual' },
    { label: '未识别 / 无效', value: 'invalid' },
    { label: '重复运单', value: 'duplicate' },
    { label: '无需运单', value: 'no_tracking' },
    { label: '已忽略', value: 'ignored' },
  ] : [];

  if (draftQuery.isLoading || issueQuery.isLoading) {
    return <div className="waybill-page-loading"><Spin size="large" description="正在读取运单草稿" /></div>;
  }

  return <div className="waybill-page">
    <input
      ref={fileInputRef}
      className="waybill-file-input"
      type="file"
      accept=".xlsx,.xlsm"
      onChange={(event) => event.target.files?.[0] && acceptFile(event.target.files[0], forceReparseRef.current)}
    />
    <Button type="link" size="small" icon={<LeftOutlined />} className="waybill-back" onClick={() => navigate(`/logistics/issues/${issueId}`)}>
      返回第 {issueQuery.data?.issue_number ?? '—'} 期快递管理
    </Button>

    <header className="waybill-head">
      <div>
        <div className="waybill-title-line">
          <h1>运单核对工作台</h1>
          {batch && <Tag color={batch.status === 'confirmed' ? 'green' : 'blue'}>{batch.status === 'confirmed' ? '已确认导入' : '草稿自动保存'}</Tag>}
        </div>
        <p>
          第 {issueQuery.data?.issue_number ?? '—'} 期 · {issueQuery.data ? dayjs(issueQuery.data.publish_date).format('YYYY-MM-DD') : '—'}
          {batch ? ` · ${batch.filename}` : ' · 尚未选择运单文件'}
        </p>
      </div>
      <div className="waybill-head-actions">
        <Button icon={<LinkOutlined />} onClick={() => setConsolidatedOpen(true)}>
          月底合寄待办 {pendingDeferralsQuery.data?.length ?? 0}
        </Button>
        {batch && <Button icon={<PlusOutlined />} onClick={openAdd}>手工补充一行</Button>}
        {batch?.status !== 'confirmed' && <>
          <Button icon={<ReloadOutlined />} loading={parsing} onClick={() => openFilePicker(true)}>重新上传并解析</Button>
        </>}
        {batch?.status === 'confirmed' && <Button icon={<UploadOutlined />} onClick={() => openFilePicker(false)}>导入补充文件</Button>}
      </div>
    </header>

    {(draftQuery.isError || issueQuery.isError || detailsQuery.isError || reportQuery.isError || fulfillmentQuery.isError) && <Alert
      showIcon
      type="error"
      title="工作台部分数据加载失败"
      description={logisticsApiErrorMessage(draftQuery.error || issueQuery.error || detailsQuery.error || reportQuery.error || fulfillmentQuery.error, '请重新加载页面')}
    />}

    {!batch ? <Card className="waybill-empty-card">
      <div
        className={`waybill-upload-zone${isDraggingFile ? ' is-dragging' : ''}`}
        onClick={() => !parsing && openFilePicker(false)}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <FileExcelOutlined />
        <h2>{isDraggingFile ? '松开即可上传并解析' : '上传发货表，开始核对运单'}</h2>
        <p>拖拽到此处或点击选择 .xlsx / .xlsm。解析不出的原始行也会保留，可在工作台中手工补充。</p>
        <Button type="primary" icon={<UploadOutlined />} loading={parsing}>选择运单 Excel</Button>
      </div>
    </Card> : <>
      <Card className="waybill-status-card" styles={{ body: { padding: 0 } }}>
        <div className="waybill-status-row has-five-metrics">
          <div className={`waybill-status-result ${planReconciled ? 'is-success' : 'is-warning'}`}>
            <span className="waybill-status-icon"><CheckCircleOutlined /></span>
            <div><small>发货计划对账</small><b>{planReconciled ? '计划已对平' : '计划仍有差异'}</b></div>
          </div>
          <div className="waybill-status-metric"><span>确认时计划</span><b>{confirmedPlanQuantity?.toLocaleString() ?? '—'}</b><small>份</small></div>
          <div className="waybill-status-metric"><span>当前计划</span><b>{currentPlanQuantity.toLocaleString()}</b><small>份</small></div>
          <div className="waybill-status-metric"><span>已归因停发</span><b>{planAttributedQuantity.toLocaleString()}</b><small>份</small></div>
          <div className="waybill-status-metric"><span>未解释差异</span><b>{planUnexplainedDelta?.toLocaleString() ?? '—'}</b><small>份</small></div>
        </div>
      </Card>

      <Card className="waybill-status-card" styles={{ body: { padding: 0 } }}>
        <div className="waybill-status-row">
          <div className={`waybill-status-result ${fulfillmentQuery.data?.shipment_status === 'partial' ? 'is-partial' : displayedPendingQuantity ? 'is-partial' : 'is-success'}`}>
            <span className="waybill-status-icon"><FileExcelOutlined /></span>
            <div><small>实际发货与核销</small><b>{fulfillmentQuery.data?.status === 'shipped' && fulfillmentQuery.data.shipment_status === 'partial' ? '核销已完成 · 部分发货' : displayedPendingQuantity ? '部分已发货' : '全部已发货'}</b></div>
          </div>
          <div className="waybill-status-metric"><span>确认印数</span><b>{batch.expected_quantity.toLocaleString()}</b><small>份 · 核销基准</small></div>
          <div className="waybill-status-metric"><span>实际发出</span><b>{(fulfillmentQuery.data?.actual_shipped_quantity ?? batch.matched_quantity).toLocaleString()}</b><small>份</small></div>
          <div className="waybill-status-metric"><span>无需发货</span><b>{adjustmentQuantity.toLocaleString()}</b><small>份</small></div>
          <div className="waybill-status-metric is-warning"><span>待月底合寄</span><b>{deferredQuantity.toLocaleString()}</b><small>份 · 已说明</small></div>
          <div className={`waybill-status-metric${unexplainedPendingQuantity ? ' is-danger' : ''}`}><span>未解释待补</span><b>{unexplainedPendingQuantity.toLocaleString()}</b><small>份</small></div>
        </div>
      </Card>

      <Card className="waybill-table-card" styles={{ body: { padding: 0 } }}>
        <div className="waybill-table-toolbar">
          <Segmented<RowFilter> value={filter} options={filterOptions} onChange={setFilter} />
          <span>{filter === 'gap' ? '确认印数与源文件总数的差额' : `当前显示 ${visibleRows.length} 行，按影响份数从高到低排列`}</span>
        </div>
        {filter === 'unresolved' && groupSuggestions[0] && <div className="waybill-match-suggestion">
          <div>
            <b>疑似属于同一条计划明细：{groupSuggestions[0].recipientName} · {groupSuggestions[0].detailQuantity}份</b>
            <span>{groupSuggestions[0].rowIds.length}个运单合计{groupSuggestions[0].rowQuantity}份，姓名一致且份数正好对应。</span>
          </div>
          <Button
            type="primary"
            icon={<LinkOutlined />}
            loading={bulkMatching}
            onClick={() => void handleBulkMatch(groupSuggestions[0].rowIds, groupSuggestions[0].shippingDetailId)}
          >关联这 {groupSuggestions[0].rowIds.length} 个运单</Button>
        </div>}
        {filter === 'gap' ? <div className="waybill-gap-workbench">
          <Alert
            showIcon
            type={unexplainedPendingQuantity ? 'warning' : 'success'}
            title={`源文件差额 ${remainingFileGap.toLocaleString()} 份：待月底合寄 ${deferredQuantity.toLocaleString()} 份，未解释 ${unexplainedPendingQuantity.toLocaleString()} 份`}
            description="月底合寄属于计划内延期，不要登记为暂停寄送或无需发货；计划数量录错时使用“计划纠错”。"
          />
          <div className="waybill-gap-actions">
            <Button onClick={() => setSelectedGapIds(recommendedMonthEndGapIds(gapDetails))}>
              选择建议的月底明细
            </Button>
            <Button
              type="primary"
              icon={<StopOutlined />}
              loading={savingDeferral}
              disabled={!selectedGapIds.length}
              onClick={() => void handleCreateDeferrals()}
            >标记待月底合寄</Button>
            <Button
              disabled={selectedGapIds.length !== 1}
              onClick={() => {
                setAdjustmentDetailId(selectedGapIds[0]);
                setAdjustmentReason('');
                setAdjustmentOpen(true);
              }}
            >确认为无需发货</Button>
            <span>勾选月底明细后批量登记；每条记录保留具体收件人归属。</span>
          </div>
          <Table<ShippingGapDetail>
            rowKey="shipping_detail_id"
            size="small"
            pagination={false}
            dataSource={gapDetails}
            rowSelection={{
              selectedRowKeys: selectedGapIds,
              onChange: (keys) => setSelectedGapIds(keys.map(Number)),
              getCheckboxProps: (row) => ({ disabled: row.remaining_quantity <= 0 }),
            }}
            columns={[
              {
                title: '计划明细', key: 'detail',
                render: (_, row) => <div className="waybill-recipient"><b>{row.name}</b><span>{row.channel} · {row.sheet_name}</span></div>,
              },
              { title: '计划', dataIndex: 'planned_quantity', width: 72, align: 'right' },
              { title: '文件', dataIndex: 'source_quantity', width: 72, align: 'right' },
              {
                title: '处理状态', key: 'state', width: 150,
                render: (_, row) => row.deferred_quantity
                  ? <Tag color="blue">待月底合寄 {row.deferred_quantity}份</Tag>
                  : row.suggested_month_end ? <Tag color="gold">建议月底合寄</Tag> : <Tag color="red">待核对</Tag>,
              },
              {
                title: '剩余差额', dataIndex: 'remaining_quantity', width: 88, align: 'right',
                render: (value: number) => <b>{value}</b>,
              },
              {
                title: '操作', key: 'action', width: 100,
                render: (_, row) => <Button
                  type="link"
                  size="small"
                  icon={<SwapOutlined />}
                  disabled={row.remaining_quantity <= 0}
                  onClick={() => {
                    setPlanTransferGap(row);
                    setTransferReason('计划份数归属纠错');
                  }}
                >计划纠错</Button>,
              },
            ]}
          />
          {!!unassignedAdjustments.length && <Alert
            showIcon
            type="warning"
            title="存在尚未归属具体收件人的历史无需发货记录"
            description={<Button size="small" type="link" onClick={() => {
              setAttributionAdjustment(unassignedAdjustments[0]);
              setAdjustmentDetailId(suggestedAdjustmentDetail?.id);
            }}>补充第一条记录的归属</Button>}
          />}
        </div> : <Table
            rowKey="id"
            columns={columns}
            dataSource={visibleRows}
            pagination={{ pageSize: 15, showSizeChanger: false, showTotal: (total) => `共 ${total} 行` }}
            scroll={{ x: 944 }}
            expandable={{ expandedRowRender: expandedRow }}
            locale={{ emptyText: <Empty description={filter === 'unresolved' ? '没有待处理行' : '当前筛选没有数据'} /> }}
          />}
      </Card>

      <div className="waybill-confirm-bar">
        <div>
          <b>{batch.status === 'confirmed' ? `已核销 ${displayedHandledQuantity.toLocaleString()} 份` : `准备核销 ${batch.matched_quantity.toLocaleString()} 份`}</b>
          <span>{batch.status === 'confirmed' ? `仍有 ${currentPendingQuantity.toLocaleString()} 份未实际寄出，其中 ${deferredQuantity.toLocaleString()} 份待月底合寄。` : `确认后保留 ${displayedPendingQuantity.toLocaleString()} 份待处理；未解决行仍可继续关联。`}</span>
        </div>
        {batch.status === 'previewed' ? <Popconfirm
          title={`确认导入已核销的 ${batch.matched_quantity.toLocaleString()} 份？`}
          description={`将保留 ${displayedPendingQuantity.toLocaleString()} 份待处理，未匹配行确认后仍可继续关联。`}
          okText="确认导入"
          cancelText="继续核对"
          onConfirm={() => void handleConfirm()}
        >
          <Button type="primary" size="large" icon={<CheckCircleOutlined />} loading={confirming} disabled={batch.matched_rows === 0}>
            导入已核销的 {batch.matched_quantity.toLocaleString()} 份，保留 {displayedPendingQuantity.toLocaleString()} 份待处理
          </Button>
        </Popconfirm> : <Button
          type="primary"
          size="large"
          className="waybill-return-button"
          icon={<LeftOutlined />}
          onClick={() => navigate(`/logistics/issues/${issueId}`)}
        >返回第 {issueQuery.data?.issue_number ?? '—'} 期快递管理</Button>}
      </div>
    </>}

    <Modal
      title={editingRow ? `核对 ${editingRow.source_sheet} · 第 ${editingRow.source_row} 行` : '手工补充未识别行'}
      open={Boolean(editingRow) || addingRow}
      width={760}
      okText="保存并重新核对"
      okButtonProps={{ icon: <SaveOutlined />, loading: savingRow }}
      onOk={() => void saveRow()}
      onCancel={closeEditor}
    >
      <Alert
        className="waybill-editor-note"
        showIcon
        type="info"
        title="这里只核对运单与已有发货明细的关系"
        description="选择的明细必须来自本期确认版发货计划；不会在这里新建或改动发货计划份数。"
      />
      <Form form={rowForm} layout="vertical">
        <div className="waybill-form-grid">
          <Form.Item name="recipient_name" label="收件人" rules={[{ required: true, message: '请输入收件人' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="phone" label="电话"><Input /></Form.Item>
          <Form.Item name="address" label="地址" className="is-wide"><Input /></Form.Item>
          <Form.Item name="quantity" label="本包裹份数" rules={[{ required: true, type: 'number', min: 1, message: '份数必须大于 0' }]}>
            <InputNumber min={1} precision={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="carrier" label="承运公司" rules={[{ required: true, message: '请输入承运公司' }]}>
            <Select showSearch options={['中通', '顺丰', '邮政', '邮政挂号'].map((value) => ({ value, label: value }))} />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(previous, current) => previous.no_tracking_required !== current.no_tracking_required}>
            {({ getFieldValue }) => !getFieldValue('no_tracking_required') && <Form.Item name="tracking_no" label="运单号" rules={[{ required: true, message: '请输入运单号' }]}>
              <Input />
            </Form.Item>}
          </Form.Item>
          <Form.Item name="no_tracking_required" valuePropName="checked" label="运单要求">
            <Checkbox>无需运单（备用报、社用报等）</Checkbox>
          </Form.Item>
          <Form.Item name="shipping_detail_id" label="关联本期发货明细" className="is-wide" rules={[{ required: true, message: '请选择本期发货明细' }]}>
            <Select
              showSearch
              allowClear
              optionFilterProp="label"
              placeholder="按姓名、电话或地址搜索本期确认版明细"
              options={details.map((detail) => ({ value: detail.id, label: detailLabel(detail) }))}
            />
          </Form.Item>
        </div>
      </Form>
    </Modal>

    <Modal
      title="确认忽略这条源文件记录"
      open={Boolean(ignoreRow)}
      okText="记录原因并忽略"
      okButtonProps={{ danger: true, loading: savingRow, disabled: !ignoreReason.trim() }}
      onOk={() => void confirmIgnore()}
      onCancel={() => { setIgnoreRow(null); setIgnoreReason(''); }}
    >
      <Alert
        showIcon
        type="warning"
        title={ignoreRow ? `${ignoreRow.tracking_no || '无运单号'} · ${ignoreRow.quantity}份` : ''}
        description="忽略不会删除原始行，但该运单不会计入实际发货；原因会永久保留在导入记录中。"
      />
      <Input.TextArea
        className="waybill-reason-input"
        value={ignoreReason}
        rows={3}
        maxLength={255}
        showCount
        placeholder="请填写忽略原因"
        onChange={(event) => setIgnoreReason(event.target.value)}
      />
    </Modal>

    <Modal
      title={`标记 ${adjustmentSelectedQuantity.toLocaleString()} 份无需发货`}
      open={adjustmentOpen}
      okText="确认核销"
      okButtonProps={{ loading: savingAdjustment, disabled: !adjustmentReason.trim() || !adjustmentSelectedQuantity || !adjustmentDetailId }}
      onOk={() => void handleAdjustment()}
      onCancel={() => setAdjustmentOpen(false)}
    >
      <Alert
        showIcon
        type="info"
        title="该记录用于解释确认印数中没有出现在运单源文件里的份数"
        description="确认后会计入实际发货核销，但不会生成虚假的运单号。"
      />
      <Select
        className="waybill-reason-input"
        showSearch
        optionFilterProp="label"
        value={adjustmentDetailId}
        placeholder="选择这笔无需发货对应的收件明细"
        options={details.filter((detail) => detail.source_type !== 'complaint_makeup').map((detail) => ({
          value: detail.id,
          label: detailLabel(detail),
        }))}
        onChange={setAdjustmentDetailId}
      />
      <Input
        className="waybill-reason-input"
        value={adjustmentReason}
        maxLength={255}
        placeholder={`例如：${suspendedConsolidatedShippingReason}`}
        onChange={(event) => setAdjustmentReason(event.target.value)}
      />
    </Modal>

    <Modal
      title="补充无需发货记录的归属"
      open={Boolean(attributionAdjustment)}
      okText="确认归属"
      okButtonProps={{ loading: savingAdjustment, disabled: !adjustmentDetailId }}
      onOk={() => void handleAttribution()}
      onCancel={() => { setAttributionAdjustment(null); setAdjustmentDetailId(undefined); }}
    >
      <Alert
        showIcon
        type="warning"
        title={attributionAdjustment ? `${adjustmentReasonLabel(attributionAdjustment.reason)} · ${attributionAdjustment.quantity}份` : ''}
        description="历史记录只有原因和份数，尚不能说明具体是哪条计划发生停发。补充后才会用于计划对平，并永久保留收件信息快照。"
      />
      <Select
        className="waybill-reason-input"
        showSearch
        optionFilterProp="label"
        value={adjustmentDetailId}
        placeholder="按姓名、电话或地址搜索本期发货明细"
        options={details.filter((detail) => detail.source_type !== 'complaint_makeup').map((detail) => ({
          value: detail.id,
          label: detailLabel(detail),
        }))}
        onChange={setAdjustmentDetailId}
      />
    </Modal>

    <Modal
      title={planTransferGap ? `计划纠错：从“${planTransferGap.name}”转出 ${planTransferGap.remaining_quantity} 份` : '计划纠错'}
      open={Boolean(planTransferGap)}
      okText="确认净额转移"
      okButtonProps={{
        loading: savingTransfer,
        disabled: !transferReason.trim() || (creatingTransferTarget ? !transferName.trim() : !transferTargetId),
      }}
      onOk={() => void handlePlanTransfer()}
      onCancel={() => setPlanTransferGap(null)}
    >
      <Alert
        showIcon
        type="info"
        title="转出与转入同时保存，本期计划总数不会改变"
        description="适用于数量被记在错误收件明细下的情况；找不到目标明细时可以直接新增。"
      />
      <Checkbox
        className="waybill-reason-input"
        checked={creatingTransferTarget}
        onChange={(event) => {
          setCreatingTransferTarget(event.target.checked);
          setTransferTargetId(undefined);
        }}
      >新增收件明细</Checkbox>
      {creatingTransferTarget ? <>
        <Input className="waybill-reason-input" value={transferName} placeholder="收件人（必填）" onChange={(event) => setTransferName(event.target.value)} />
        <Input className="waybill-reason-input" value={transferPhone} placeholder="电话" onChange={(event) => setTransferPhone(event.target.value)} />
        <Input className="waybill-reason-input" value={transferAddress} placeholder="地址" onChange={(event) => setTransferAddress(event.target.value)} />
      </> : <Select
        className="waybill-reason-input"
        showSearch
        optionFilterProp="label"
        value={transferTargetId}
        placeholder="选择正确的收件明细"
        options={details.filter((detail) => detail.id !== planTransferGap?.shipping_detail_id).map((detail) => ({
          value: detail.id,
          label: detailLabel(detail),
        }))}
        onChange={setTransferTargetId}
      />}
      <Input
        className="waybill-reason-input"
        value={transferReason}
        maxLength={255}
        placeholder="填写计划纠错原因"
        onChange={(event) => setTransferReason(event.target.value)}
      />
    </Modal>

    <Modal
      title="月底合寄待办"
      open={consolidatedOpen}
      width={820}
      okText="登记运单并完成核销"
      okButtonProps={{
        loading: savingConsolidated,
        disabled: !selectedDeferralIds.length || !consolidatedTracking.trim(),
      }}
      onOk={() => void handleConsolidatedPackage()}
      onCancel={() => setConsolidatedOpen(false)}
    >
      <Alert
        showIcon
        type="info"
        title="同一张运单可以核销同一收件人的多个历史刊期"
        description="请只勾选同一收件人的记录；系统会把包裹份数分别归入对应刊期。"
      />
      <div className="waybill-consolidated-fields">
        <Select
          value={consolidatedCarrier}
          options={['中通', '顺丰', '邮政', '邮政挂号'].map((value) => ({ value, label: value }))}
          onChange={setConsolidatedCarrier}
        />
        <Input value={consolidatedTracking} placeholder="输入月底合寄运单号" onChange={(event) => setConsolidatedTracking(event.target.value)} />
      </div>
      <Table
        rowKey="id"
        size="small"
        pagination={{ pageSize: 8, showSizeChanger: false }}
        loading={pendingDeferralsQuery.isLoading}
        dataSource={pendingDeferralsQuery.data ?? []}
        rowSelection={{
          selectedRowKeys: selectedDeferralIds,
          onChange: (keys) => setSelectedDeferralIds(keys.map(Number)),
        }}
        columns={[
          { title: '刊期', dataIndex: 'issue_number', width: 90 },
          { title: '收件人', dataIndex: 'detail_name_snapshot', width: 130 },
          { title: '电话', dataIndex: 'detail_phone_snapshot', width: 130 },
          { title: '地址', dataIndex: 'detail_address_snapshot', ellipsis: true },
          { title: '份数', dataIndex: 'quantity', width: 70, align: 'right' },
        ]}
        locale={{ emptyText: <Empty description="当前没有待月底合寄记录" /> }}
      />
    </Modal>
  </div>;
}
