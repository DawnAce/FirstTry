import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  InputNumber,
  Button,
  Spin,
  message,
  Modal,
  Input,
  Timeline,
  Select,
  Alert,
  Drawer,
  Upload,
} from 'antd';
import {
  CheckOutlined,
  DownloadOutlined,
  ArrowLeftOutlined,
  UndoOutlined,
  PlusOutlined,
  DeleteOutlined,
  SendOutlined,
  WarningOutlined,
  InboxOutlined,
  PaperClipOutlined,
  FileSearchOutlined,
} from '@ant-design/icons';
import { getIssue, updateIssue, deleteIssue } from '../api/issues';
import {
  downloadIssueReportExport,
  getIssueReportExportFallbackFilename,
  resolveDownloadFilename,
} from '../api/exports';
import type { ReportEntry, TempPrintDetail } from '../api/reports';
import { getReport, updateReport, confirmReport, revokeReport, getRevisions, getTempPrintDetails, updateTempPrintDetails } from '../api/reports';
import type { RevisionRecord } from '../api/reports';
import { useAuth } from '../contexts/AuthContext';
import { IssueDeleteConfirmButton } from '../components/IssueDeleteConfirmButton';
import { DrawerTitle, StatusPill } from '../components/UiPrimitives';
import {
  confirmReportSource,
  deleteReportSource,
  downloadReportSource,
  getIssueReportSources,
  updateReportSourceShipping,
  uploadReportSource,
} from '../api/reportSources';
import type {
  ReportSourceAdjustmentKind,
  ReportSourceChannel,
  ReportSourceDocumentType,
  ReportSourceDocument,
  ReportSourceItem,
  ReportSourceStatus,
  ReportSourceSuggestion,
  ReportSourceUpload,
} from '../api/reportSources';
import { sortVisibleSocialUseEntries } from './reportOrder';
import { formatIssueReportTitle } from './reportTitle';
import './ReportEditor.css';

const categoryLabels: Record<string, string> = {
  postal: '北京邮发',
  retail: '北京报零',
  guangzhou: '广州日报',
  chengdu: '成都杂志铺',
  guotumao: '国图贸',
  social_use: '社用报',
  binding: '合订本',
};

// Display order (临时加印 extracted from social_use, shown at top separately; binding merged into social_use)
const categoryOrder = ['postal', 'retail', 'guangzhou', 'chengdu', 'guotumao', 'social_use'];

const categoryFrequency: Record<string, string> = {
  postal: '每周',
  retail: '每周',
  guangzhou: '每周',
  chengdu: '每月',
  guotumao: '每年',
};

const sourceChannels: ReportSourceChannel[] = ['postal', 'retail', 'guangzhou', 'chengdu'];

const sourceSubCategory: Record<ReportSourceChannel, string> = {
  postal: '本市',
  retail: '东部',
  guangzhou: '订阅',
  chengdu: '成都杂志铺',
};

const sourceStatusOptions: { label: string; value: ReportSourceStatus }[] = [
  { label: '已人工核对', value: 'confirmed' },
  { label: '渠道待确认', value: 'channel_pending' },
  { label: 'OCR待核对', value: 'pending_review' },
];

const adjustmentKindOptions: { label: string; value: ReportSourceAdjustmentKind }[] = [
  { label: '追加订数（结算+补发）', value: 'billable_addition' },
  { label: '补损重发（只补发）', value: 'replacement' },
  { label: '冲减（减少结算）', value: 'reduction' },
];

// Items hidden from social_use display (shown separately or managed by temp print details)
const EXTRA_ITEMS = ['临时加印', '临时加印_自留', '营报传媒加印', '财经中心加印', '中经未来', '产经中心加印'];

// Composite groups: parent label → sub_category prefixes
const COMPOSITE_GROUPS: { label: string; prefix: string; items: string[] }[] = [
  {
    label: '营报传媒',
    prefix: '营报传媒_',
    items: ['营报传媒_收发室', '营报传媒_读者', '营报传媒_备用报'],
  },
  {
    label: '报社订阅自投 / 展示',
    prefix: '',
    items: ['营报传媒_上犹', '高铁展示'],
  },
];

const DEPARTMENT_OPTIONS = [
  { label: '营报传媒', value: '营报传媒' },
  { label: '财经中心', value: '财经中心' },
  { label: '中经未来', value: '中经未来' },
  { label: '产经中心', value: '产经中心' },
  { label: '其他', value: '其他' },
];

export default function ReportEditor() {
  const { issueId } = useParams<{ issueId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();
  const [saving, setSaving] = useState(false);
  const [entries, setEntries] = useState<ReportEntry[]>([]);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const entriesRef = useRef<ReportEntry[]>([]);
  const confirmedRef = useRef<boolean | null>(null);
  const [revokeModalVisible, setRevokeModalVisible] = useState(false);
  const [revokeReason, setRevokeReason] = useState('');
  const [revoking, setRevoking] = useState(false);
  const [tempDetails, setTempDetails] = useState<TempPrintDetail[]>([]);
  const [tempDetailsLoaded, setTempDetailsLoaded] = useState(false);
  const tempDetailsRef = useRef<TempPrintDetail[]>([]);
  const tempDetailTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sourceDrawerOpen, setSourceDrawerOpen] = useState(false);
  const [sourceChannel, setSourceChannel] = useState<ReportSourceChannel>('postal');
  const [sourceDocumentType, setSourceDocumentType] = useState<ReportSourceDocumentType>('weekly');
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourcePreview, setSourcePreview] = useState<ReportSourceUpload | null>(null);
  const [sourceSuggestions, setSourceSuggestions] = useState<ReportSourceSuggestion[]>([]);
  const [sourceUploading, setSourceUploading] = useState(false);
  const [sourceConfirming, setSourceConfirming] = useState(false);
  const [shippingItem, setShippingItem] = useState<ReportSourceItem | null>(null);
  const [shippingQuantity, setShippingQuantity] = useState(0);
  const [shippingTracking, setShippingTracking] = useState('');
  const [shippingSaving, setShippingSaving] = useState(false);

  const { data: issue, isLoading: issueLoading } = useQuery({
    queryKey: ['issue', issueId],
    queryFn: async () => {
      const res = await getIssue(Number(issueId));
      return res.data;
    },
    enabled: !!issueId,
  });

  const { data: report, isLoading: reportLoading } = useQuery({
    queryKey: ['report', issueId],
    queryFn: async () => {
      const res = await getReport(Number(issueId));
      return res.data;
    },
    enabled: !!issueId,
  });

  const { data: sourceSummary, isLoading: sourceLoading } = useQuery({
    queryKey: ['reportSources', issueId],
    queryFn: async () => {
      const res = await getIssueReportSources(Number(issueId));
      return res.data;
    },
    enabled: !!issueId,
  });

  const loading = issueLoading || reportLoading;
  const isConfirmed = issue?.status === 'confirmed';

  // Sync entries from server data on initial load or after revoke
  useEffect(() => {
    if (!report) return;
    if (entries.length === 0) {
      setEntries(report.entries);
      entriesRef.current = report.entries;
    }
  }, [report]); // eslint-disable-line react-hooks/exhaustive-deps

  // After revoke (confirmed → draft), refresh entries from server
  useEffect(() => {
    if (isConfirmed === false && confirmedRef.current === true && report) {
      setEntries(report.entries);
      entriesRef.current = report.entries;
      setSaveStatus('idle');
    }
    confirmedRef.current = isConfirmed ?? null;
  }, [isConfirmed]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch revision history
  const { data: revisions } = useQuery({
    queryKey: ['revisions', issueId],
    queryFn: async () => {
      const res = await getRevisions(Number(issueId));
      return res.data;
    },
    enabled: !!issueId,
  });

  // Fetch temp print details
  const { data: tempDetailsData } = useQuery({
    queryKey: ['tempDetails', issueId],
    queryFn: async () => {
      const res = await getTempPrintDetails(Number(issueId));
      return res.data;
    },
    enabled: !!issueId,
  });

  useEffect(() => {
    if (tempDetailsData && !tempDetailsLoaded) {
      setTempDetails(tempDetailsData);
      tempDetailsRef.current = tempDetailsData;
      setTempDetailsLoaded(true);
    }
  }, [tempDetailsData]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveTempDetails = useCallback(async () => {
    if (!issueId || tempDetailsRef.current.length === 0) return;
    try {
      await updateTempPrintDetails(Number(issueId), tempDetailsRef.current);
      queryClient.invalidateQueries({ queryKey: ['tempDetails', issueId] });
      queryClient.invalidateQueries({ queryKey: ['report', issueId] });
    } catch (err: any) {
      message.error(err.response?.data?.detail || '保存明细失败');
    }
  }, [issueId, queryClient]);

  const handleAddTempDetail = () => {
    const newDetail: TempPrintDetail = {
      department: '营报传媒',
      quantity: 0,
      self_quantity: 0,
    };
    const updated = [...tempDetails, newDetail];
    setTempDetails(updated);
    tempDetailsRef.current = updated;
    saveTempDetails();
  };

  const handleRemoveTempDetail = (index: number) => {
    const updated = tempDetails.filter((_, i) => i !== index);
    setTempDetails(updated);
    tempDetailsRef.current = updated;
    saveTempDetails();
  };

  const handleTempDetailChange = (index: number, field: keyof TempPrintDetail, value: any) => {
    const updated = tempDetails.map((d, i) => {
      if (i !== index) return d;
      const newD = { ...d, [field]: value };
      // If department changes away from '其他', clear custom_name
      if (field === 'department' && value !== '其他') {
        newD.custom_name = null;
      }
      // Ensure self_quantity doesn't exceed quantity
      if (field === 'quantity' && newD.self_quantity > (value as number)) {
        newD.self_quantity = value as number;
      }
      return newD;
    });
    setTempDetails(updated);
    tempDetailsRef.current = updated;

    // Debounced save to avoid race conditions with rapid keystrokes
    if (tempDetailTimerRef.current) clearTimeout(tempDetailTimerRef.current);
    tempDetailTimerRef.current = setTimeout(() => saveTempDetails(), 1500);
  };

  const handleRevoke = async () => {
    if (!issueId) return;
    setRevoking(true);
    try {
      await revokeReport(Number(issueId), revokeReason || undefined);
      message.success('已作废，可重新编辑');
      setRevokeModalVisible(false);
      setRevokeReason('');
      setSaveStatus('idle');
      queryClient.invalidateQueries({ queryKey: ['issue', issueId] });
      queryClient.invalidateQueries({ queryKey: ['revisions', issueId] });
      queryClient.invalidateQueries({ queryKey: ['report', issueId] });
    } catch (err: any) {
      message.error(err.response?.data?.detail || '作废失败');
    } finally {
      setRevoking(false);
    }
  };

  // Auto-save: persist to server after 1.5s of no edits
  const doSave = useCallback(async () => {
    if (!issueId || entriesRef.current.length === 0) return;
    // Skip auto-save if issue is already confirmed (race condition guard)
    if (confirmedRef.current) return;
    setSaveStatus('saving');
    try {
      const payload = entriesRef.current.map(entry => ({
        category: entry.category,
        sub_category: entry.sub_category,
        value: entry.value,
      }));
      await updateReport(Number(issueId), payload);
      queryClient.invalidateQueries({ queryKey: ['report', issueId] });
      setSaveStatus('saved');
    } catch (err) {
      console.error('Auto-save failed:', err);
      setSaveStatus('error');
    }
  }, [issueId, queryClient]);

  const handleValueChange = (entryId: number, value: number | null | undefined) => {
    if (isConfirmed) return;
    const updated = entries.map(entry =>
      entry.id === entryId ? { ...entry, value: value ?? 0 } : entry
    );
    setEntries(updated);
    entriesRef.current = updated;

    // Debounced auto-save
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus('idle');
    saveTimerRef.current = setTimeout(() => doSave(), 1500);
  };

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (tempDetailTimerRef.current) clearTimeout(tempDetailTimerRef.current);
    };
  }, []);

  const calculateTotal = () => {
    // Exclude sub-allocations and deprecated extras
    const excluded = new Set(['临时加印_自留', '营报传媒加印', '财经中心加印', '中经未来', '产经中心加印']);
    return entries
      .filter(e => !excluded.has(e.sub_category))
      .reduce((sum, entry) => sum + entry.value, 0);
  };

  const groupEntriesByCategory = () => {
    const grouped: Record<string, ReportEntry[]> = {};
    entries.forEach(entry => {
      if (!grouped[entry.category]) {
        grouped[entry.category] = [];
      }
      grouped[entry.category].push(entry);
    });
    return grouped;
  };

  const calculateCategoryTotal = (categoryEntries: ReportEntry[]) => {
    // Exclude items managed separately (temp print + deprecated department extras)
    return categoryEntries
      .filter(e => !EXTRA_ITEMS.includes(e.sub_category))
      .reduce((sum, entry) => sum + entry.value, 0);
  };

  const handleConfirm = async () => {
    if (!issueId) return;
    // Flush any pending auto-save
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaving(true);
    setSaveStatus('idle');
    try {
      const payload = entriesRef.current.length > 0
        ? entriesRef.current.map(entry => ({
            category: entry.category,
            sub_category: entry.sub_category,
            value: entry.value,
          }))
        : entries.map(entry => ({
            category: entry.category,
            sub_category: entry.sub_category,
            value: entry.value,
          }));
      await updateReport(Number(issueId), payload);
      const confirmRes = await confirmReport(Number(issueId));
      const confirmData = confirmRes.data;
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['issues'] });
      queryClient.invalidateQueries({ queryKey: ['issue', issueId] });
      message.success('确认成功');
      if ((confirmData.shipping_details_copied ?? 0) > 0) {
        message.info(`已从上一期复制 ${confirmData.shipping_details_copied} 条 ZTO-MF`);
      }
      if (confirmData.warning) {
        Modal.warning({
          title: '中通发货份数不一致',
          content: confirmData.warning,
          okText: '确定',
          onOk: () => navigate('/print'),
        });
      } else {
        navigate('/print');
      }
    } catch (err: any) {
      const msg = err.response?.data?.detail;
      if (msg) {
        if (Array.isArray(msg)) {
          msg.forEach((e: any) => message.error(e.msg || JSON.stringify(e)));
        } else {
          message.error(String(msg));
        }
      } else {
        message.error('确认失败：' + (err.message || '未知错误'));
      }
      console.error('Confirm failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async () => {
    if (!issueId || !issue) return;
    try {
      const res = await downloadIssueReportExport(Number(issueId));
      const contentDisposition = res.headers['content-disposition'];
      const filename = resolveDownloadFilename(
        typeof contentDisposition === 'string' ? contentDisposition : undefined,
        getIssueReportExportFallbackFilename(issue),
      );
      const url = URL.createObjectURL(res.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      message.error('导出失败');
    }
  };

  const handleDeleteIssue = async () => {
    if (!issueId) return;
    try {
      await deleteIssue(Number(issueId));
      message.success(`第 ${issue?.issue_number} 期已删除`);
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['issues'] });
      navigate('/print');
    } catch (err: any) {
      message.error(err.response?.data?.detail || '删除失败');
    }
  };

  const resetSourceDrawer = () => {
    setSourceFile(null);
    setSourcePreview(null);
    setSourceSuggestions([]);
    setSourceUploading(false);
    setSourceConfirming(false);
  };

  const openSourceDrawer = (channel: ReportSourceChannel) => {
    resetSourceDrawer();
    setSourceChannel(channel);
    setSourceDocumentType(channel === 'chengdu' ? 'monthly' : 'weekly');
    setSourceDrawerOpen(true);
  };

  const openSourceReview = (document: ReportSourceDocument) => {
    resetSourceDrawer();
    setSourceChannel(document.channel);
    setSourceDocumentType(document.document_type);
    const suggestions: ReportSourceSuggestion[] = document.items.map(item => ({
      issue_number: item.issue_number,
      source_period: null,
      item_kind: item.item_kind,
      category: item.category as ReportSourceChannel,
      sub_category: item.sub_category,
      source_label: item.source_label,
      source_quantity: item.source_quantity,
      applied_quantity: item.applied_quantity,
      source_status: item.source_status,
      adjustment_kind: item.adjustment_kind,
      confidence: null,
      notes: item.notes,
    }));
    setSourcePreview({ ...document, suggestions, duplicate: false });
    setSourceSuggestions(suggestions);
    setSourceDrawerOpen(true);
  };

  const handleSourceChannelChange = (channel: ReportSourceChannel) => {
    resetSourceDrawer();
    setSourceChannel(channel);
    setSourceDocumentType(channel === 'chengdu' ? 'monthly' : 'weekly');
  };

  const handleSourceUpload = async () => {
    if (!sourceFile || !issue) return;
    setSourceUploading(true);
    try {
      const response = await uploadReportSource(
        sourceFile,
        sourceChannel,
        issue.issue_number,
        sourceDocumentType,
      );
      if (response.data.duplicate && response.data.extraction_status === 'confirmed') {
        message.info('这份文件已经归档并确认，无需重复上传');
        setSourceDrawerOpen(false);
        resetSourceDrawer();
        queryClient.invalidateQueries({ queryKey: ['reportSources', issueId] });
        return;
      }
      setSourcePreview(response.data);
      setSourceSuggestions(response.data.suggestions.map(suggestion => ({
        ...suggestion,
        issue_number: suggestion.issue_number ?? issue.issue_number,
      })));
      queryClient.invalidateQueries({ queryKey: ['reportSources', issueId] });
      message.success(response.data.duplicate ? '已找到同一来源文件，请继续完成核对' : '来源文件已归档，识别结果待核对');
    } catch (err: any) {
      message.error(err.response?.data?.detail || '来源文件上传失败');
    } finally {
      setSourceUploading(false);
    }
  };

  const handleSourceReupload = async () => {
    if (!sourcePreview) return;
    try {
      await deleteReportSource(sourcePreview.id);
      setSourceFile(null);
      setSourcePreview(null);
      setSourceSuggestions([]);
      await queryClient.invalidateQueries({ queryKey: ['reportSources', issueId] });
      message.success('错误文件已移除，请重新选择正确文件');
    } catch (err: any) {
      message.error(err.response?.data?.detail || '撤销来源文件失败');
      throw err;
    }
  };

  const updateSourceSuggestion = <K extends keyof ReportSourceSuggestion>(
    index: number,
    key: K,
    value: ReportSourceSuggestion[K],
  ) => {
    setSourceSuggestions(current => current.map((suggestion, suggestionIndex) => (
      suggestionIndex === index ? { ...suggestion, [key]: value } : suggestion
    )));
  };

  const addSourceSuggestion = () => {
    if (!issue) return;
    setSourceSuggestions(current => [...current, {
      issue_number: issue.issue_number,
      source_period: null,
      item_kind: sourceDocumentType === 'adjustment' ? 'adjustment' : 'base',
      category: sourceChannel,
      sub_category: sourceSubCategory[sourceChannel],
      source_label: '人工补录',
      source_quantity: null,
      applied_quantity: null,
      source_status: 'pending_review',
      adjustment_kind: sourceDocumentType === 'adjustment' ? 'billable_addition' : null,
      confidence: null,
      notes: 'OCR未识别，人工补录',
    }]);
  };

  const handleSourceConfirm = async () => {
    if (!sourcePreview) return;
    if (sourceSuggestions.length === 0) {
      message.warning('请至少添加一条来源明细');
      return;
    }
    if (sourceSuggestions.some(suggestion => !suggestion.issue_number)) {
      message.warning('请补全所有明细的刊期');
      return;
    }
    if (sourceSuggestions.some(suggestion => suggestion.source_status === 'pending_review')) {
      message.warning('仍有 OCR 待核对项，请逐行确认状态');
      return;
    }
    setSourceConfirming(true);
    try {
      await confirmReportSource(sourcePreview.id, sourceSuggestions.map(suggestion => ({
        issue_number: suggestion.issue_number!,
        item_kind: suggestion.item_kind,
        category: suggestion.category,
        sub_category: suggestion.sub_category,
        source_label: suggestion.source_label,
        source_quantity: suggestion.source_quantity,
        applied_quantity: suggestion.item_kind === 'base' ? suggestion.applied_quantity : null,
        source_status: suggestion.source_status,
        adjustment_kind: suggestion.item_kind === 'adjustment' ? suggestion.adjustment_kind : null,
        notes: suggestion.notes,
      })));
      const updatedReport = await getReport(Number(issueId));
      setEntries(updatedReport.data.entries);
      entriesRef.current = updatedReport.data.entries;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['reportSources', issueId] }),
        queryClient.invalidateQueries({ queryKey: ['report', issueId] }),
      ]);
      message.success('来源识别与刊期映射已确认');
      setSourceDrawerOpen(false);
      resetSourceDrawer();
    } catch (err: any) {
      message.error(err.response?.data?.detail || '确认来源失败');
    } finally {
      setSourceConfirming(false);
    }
  };

  const handleSourceDownload = async (documentId: number, filename: string) => {
    try {
      await downloadReportSource(documentId, filename);
    } catch (err: any) {
      message.error(err.response?.data?.detail || '下载来源文件失败');
    }
  };

  const openShippingModal = (item: ReportSourceItem) => {
    setShippingItem(item);
    setShippingQuantity(item.shipped_quantity);
    setShippingTracking(item.tracking_no || '');
  };

  const handleShippingSave = async () => {
    if (!shippingItem) return;
    setShippingSaving(true);
    try {
      await updateReportSourceShipping(shippingItem.id, {
        shipped_quantity: shippingQuantity,
        tracking_no: shippingTracking.trim() || null,
        shipped_at: shippingQuantity > 0 ? new Date().toISOString() : null,
      });
      queryClient.invalidateQueries({ queryKey: ['reportSources', issueId] });
      message.success('补发登记已保存');
      setShippingItem(null);
    } catch (err: any) {
      message.error(err.response?.data?.detail || '补发登记失败');
    } finally {
      setShippingSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '100px 0' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!issue || entries.length === 0) {
    return <div style={{ padding: 24 }}>数据加载失败</div>;
  }

  const groupedEntries = groupEntriesByCategory();
  const sortedCategories = categoryOrder.filter(c => groupedEntries[c]);
  const confirmationSummary = report?.confirmation_summary;

  // Extract 临时加印 from social_use for prominent display at top
  const tempEntry = entries.find(e => e.category === 'social_use' && e.sub_category === '临时加印');
  const tempSelfEntry = entries.find(e => e.category === 'social_use' && e.sub_category === '临时加印_自留');
  const tempExpressValue = (tempEntry?.value ?? 0) - (tempSelfEntry?.value ?? 0);

  const formatCount = (value: number) => value.toLocaleString('zh-CN');
  const total = calculateTotal();
  const channelTotal = total - (tempEntry?.value ?? 0);
  const destinationSummary = report?.destination_summary ?? [];
  const shippingCheck = report?.shipping_check;
  const shippingMismatch = Boolean(shippingCheck && !shippingCheck.is_match);
  const completionPercent = entries.length
    ? Math.round(entries.filter(entry => Number.isFinite(entry.value) && entry.value >= 0).length / entries.length * 100)
    : 0;
  const updatedAt = issue.updated_at?.replace('T', ' ').slice(5, 16) || '—';
  const tempSelfValue = tempDetails.length > 0
    ? tempDetails.reduce((sum, detail) => sum + detail.self_quantity, 0)
    : (tempSelfEntry?.value ?? 0);
  const tempExpressDisplayValue = tempDetails.length > 0
    ? tempDetails.reduce((sum, detail) => sum + detail.quantity - detail.self_quantity, 0)
    : tempExpressValue;
  const socialEntries = groupedEntries.social_use ?? [];
  const bindingEntries = groupedEntries.binding ?? [];
  const compositeNames = new Set(COMPOSITE_GROUPS.flatMap(group => group.items));
  const mainSocialEntries = sortVisibleSocialUseEntries(socialEntries.filter(
    entry => !EXTRA_ITEMS.includes(entry.sub_category) && !compositeNames.has(entry.sub_category),
  ));
  const socialTotal = calculateCategoryTotal([...socialEntries, ...bindingEntries]);
  const socialItemCount = COMPOSITE_GROUPS.reduce(
    (count, group) => count + group.items.filter(name => entries.some(entry => entry.sub_category === name)).length,
    mainSocialEntries.length + bindingEntries.length,
  );
  const sourceChannelSummaries = Object.fromEntries(
    (sourceSummary?.channels ?? []).map(channel => [channel.channel, channel]),
  );
  const currentSourceItems = (sourceSummary?.documents ?? []).flatMap(document =>
    document.items.filter(item => item.issue_number === issue.issue_number),
  );
  const sourcePendingCount = currentSourceItems.filter(item => item.source_status !== 'confirmed').length;
  const sourceAdjustmentItems = currentSourceItems.filter(
    item => item.item_kind === 'adjustment' && item.shipping_delta > 0,
  );

  const sourceStateForChannel = (channel: ReportSourceChannel) => {
    const documents = (sourceSummary?.documents ?? []).filter(document => document.channel === channel);
    const items = documents.flatMap(document =>
      document.items.filter(item => item.issue_number === issue.issue_number),
    );
    if (items.some(item => item.source_status === 'pending_review')) {
      return { label: 'OCR待核对', tone: 'warning' as const, documents, items };
    }
    if (items.some(item => item.source_status === 'channel_pending')) {
      return { label: '渠道待确认', tone: 'warning' as const, documents, items };
    }
    if (documents.length > 0) {
      return { label: '已归档', tone: 'success' as const, documents, items };
    }
    return { label: '缺来源', tone: 'neutral' as const, documents, items };
  };

  const renderEntryControl = (entry: ReportEntry) => isConfirmed ? (
    <span className="report-editor-static-count">{formatCount(entry.value)}</span>
  ) : (
    <InputNumber
      aria-label={`${entry.sub_category}份数`}
      className="report-editor-count-input"
      controls={false}
      value={entry.value}
      onChange={(value) => handleValueChange(entry.id, value ?? undefined)}
      min={0}
      precision={0}
    />
  );

  const renderMiniField = (entry: ReportEntry, label = entry.sub_category) => (
    <div className="report-editor-mini-field" key={entry.id}>
      <span>{label}</span>
      <div className="report-editor-mini-value">
        {renderEntryControl(entry)}
        <em>份</em>
      </div>
    </div>
  );

  const renderCompositeGroup = (group: typeof COMPOSITE_GROUPS[number]) => {
    const groupEntries = group.items.flatMap(name => {
      const entry = entries.find(item => item.sub_category === name);
      return entry ? [entry] : [];
    });
    if (groupEntries.length === 0) return null;
    const groupTotal = groupEntries.reduce((sum, entry) => sum + entry.value, 0);
    return (
      <div className="report-editor-social-group" key={group.label}>
        <div className="report-editor-social-head">
          <span>{group.label}</span>
          <span className="report-editor-pill">自动合计</span>
          <strong>{formatCount(groupTotal)} 份</strong>
        </div>
        <div className="report-editor-social-grid">
          {groupEntries.map(entry => renderMiniField(
            entry,
            group.prefix ? entry.sub_category.replace(group.prefix, '') : entry.sub_category,
          ))}
        </div>
      </div>
    );
  };

  const renderReadOnlyField = (value: number, label: string) => (
    <div className="report-editor-readonly-count" aria-label={label}>
      <span>{formatCount(value)}</span><em>份</em>
    </div>
  );

  return (
    <div className="report-editor-page">
      <section className="report-editor-shell">
        <header className="report-editor-title">
          <Button
            className="report-editor-back"
            icon={<ArrowLeftOutlined />}
            aria-label="返回印数管理"
            onClick={() => navigate('/print')}
          />
          <span className="report-editor-title-icon" aria-hidden="true">📰</span>
          <div className="report-editor-title-copy">
            <div className="report-editor-title-line">
              <h1>{formatIssueReportTitle(issue)}</h1>
              <span className="report-editor-pill">报数单</span>
            </div>
            <div className="report-editor-title-meta">
              <span>出版日期 {issue.publish_date}</span><i>·</i>
              <span>人民日报印厂</span><i>·</i>
              {issue.planned_page_count != null && (
                <><span>计划 <b>{issue.planned_page_count}</b> 版</span><i>·</i></>
              )}
              <label className="report-editor-page-count">
                实际
                {isConfirmed ? (
                  <b>{issue.page_count ?? 24}</b>
                ) : (
                  <InputNumber
                    aria-label="实际版数"
                    controls
                    size="small"
                    value={issue.page_count ?? 24}
                    min={4}
                    step={4}
                    precision={0}
                    onChange={(value) => {
                      if (value && value !== issue.page_count) {
                        updateIssue(Number(issueId), { page_count: value }).then(() => {
                          queryClient.invalidateQueries({ queryKey: ['issue', issueId] });
                        });
                      }
                    }}
                  />
                )}
                版
              </label>
              {issue.planned_page_count != null && issue.page_count !== issue.planned_page_count && (
                <span className="report-editor-page-warning"><WarningOutlined />版数与计划不一致</span>
              )}
              <i>·</i><span>最后更新 {updatedAt}</span>
            </div>
          </div>
          <div className="report-editor-title-actions">
            <span className={`report-editor-status ${isConfirmed ? 'is-confirmed' : ''}`}>
              {isConfirmed ? '已确认' : '待确认'}
            </span>
            {isConfirmed && (
              <Button type="primary" icon={<SendOutlined />} onClick={() => navigate(`/shipping/${issueId}`)}>发货</Button>
            )}
            {isConfirmed && isAdmin && (
              <Button danger icon={<UndoOutlined />} onClick={() => setRevokeModalVisible(true)}>作废</Button>
            )}
            <Button icon={<DownloadOutlined />} onClick={handleExport}>导出</Button>
            {isConfirmed && (
              <IssueDeleteConfirmButton
                issueNumber={issue.issue_number}
                onConfirm={handleDeleteIssue}
                buttonProps={{ size: 'middle' }}
              />
            )}
          </div>
        </header>

        <div className="report-editor-body">
          {shippingMismatch && shippingCheck && (
            <div className="report-editor-notice">
              <WarningOutlined />
              <span>
                <b>中通份数待核对：</b>
                报数合计 {formatCount(shippingCheck.report_zt_total)} 份，
                {shippingCheck.shipping_total === 0
                  ? '发货明细尚未生成'
                  : `发货明细合计 ${formatCount(shippingCheck.shipping_total)} 份，差值 ${formatCount(shippingCheck.delta)} 份`}
                ；确认前需完成校验。
              </span>
            </div>
          )}

          <div className="report-editor-work-grid">
            <div className="report-editor-main-column">
              {tempEntry && (
                <section className="report-editor-section">
                  <div className="report-editor-section-head">
                    <span className="report-editor-section-icon" aria-hidden="true">🖨️</span>
                    <h2>临时加印与分配</h2>
                    <span className="report-editor-pill is-orange">变动项</span>
                    <strong className="report-editor-section-total">合计 {formatCount(tempEntry.value)} 份</strong>
                  </div>
                  <div className="report-editor-field-grid">
                    <div className="report-editor-field">
                      <label>临时加印总数</label>
                      {isConfirmed ? renderReadOnlyField(tempEntry.value, '临时加印总数') : (
                        <div className="report-editor-editable-count">
                          <InputNumber
                            aria-label="临时加印总数"
                            className="report-editor-wide-input"
                            controls={false}
                            value={tempEntry.value}
                            onChange={(value) => handleValueChange(tempEntry.id, value ?? undefined)}
                            min={0}
                            precision={0}
                          />
                          <span>份</span>
                        </div>
                      )}
                    </div>
                    <div className="report-editor-field">
                      <label>自留分发</label>
                      {tempDetails.length > 0 || isConfirmed || !tempSelfEntry
                        ? renderReadOnlyField(tempSelfValue, '自留分发')
                        : (
                          <div className="report-editor-editable-count">
                            <InputNumber
                              aria-label="自留分发"
                              className="report-editor-wide-input"
                              controls={false}
                              value={tempSelfEntry.value}
                              onChange={(value) => handleValueChange(tempSelfEntry.id, value ?? undefined)}
                              min={0}
                              max={tempEntry.value}
                              precision={0}
                            />
                            <span>份</span>
                          </div>
                        )}
                    </div>
                    <div className="report-editor-field">
                      <label>北京快递</label>
                      {renderReadOnlyField(tempExpressDisplayValue, '北京快递')}
                    </div>
                  </div>

                  {tempEntry.value > 0 && (
                    <div className="report-editor-temp-details">
                      <div className="report-editor-temp-details-head">
                        <span><b>＋</b>{tempDetails.length > 0 ? '归属明细' : '尚无归属明细；需要按部门归属时，点击“添加”。'}</span>
                        {!isConfirmed && <Button size="small" icon={<PlusOutlined />} onClick={handleAddTempDetail}>添加</Button>}
                      </div>
                      {tempDetails.length > 0 && (
                        <div className="report-editor-table-scroll">
                          <table className="report-editor-temp-table">
                            <thead><tr><th>部门</th><th>份数</th><th>自留</th><th>快递</th>{!isConfirmed && <th>操作</th>}</tr></thead>
                            <tbody>
                              {tempDetails.map((detail, index) => (
                                <tr key={detail.id ?? index}>
                                  <td>
                                    {isConfirmed ? (
                                      detail.department === '其他' ? (detail.custom_name || '其他') : detail.department
                                    ) : (
                                      <div className="report-editor-department-control">
                                        <Select
                                          size="small"
                                          value={detail.department}
                                          options={DEPARTMENT_OPTIONS}
                                          onChange={(value) => handleTempDetailChange(index, 'department', value)}
                                        />
                                        {detail.department === '其他' && (
                                          <Input
                                            size="small"
                                            aria-label={`第${index + 1}条自定义部门名称`}
                                            placeholder="名称"
                                            value={detail.custom_name || ''}
                                            onChange={(event) => handleTempDetailChange(index, 'custom_name', event.target.value)}
                                          />
                                        )}
                                      </div>
                                    )}
                                  </td>
                                  <td>{isConfirmed ? detail.quantity : <InputNumber size="small" aria-label={`第${index + 1}条份数`} controls={false} value={detail.quantity} min={0} precision={0} onChange={(value) => handleTempDetailChange(index, 'quantity', value ?? 0)} />}</td>
                                  <td>{isConfirmed ? detail.self_quantity : <InputNumber size="small" aria-label={`第${index + 1}条自留`} controls={false} value={detail.self_quantity} min={0} max={detail.quantity} precision={0} onChange={(value) => handleTempDetailChange(index, 'self_quantity', value ?? 0)} />}</td>
                                  <td>{formatCount(detail.quantity - detail.self_quantity)}</td>
                                  {!isConfirmed && <td><Button size="small" type="text" danger aria-label={`删除第${index + 1}条归属明细`} icon={<DeleteOutlined />} onClick={() => handleRemoveTempDetail(index)} /></td>}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </section>
              )}

              <section className="report-editor-section">
                <div className="report-editor-section-head">
                  <span className="report-editor-section-icon" aria-hidden="true">📦</span>
                  <h2>发行渠道报数</h2>
                  <small>完整保留全部类别与项目，点击组头可收起</small>
                  <strong className="report-editor-section-total">{formatCount(channelTotal)} 份</strong>
                </div>
                <div className="report-editor-channels">
                  {sortedCategories.filter(category => category !== 'social_use').map(category => {
                    const categoryEntries = groupedEntries[category];
                    const frequency = categoryFrequency[category];
                    const categoryTotal = calculateCategoryTotal(categoryEntries);
                    const categorySourceSummary = sourceChannelSummaries[category];
                    const adjustmentDelta = categorySourceSummary?.settlement_delta ?? 0;
                    return (
                      <details className="report-editor-channel" open key={category}>
                        <summary>
                          <span className="report-editor-chevron">⌄</span>
                          <strong>{categoryLabels[category]}</strong>
                          {frequency && <span className={`report-editor-pill ${frequency === '每周' ? '' : 'is-orange'}`}>{frequency}</span>}
                          {category === 'chengdu' && adjustmentDelta !== 0 && (
                            <span className="report-editor-pill is-orange">
                              后续 {adjustmentDelta > 0 ? '+' : ''}{formatCount(adjustmentDelta)}
                            </span>
                          )}
                          <small>{categoryEntries.length} 个项目</small>
                          <b>{formatCount(categoryTotal)} 份</b>
                        </summary>
                        <div className="report-editor-channel-body">
                          {categoryEntries.map(entry => renderMiniField(entry))}
                          {category === 'chengdu' && categorySourceSummary && (
                            categorySourceSummary.settlement_delta !== 0 || categorySourceSummary.shipping_delta > 0
                          ) && (
                            <div className="report-editor-source-adjustment-strip">
                              <span><small>锁定印数</small><b>{formatCount(categoryTotal)} 份</b></span>
                              <span><small>结算数量</small><b>{formatCount(categorySourceSummary.settlement_total)} 份</b></span>
                              <span><small>补发待发</small><b>{formatCount(categorySourceSummary.pending_shipping)} 份</b></span>
                            </div>
                          )}
                        </div>
                      </details>
                    );
                  })}

                  {groupedEntries.social_use && (
                    <details className="report-editor-channel" open>
                      <summary>
                        <span className="report-editor-chevron">⌄</span>
                        <strong>社用报</strong>
                        <span className="report-editor-pill">完整 {socialItemCount} 项</span>
                        <small>含 2 个自动合计组与合订本</small>
                        <b>{formatCount(socialTotal)} 份</b>
                      </summary>
                      <div className="report-editor-channel-body is-social">
                        {renderCompositeGroup(COMPOSITE_GROUPS[0])}
                        {mainSocialEntries.length > 0 && (
                          <div className="report-editor-social-group">
                            <div className="report-editor-social-head">
                              <span>社用报常规项目</span>
                              <span className="report-editor-pill">{mainSocialEntries.length} 个项目</span>
                              <strong>{formatCount(mainSocialEntries.reduce((sum, entry) => sum + entry.value, 0))} 份</strong>
                            </div>
                            <div className="report-editor-social-grid">
                              {mainSocialEntries.map(entry => renderMiniField(entry))}
                            </div>
                          </div>
                        )}
                        {renderCompositeGroup(COMPOSITE_GROUPS[1])}
                        {bindingEntries.length > 0 && (
                          <div className="report-editor-social-group">
                            <div className="report-editor-social-head">
                              <span>合订本</span>
                              <span className="report-editor-pill is-orange">固定项</span>
                              <strong>{formatCount(bindingEntries.reduce((sum, entry) => sum + entry.value, 0))} 份</strong>
                            </div>
                            <div className="report-editor-social-grid">
                              {bindingEntries.map(entry => renderMiniField(entry))}
                            </div>
                          </div>
                        )}
                      </div>
                    </details>
                  )}
                </div>
              </section>
            </div>

            <div className="report-editor-side-column">
              <aside className="report-editor-section report-editor-summary">
                <div className="report-editor-section-head">
                  <span className="report-editor-section-icon" aria-hidden="true">∑</span>
                  <h2>本期汇总</h2>
                  <span className="report-editor-pill">实时</span>
                </div>
                <div className="report-editor-summary-total">
                  <small>当前总印数</small>
                  <strong>{formatCount(total)}</strong><span>份</span>
                </div>
                {destinationSummary.length > 0 && (
                  <ul className="report-editor-summary-list">
                    {destinationSummary.map(item => (
                      <li key={item.destination}><span>{item.destination}</span><b>{formatCount(item.total)} 份</b></li>
                    ))}
                  </ul>
                )}
                {shippingCheck && (
                  <div className={`report-editor-check-card ${shippingCheck.is_match ? 'is-success' : ''}`}>
                    <strong>{shippingCheck.is_match ? '✓ 中通份数一致' : '⚠ 1 项待处理'}</strong>
                    {shippingCheck.is_match
                      ? `报数与发货明细均为 ${formatCount(shippingCheck.report_zt_total)} 份。`
                      : `中通报数与发货明细存在 ${formatCount(Math.abs(shippingCheck.delta))} 份差值，完成发货明细后即可确认。`}
                  </div>
                )}
                <div className="report-editor-progress">
                  <div><span>报数项目完整度</span><b>{completionPercent}%</b></div>
                  <span><i style={{ width: `${completionPercent}%` }} /></span>
                </div>
              </aside>

              <aside className="report-editor-section report-editor-sources">
                <div className="report-editor-section-head">
                  <span className="report-editor-section-icon" aria-hidden="true"><PaperClipOutlined /></span>
                  <h2>数据来源与调整</h2>
                  {sourcePendingCount > 0
                    ? <span className="report-editor-pill is-orange">{sourcePendingCount} 项待处理</span>
                    : <span className="report-editor-pill">已关联 {sourceSummary?.document_count ?? 0} 份</span>}
                </div>
                {sourceLoading ? (
                  <div className="report-editor-source-loading"><Spin size="small" /></div>
                ) : (
                  <div className="report-editor-source-groups">
                    {sourceChannels.map(channel => {
                      const state = sourceStateForChannel(channel);
                      return (
                        <div className="report-editor-source-group" key={channel}>
                          <div className="report-editor-source-group-head">
                            <strong>{categoryLabels[channel]}</strong>
                            <StatusPill tone={state.tone}>{state.label}</StatusPill>
                            <Button type="link" size="small" onClick={() => openSourceDrawer(channel)}>
                              {state.documents.length > 0 ? '追加' : '上传'}
                            </Button>
                          </div>
                          {state.documents.length > 0 ? (
                            <div className="report-editor-source-files">
                              {state.documents.map(document => (
                                <div key={document.id}>
                                  <button
                                    type="button"
                                    onClick={() => { void handleSourceDownload(document.id, document.original_filename); }}
                                    title={`下载 ${document.original_filename}`}
                                  >
                                    <FileSearchOutlined />
                                    <span>{document.display_name}</span>
                                    <small>{Math.max(1, Math.round(document.size / 1024))} KB</small>
                                  </button>
                                  {document.items.some(item => item.source_status !== 'confirmed') && (
                                    <Button size="small" type="link" onClick={() => openSourceReview(document)}>核对</Button>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <small className="report-editor-source-empty">尚未关联本期原始文件</small>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {sourceAdjustmentItems.length > 0 && (
                  <div className="report-editor-adjustment-list">
                    <strong>补发执行</strong>
                    {sourceAdjustmentItems.map(item => (
                      <div key={item.id}>
                        <span>{item.source_label || '成都杂志铺补发'}</span>
                        <small>应发 {item.shipping_delta} · 已发 {item.shipped_quantity}</small>
                        <Button size="small" onClick={() => openShippingModal(item)}>登记</Button>
                      </div>
                    ))}
                  </div>
                )}
                <Button
                  block
                  className="report-editor-source-primary"
                  icon={<PaperClipOutlined />}
                  onClick={() => openSourceDrawer('postal')}
                >
                  上传原始来源 / 补发凭证
                </Button>
              </aside>
            </div>
          </div>

          {confirmationSummary && (
            <section className="report-editor-section report-editor-trace">
              <div className="report-editor-section-head">
                <span className="report-editor-section-icon" aria-hidden="true">✓</span>
                <h2>中通校验追溯</h2>
                <span className={`report-editor-pill ${confirmationSummary.confirmed_is_match ? '' : 'is-orange'}`}>确认时{confirmationSummary.confirmed_is_match ? '一致' : '不一致'}</span>
                <span className={`report-editor-pill ${confirmationSummary.current_is_match ? '' : 'is-orange'}`}>当前{confirmationSummary.current_is_match ? '一致' : '不一致'}</span>
                {confirmationSummary.has_shipping_drift && <span className="report-editor-pill is-orange">确认后明细已变更</span>}
              </div>
              <div className="report-editor-trace-grid">
                <div><small>确认时快照</small><span>报数中通：{formatCount(confirmationSummary.confirmed_report_total)} 份</span><span>发货明细：{formatCount(confirmationSummary.confirmed_shipping_total)} 份</span><span>差值：{formatCount(confirmationSummary.confirmed_delta)} 份</span></div>
                <div><small>当前中通明细</small><span>当前发货明细：{formatCount(confirmationSummary.current_shipping_total)} 份</span><span>相对报数差值：{formatCount(confirmationSummary.current_delta)} 份</span><span>{confirmationSummary.has_shipping_drift ? '当前数量已偏离确认快照' : '当前数量与确认快照一致'}</span></div>
              </div>
            </section>
          )}

          {revisions && revisions.length > 0 && (
            <section className="report-editor-section report-editor-revisions">
              <div className="report-editor-section-head">
                <span className="report-editor-section-icon" aria-hidden="true">↺</span>
                <h2>变更历史</h2>
                <span className="report-editor-pill">共 {revisions.length} 次作废</span>
              </div>
              <Timeline>
                {revisions.map((revision: RevisionRecord) => (
                  <Timeline.Item key={revision.id} label={revision.revoked_at?.replace('T', ' ').slice(0, 16)}>
                    <div className="report-editor-revision-item">
                      <strong>第 {revision.revision_number} 次作废</strong>
                      <span>操作人：{revision.operator}</span>
                      {revision.reason && <div>原因：{revision.reason}</div>}
                    </div>
                  </Timeline.Item>
                ))}
              </Timeline>
            </section>
          )}
        </div>

        <footer className="report-editor-footer">
          <span className={`report-editor-save-tip ${saveStatus === 'error' ? 'is-error' : ''}`}>
            <b>{saveStatus === 'saving' ? '…' : saveStatus === 'error' ? '!' : '✓'}</b>
            {isConfirmed && '报数已确认，数据已锁定'}
            {!isConfirmed && saveStatus === 'saving' && '正在自动保存…'}
            {!isConfirmed && saveStatus === 'saved' && '已自动保存'}
            {!isConfirmed && saveStatus === 'error' && '保存失败，请重试'}
            {!isConfirmed && saveStatus === 'idle' && '修改自动暂存；确认后将锁定报数数据'}
          </span>
          {!isConfirmed && (
            <>
              <Button className="report-editor-save-button" loading={saveStatus === 'saving'} onClick={() => { void doSave(); }}>保存草稿</Button>
              <Button
                type="primary"
                icon={<CheckOutlined />}
                loading={saving}
                onClick={() => {
                  if (window.confirm('确认后将无法再修改，是否继续？')) handleConfirm();
                }}
              >
                确认报数
              </Button>
            </>
          )}
        </footer>
      </section>

      <Modal
        title="作废确认"
        open={revokeModalVisible}
        onOk={() => { handleRevoke(); }}
        onCancel={() => setRevokeModalVisible(false)}
        confirmLoading={revoking}
        okText="确认作废"
        cancelText="取消"
        okButtonProps={{ danger: true }}
      >
        <p className="report-editor-revoke-copy">作废后该期报数将恢复为可编辑状态，此操作将被记录。</p>
        <Input.TextArea
          placeholder="作废原因（可选）"
          value={revokeReason}
          onChange={(event) => setRevokeReason(event.target.value)}
          autoSize={{ minRows: 2 }}
        />
      </Modal>

      <Drawer
        title={(
          <DrawerTitle
            icon="📎"
            title="原始来源文件与识别"
            description={`第 ${issue.issue_number} 期 · 文件先归档，再由你确认识别结果`}
            tone="info"
            status={(
              <StatusPill tone={sourcePreview ? 'warning' : 'neutral'}>
                {sourcePreview ? 'OCR待核对' : '等待上传'}
              </StatusPill>
            )}
          />
        )}
        open={sourceDrawerOpen}
        onClose={() => {
          setSourceDrawerOpen(false);
          resetSourceDrawer();
        }}
        size={720}
        rootClassName="app-drawer-root report-source-drawer-root"
        footer={(
          <div className="app-drawer-footer">
            <span className="app-drawer-footer-tip">
              <b>✓</b>
              {sourcePreview
                ? '只有人工确认后的数据才会写入；待确认值会继续提醒'
                : '支持 PDF、JPG、JPEG、PNG，原文件只归档一份'}
            </span>
            <Button onClick={() => {
              setSourceDrawerOpen(false);
              resetSourceDrawer();
            }}>关闭</Button>
            {sourcePreview ? (
              <Button type="primary" loading={sourceConfirming} onClick={() => { void handleSourceConfirm(); }}>
                确认识别与映射
              </Button>
            ) : (
              <Button
                type="primary"
                loading={sourceUploading}
                disabled={!sourceFile}
                onClick={() => { void handleSourceUpload(); }}
              >
                上传并识别
              </Button>
            )}
          </div>
        )}
      >
        <div className="report-source-drawer">
          {(!sourcePreview || sourceFile) && <section className="report-source-panel">
            <h3><span aria-hidden>①</span>来源类型</h3>
            <div className="report-source-type-grid">
              <label>
                渠道
                <Select<ReportSourceChannel>
                  value={sourceChannel}
                  disabled={Boolean(sourcePreview)}
                  options={sourceChannels.map(channel => ({ value: channel, label: categoryLabels[channel] }))}
                  onChange={handleSourceChannelChange}
                />
              </label>
              <label>
                文件用途
                <Select<ReportSourceDocumentType>
                  value={sourceDocumentType}
                  disabled={Boolean(sourcePreview)}
                  options={[
                    { value: 'weekly', label: '每周原始报数' },
                    { value: 'monthly', label: '每月整月报数' },
                    { value: 'adjustment', label: '后续补发 / 冲减凭证' },
                  ]}
                  onChange={value => {
                    setSourceDocumentType(value);
                    setSourcePreview(null);
                    setSourceSuggestions([]);
                  }}
                />
              </label>
            </div>
          </section>}

          <section className="report-source-panel">
            <h3><span aria-hidden>②</span>上传原始文件</h3>
            <Upload.Dragger
              className="report-source-dragger"
              maxCount={1}
              accept=".pdf,.jpg,.jpeg,.png"
              showUploadList={false}
              disabled={Boolean(sourcePreview)}
              beforeUpload={file => {
                setSourceFile(file);
                setSourcePreview(null);
                setSourceSuggestions([]);
                return false;
              }}
            >
              {sourceFile ? (
                <div className="report-source-selected-file">
                  <PaperClipOutlined />
                  <strong title={sourceFile.name}>{sourceFile.name}</strong>
                  <small>{sourcePreview ? '文件已上传并归档' : '点击或拖拽文件可重新选择'}</small>
                </div>
              ) : (
                <>
                  <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                  <p className="ant-upload-text">点击或拖拽当期来源文件</p>
                  <p className="ant-upload-hint">上传后自动识别数字、日期和刊期；原文件同步归档</p>
                </>
              )}
            </Upload.Dragger>
          </section>

          {sourcePreview && (
            <section className="report-source-panel">
              <div className="report-source-review-head">
                <h3><span aria-hidden>③</span>核对识别结果</h3>
                <div className="report-source-review-actions">
                  {sourcePreview.extraction_status === 'pending_review' && (
                    <Button
                      size="small"
                      danger
                      icon={<UndoOutlined />}
                      onClick={() => {
                        Modal.confirm({
                          title: '重新上传来源文件？',
                          content: '当前错误文件和识别结果将从本期归档中移除。',
                          okText: '移除并重新选择',
                          cancelText: '取消',
                          okButtonProps: { danger: true },
                          onOk: handleSourceReupload,
                        });
                      }}
                    >
                      重新上传
                    </Button>
                  )}
                  <Button size="small" icon={<PlusOutlined />} onClick={addSourceSuggestion}>人工补录</Button>
                </div>
              </div>
              <div className="report-source-file-meta">
                <PaperClipOutlined />
                <span>{sourcePreview.display_name}</span>
                <small>原名：{sourcePreview.original_filename}</small>
              </div>
              {(sourcePreview.extraction_json?.warnings?.length ?? 0) > 0 && (
                <Alert
                  type="warning"
                  showIcon
                  title="识别结果需要重点核对"
                  description={(
                    <ul>
                      {sourcePreview.extraction_json?.warnings?.map(warning => <li key={warning}>{warning}</li>)}
                    </ul>
                  )}
                />
              )}
              {sourceSuggestions.length === 0 ? (
                <Alert
                  type="warning"
                  showIcon
                  title="没有识别出结构化数字"
                  description="文件已经安全归档，请点击“人工补录”录入刊期和份数。"
                />
              ) : (
                <div className="report-source-review-list">
                  {sourceSuggestions.map((suggestion, index) => (
                    <div className="report-source-review-row" key={`${suggestion.source_period || suggestion.issue_number}-${suggestion.sub_category}-${index}`}>
                      <div className="report-source-review-row-head">
                        <strong>{suggestion.source_label || suggestion.sub_category}</strong>
                        {suggestion.confidence != null && (
                          <small>OCR {Math.round(suggestion.confidence * 100)}%</small>
                        )}
                        <Button
                          type="text"
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          aria-label={`删除第${index + 1}条来源明细`}
                          onClick={() => setSourceSuggestions(current => current.filter((_, rowIndex) => rowIndex !== index))}
                        />
                      </div>
                      <div className="report-source-review-fields">
                        <label>
                          对应期号
                          <InputNumber
                            controls={false}
                            precision={0}
                            value={suggestion.issue_number}
                            onChange={value => updateSourceSuggestion(index, 'issue_number', value)}
                          />
                        </label>
                        <label>
                          项目
                          <Input
                            value={suggestion.sub_category}
                            onChange={event => updateSourceSuggestion(index, 'sub_category', event.target.value)}
                          />
                        </label>
                        <label>
                          来源数字
                          <InputNumber
                            controls={false}
                            precision={0}
                            min={0}
                            value={suggestion.source_quantity}
                            onChange={value => updateSourceSuggestion(index, 'source_quantity', value)}
                          />
                        </label>
                        {suggestion.item_kind === 'base' ? (
                          <label>
                            写入份数
                            <InputNumber
                              controls={false}
                              precision={0}
                              min={0}
                              value={suggestion.applied_quantity}
                              onChange={value => updateSourceSuggestion(index, 'applied_quantity', value)}
                            />
                          </label>
                        ) : (
                          <label className="is-wide">
                            调整性质
                            <Select
                              value={suggestion.adjustment_kind}
                              options={adjustmentKindOptions}
                              onChange={value => updateSourceSuggestion(index, 'adjustment_kind', value)}
                            />
                          </label>
                        )}
                        <label className="is-wide">
                          核对状态
                          <Select
                            value={suggestion.source_status}
                            options={sourceStatusOptions}
                            onChange={value => updateSourceSuggestion(index, 'source_status', value)}
                          />
                        </label>
                      </div>
                      {suggestion.notes && <p>{suggestion.notes}</p>}
                    </div>
                  ))}
                </div>
              )}
              {sourcePreview.extraction_json?.raw_text && (
                <details className="report-source-raw-text">
                  <summary>查看 OCR 原始文字</summary>
                  <pre>{sourcePreview.extraction_json.raw_text}</pre>
                </details>
              )}
            </section>
          )}
        </div>
      </Drawer>

      <Modal
        title="登记补发执行"
        open={Boolean(shippingItem)}
        onCancel={() => setShippingItem(null)}
        onOk={() => { void handleShippingSave(); }}
        confirmLoading={shippingSaving}
        okText="保存登记"
        cancelText="取消"
      >
        {shippingItem && (
          <div className="report-source-shipping-form">
            <Alert
              type="info"
              showIcon
              title={shippingItem.source_label || '补发调整'}
              description={`应补发 ${shippingItem.shipping_delta} 份；结算变化 ${shippingItem.settlement_delta >= 0 ? '+' : ''}${shippingItem.settlement_delta} 份。`}
            />
            <label>
              已补发份数
              <InputNumber
                min={0}
                max={shippingItem.shipping_delta}
                precision={0}
                value={shippingQuantity}
                onChange={value => setShippingQuantity(value ?? 0)}
              />
            </label>
            <label>
              快递单号 / 备注
              <Input value={shippingTracking} onChange={event => setShippingTracking(event.target.value)} />
            </label>
          </div>
        )}
      </Modal>
    </div>
  );
}
