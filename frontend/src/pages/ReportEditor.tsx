import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  InputNumber,
  Button,
  Tag,
  Space,
  Spin,
  Message,
  Modal,
  Input,
  Timeline,
  Select,
} from '@arco-design/web-react';
import {
  IconCheck,
  IconDownload,
  IconArrowLeft,
  IconUndo,
  IconPlus,
  IconDelete,
} from '@arco-design/web-react/icon';
import { getIssue, updateIssue } from '../api/issues';
import type { ReportEntry, TempPrintDetail } from '../api/reports';
import { getReport, updateReport, confirmReport, revokeReport, getRevisions, getTempPrintDetails, updateTempPrintDetails } from '../api/reports';
import type { RevisionRecord } from '../api/reports';
import { useAuth } from '../contexts/AuthContext';

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
    label: '报社订阅自投/展示',
    prefix: '报社订阅_',
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
      setTempDetailsLoaded(true);
    }
  }, [tempDetailsData]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveTempDetails = useCallback(async (details: TempPrintDetail[]) => {
    if (!issueId) return;
    try {
      const res = await updateTempPrintDetails(Number(issueId), details);
      setTempDetails(res.data);
      queryClient.invalidateQueries({ queryKey: ['tempDetails', issueId] });
      queryClient.invalidateQueries({ queryKey: ['report', issueId] });
    } catch (err: any) {
      Message.error(err.response?.data?.detail || '保存明细失败');
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
    saveTempDetails(updated);
  };

  const handleRemoveTempDetail = (index: number) => {
    const updated = tempDetails.filter((_, i) => i !== index);
    setTempDetails(updated);
    saveTempDetails(updated);
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
    saveTempDetails(updated);
  };

  const handleRevoke = async () => {
    if (!issueId) return;
    setRevoking(true);
    try {
      await revokeReport(Number(issueId), revokeReason || undefined);
      Message.success('已作废，可重新编辑');
      setRevokeModalVisible(false);
      setRevokeReason('');
      setSaveStatus('idle');
      queryClient.invalidateQueries({ queryKey: ['issue', issueId] });
      queryClient.invalidateQueries({ queryKey: ['revisions', issueId] });
      queryClient.invalidateQueries({ queryKey: ['report', issueId] });
    } catch (err: any) {
      Message.error(err.response?.data?.detail || '作废失败');
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

  const handleValueChange = (entryId: number, value: number | undefined) => {
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

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
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
      await confirmReport(Number(issueId));
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['issues'] });
      queryClient.invalidateQueries({ queryKey: ['issue', issueId] });
      Message.success('确认成功');
      navigate('/');
    } catch (err: any) {
      const msg = err.response?.data?.detail;
      if (msg) {
        if (Array.isArray(msg)) {
          msg.forEach((e: any) => Message.error(e.msg || JSON.stringify(e)));
        } else {
          Message.error(String(msg));
        }
      } else {
        Message.error('确认失败：' + (err.message || '未知错误'));
      }
      console.error('Confirm failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleExport = () => {
    if (!issueId) return;
    window.open(`/api/issues/${issueId}/export/report`, '_blank');
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '100px 0' }}>
        <Spin size={40} />
      </div>
    );
  }

  if (!issue || entries.length === 0) {
    return <div style={{ padding: 24 }}>数据加载失败</div>;
  }

  const groupedEntries = groupEntriesByCategory();
  const sortedCategories = categoryOrder.filter(c => groupedEntries[c]);

  // Extract 临时加印 from social_use for prominent display at top
  const tempEntry = entries.find(e => e.category === 'social_use' && e.sub_category === '临时加印');
  const tempSelfEntry = entries.find(e => e.category === 'social_use' && e.sub_category === '临时加印_自留');
  const tempExpressValue = (tempEntry?.value ?? 0) - (tempSelfEntry?.value ?? 0);

  // Render value: plain text when confirmed, InputNumber when editing
  const renderValue = (entry: ReportEntry, opts?: { width?: number; size?: 'mini' | 'small' | 'default' | 'large' }) => {
    if (isConfirmed) {
      return (
        <span style={{ fontSize: opts?.size === 'large' ? 16 : 14, fontWeight: 500, color: '#1d1d1f' }}>
          {entry.value.toLocaleString()} 份
        </span>
      );
    }
    return (
      <InputNumber
        value={entry.value}
        onChange={(value) => handleValueChange(entry.id, value)}
        min={0}
        precision={0}
        style={{ width: opts?.width ?? 140 }}
        suffix="份"
        size={opts?.size}
      />
    );
  };

  // Render a single table row for an entry (used in social_use, spans first 2 columns)
  const renderEntryRow = (entry: ReportEntry, showTags?: { freq?: string }) => {
    const isExtra = EXTRA_ITEMS.includes(entry.sub_category);
    return (
      <tr
        key={entry.id}
        style={{
          borderBottom: '1px solid #f0f0f0',
          background: entry.is_variable ? 'rgba(0,113,227,0.02)' : 'transparent',
        }}
      >
        <td colSpan={2} style={{ padding: '8px 16px' }}>
          <Space size="small">
            <span style={{ fontSize: 14, color: isExtra ? '#424245' : '#1d1d1f' }}>
              {entry.sub_category}
            </span>
            {entry.is_variable && !isExtra && <Tag size="small" color="arcoblue">变动</Tag>}
            {showTags?.freq && entry.is_variable && !isExtra && (
              <Tag size="small" color="orangered">{showTags.freq}</Tag>
            )}
          </Space>
        </td>
        <td style={{ padding: '8px 16px', textAlign: 'right' }}>
          {renderValue(entry)}
        </td>
      </tr>
    );
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button
          icon={<IconArrowLeft />}
          onClick={() => navigate('/')}
          style={{ borderRadius: 8 }}
        />
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#1d1d1f' }}>
            2026年《中国经营报》第{issue.issue_number}期 报数表
          </h2>
          <Space size="medium" style={{ marginTop: 4 }}>
            <span style={{ fontSize: 13, color: '#86868b' }}>
              人民日报印厂 · 出版日期 {issue.publish_date}
            </span>
            <span style={{ fontSize: 13, color: '#86868b' }}>
              版数：{isConfirmed ? (
                <span style={{ color: '#1d1d1f', fontWeight: 500 }}>{issue.page_count ?? 24}</span>
              ) : (
                <InputNumber
                  size="mini"
                  value={issue.page_count ?? 24}
                  min={4}
                  step={4}
                  precision={0}
                  style={{ width: 64, display: 'inline-block' }}
                  onChange={(val) => {
                    if (val && val !== issue.page_count) {
                      updateIssue(Number(issueId), { page_count: val }).then(() => {
                        queryClient.invalidateQueries({ queryKey: ['issue', issueId] });
                      });
                    }
                  }}
                />
              )}
            </span>
          </Space>
        </div>
        <Space size="medium">
          {isConfirmed ? (
            <>
              <Tag color="green" size="large" style={{ fontSize: 13, padding: '4px 12px' }}>
                ✅ 已确认报数
              </Tag>
              {isAdmin && (
                <Button
                  type="outline"
                  status="warning"
                  icon={<IconUndo />}
                  onClick={() => setRevokeModalVisible(true)}
                >
                  作废
                </Button>
              )}
              <Button icon={<IconDownload />} onClick={handleExport}>
                导出
              </Button>
            </>
          ) : (
            <>
              {/* Auto-save status indicator */}
              <span style={{ fontSize: 13, color: saveStatus === 'error' ? '#f53f3f' : '#86868b' }}>
                {saveStatus === 'saving' && '⏳ 保存中...'}
                {saveStatus === 'saved' && '✅ 已自动保存'}
                {saveStatus === 'error' && '❌ 保存失败，请重试'}
              </span>
              <Button icon={<IconDownload />} onClick={handleExport}>
                导出
              </Button>
              <Button
                type="primary"
                icon={<IconCheck />}
                loading={saving}
                onClick={() => {
                  if (window.confirm('确认后将无法再修改，是否继续？')) {
                    handleConfirm();
                  }
                }}
              >
                确认报数
              </Button>
            </>
          )}
        </Space>
      </div>

      {/* Prominent 临时加印 at top */}
      {tempEntry && (
        <Card style={{ marginBottom: 20, border: '2px dashed #ff7d00' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Space size="small">
              <span style={{ fontSize: 16, fontWeight: 700, color: '#1d1d1f' }}>临时加印</span>
              <Tag size="small" color="orangered">变动</Tag>
            </Space>
            {renderValue(tempEntry, { width: 160, size: 'large' })}
          </div>
          {/* Allocation: 自留分发 vs 北京快递 */}
          {tempEntry.value > 0 && tempSelfEntry && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #f0f0f0', display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: '#86868b' }}>分配：</span>
              <Space size="small" style={{ alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: '#424245' }}>自留分发</span>
                {tempDetails.length > 0 ? (
                  <span style={{ fontSize: 14, fontWeight: 500, color: '#1d1d1f' }}>
                    {tempDetails.reduce((s, d) => s + d.self_quantity, 0).toLocaleString()} 份
                  </span>
                ) : isConfirmed ? (
                  <span style={{ fontSize: 14, fontWeight: 500, color: '#1d1d1f' }}>{tempSelfEntry.value.toLocaleString()} 份</span>
                ) : (
                  <InputNumber
                    value={tempSelfEntry.value}
                    onChange={(value) => handleValueChange(tempSelfEntry.id, value)}
                    min={0}
                    max={tempEntry.value}
                    precision={0}
                    style={{ width: 120 }}
                    suffix="份"
                    size="small"
                  />
                )}
              </Space>
              <Space size="small" style={{ alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: '#424245' }}>北京快递</span>
                <span style={{ fontSize: 14, fontWeight: 500, color: '#1d1d1f' }}>
                  {tempDetails.length > 0
                    ? (tempDetails.reduce((s, d) => s + d.quantity, 0) - tempDetails.reduce((s, d) => s + d.self_quantity, 0)).toLocaleString()
                    : tempExpressValue.toLocaleString()
                  } 份
                </span>
              </Space>
            </div>
          )}

          {/* 归属明细 detail table */}
          {tempEntry.value > 0 && (
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #f0f0f0' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#424245' }}>归属明细</span>
                {!isConfirmed && (
                  <Button
                    size="mini"
                    type="outline"
                    icon={<IconPlus />}
                    onClick={handleAddTempDetail}
                  >
                    添加
                  </Button>
                )}
              </div>
              {tempDetails.length > 0 && (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#fafafa', borderBottom: '1px solid #e8e8e8' }}>
                      <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 500, color: '#86868b' }}>部门</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 500, color: '#86868b' }}>份数</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 500, color: '#86868b' }}>自留</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 500, color: '#86868b' }}>快递</th>
                      {!isConfirmed && (
                        <th style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 500, color: '#86868b', width: 40 }}>操作</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {tempDetails.map((detail, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid #f0f0f0' }}>
                        <td style={{ padding: '6px 8px' }}>
                          {isConfirmed ? (
                            <span>{detail.department === '其他' ? (detail.custom_name || '其他') : detail.department}</span>
                          ) : (
                            <Space size="mini">
                              <Select
                                size="mini"
                                value={detail.department}
                                options={DEPARTMENT_OPTIONS}
                                onChange={(val) => handleTempDetailChange(idx, 'department', val)}
                                style={{ width: 100 }}
                              />
                              {detail.department === '其他' && (
                                <Input
                                  size="mini"
                                  placeholder="名称"
                                  value={detail.custom_name || ''}
                                  onChange={(val) => handleTempDetailChange(idx, 'custom_name', val)}
                                  style={{ width: 80 }}
                                />
                              )}
                            </Space>
                          )}
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                          {isConfirmed ? (
                            <span>{detail.quantity}</span>
                          ) : (
                            <InputNumber
                              size="mini"
                              value={detail.quantity}
                              onChange={(val) => handleTempDetailChange(idx, 'quantity', val ?? 0)}
                              min={0}
                              precision={0}
                              style={{ width: 80 }}
                            />
                          )}
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                          {isConfirmed ? (
                            <span>{detail.self_quantity}</span>
                          ) : (
                            <InputNumber
                              size="mini"
                              value={detail.self_quantity}
                              onChange={(val) => handleTempDetailChange(idx, 'self_quantity', val ?? 0)}
                              min={0}
                              max={detail.quantity}
                              precision={0}
                              style={{ width: 80 }}
                            />
                          )}
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: '#86868b' }}>
                          {detail.quantity - detail.self_quantity}
                        </td>
                        {!isConfirmed && (
                          <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                            <Button
                              size="mini"
                              type="text"
                              status="danger"
                              icon={<IconDelete />}
                              onClick={() => handleRemoveTempDetail(idx)}
                            />
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {tempDetails.length === 0 && !isConfirmed && (
                <span style={{ fontSize: 12, color: '#86868b' }}>暂无明细，点击"添加"按钮录入归属信息</span>
              )}
            </div>
          )}
        </Card>
      )}

      {/* Main report table */}
      <Card style={{ padding: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#fafafa', borderBottom: '1px solid #e5e5e5' }}>
              <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 13, color: '#86868b', fontWeight: 500 }}>
                类别
              </th>
              <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 13, color: '#86868b', fontWeight: 500 }}>
                项目
              </th>
              <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: 13, color: '#86868b', fontWeight: 500, width: 180 }}>
                份数
              </th>
            </tr>
          </thead>

          {sortedCategories.map((category) => {
            const allCategoryEntries = groupedEntries[category];
            const freq = categoryFrequency[category];

            // For social_use, handle composite groups, extras, and 临时加印 (shown at top)
            if (category === 'social_use') {
              // Include binding entries in social_use section
              const bindingEntries = groupedEntries['binding'] || [];
              const allSocialEntries = [...allCategoryEntries, ...bindingEntries];
              // Identify all sub_categories that belong to composite groups
              const compositeSubCategories = new Set<string>();
              COMPOSITE_GROUPS.forEach(g => g.items.forEach(i => compositeSubCategories.add(i)));

              const mainItems = allSocialEntries.filter(
                e => !EXTRA_ITEMS.includes(e.sub_category) &&
                     !compositeSubCategories.has(e.sub_category)
              );
              // All extra items are hidden (managed by temp print details or shown at top)
              const extraItems: ReportEntry[] = [];
              const subtotal = calculateCategoryTotal(allSocialEntries);

              // Render composite group (auto-summing sub-items)
              const renderCompositeGroup = (group: typeof COMPOSITE_GROUPS[0]) => {
                const groupEntries = entries.filter(e => group.items.includes(e.sub_category));
                const groupTotal = groupEntries.reduce((sum, e) => sum + e.value, 0);
                return (
                  <>
                    {/* Group header with auto-calculated total */}
                    <tr
                      key={`${group.label}-header`}
                      style={{ background: 'rgba(0,113,227,0.04)', borderBottom: '1px solid #e8e8e8' }}
                    >
                      <td colSpan={2} style={{ padding: '10px 16px' }}>
                        <Space size="small">
                          <span style={{ fontSize: 14, fontWeight: 600, color: '#1d1d1f' }}>
                            {group.label}
                          </span>
                          <Tag size="small" color="arcoblue">变动</Tag>
                          <span style={{ fontSize: 12, color: '#86868b' }}>
                            (自动合计)
                          </span>
                        </Space>
                      </td>
                      <td style={{ padding: '8px 16px', textAlign: 'right' }}>
                        <span style={{ fontSize: 15, fontWeight: 700, color: '#0071e3' }}>
                          {groupTotal} 份
                        </span>
                      </td>
                    </tr>
                    {/* Sub-items */}
                    {groupEntries.map(entry => (
                      <tr
                        key={entry.id}
                        style={{
                          borderBottom: '1px solid #f0f0f0',
                          background: 'rgba(0,113,227,0.01)',
                        }}
                      >
                        <td colSpan={2} style={{ padding: '6px 16px 6px 32px' }}>
                          <Space size="small">
                            <span style={{ fontSize: 13, color: '#424245' }}>
                              ├ {entry.sub_category.replace(group.prefix, '')}
                            </span>
                            {entry.is_variable && <Tag size="small" color="arcoblue">变动</Tag>}
                          </Space>
                        </td>
                        <td style={{ padding: '6px 16px', textAlign: 'right' }}>
                          {renderValue(entry, { width: 120, size: 'small' })}
                        </td>
                      </tr>
                    ))}
                  </>
                );
              };

              return (
                <tbody key={category}>
                  {/* Category header */}
                  <tr style={{ background: '#f5f5f7', borderBottom: '1px solid #e5e5e5' }}>
                    <td
                      colSpan={3}
                      style={{ padding: '10px 16px', fontWeight: 700, fontSize: 14, color: '#1d1d1f' }}
                    >
                      社用报
                    </td>
                  </tr>
                  {/* Composite: 营报传媒 */}
                  {renderCompositeGroup(COMPOSITE_GROUPS[0])}
                  {/* Regular main items */}
                  {mainItems.map(entry => renderEntryRow(entry))}
                  {/* Composite: 报社订阅自投/展示 (高铁展示) */}
                  {renderCompositeGroup(COMPOSITE_GROUPS[1])}
                  {/* Extra/加印 section */}
                  {extraItems.length > 0 && (
                    <>
                      <tr style={{ background: '#fafafa', borderTop: '1px solid #e5e5e5' }}>
                        <td
                          colSpan={3}
                          style={{ padding: '6px 16px', fontSize: 12, color: '#86868b', fontWeight: 500 }}
                        >
                          加印项
                        </td>
                      </tr>
                      {extraItems.map(entry => renderEntryRow(entry))}
                    </>
                  )}
                  {/* Subtotal */}
                  <tr style={{ borderBottom: '2px solid #e5e5e5', background: '#fafafa' }}>
                    <td colSpan={2} style={{ padding: '8px 16px', fontWeight: 600, fontSize: 13, color: '#424245' }}>
                      社用报小计
                    </td>
                    <td style={{ padding: '8px 16px', textAlign: 'right', fontWeight: 600, fontSize: 14, color: '#1d1d1f' }}>
                      {subtotal.toLocaleString()} 份
                    </td>
                  </tr>
                </tbody>
              );
            }

            // Single-item categories(chengdu, guotumao, binding)
            if (allCategoryEntries.length === 1) {
              const entry = allCategoryEntries[0];
              return (
                <tbody key={category}>
                  <tr style={{
                    borderBottom: '2px solid #e5e5e5',
                    background: entry.is_variable ? 'rgba(0,113,227,0.02)' : 'transparent',
                  }}>
                    <td colSpan={2} style={{ padding: '10px 16px', fontWeight: 600, fontSize: 14, color: '#1d1d1f' }}>
                      <Space size="small">
                        {categoryLabels[category]}
                        {entry.is_variable && <Tag size="small" color="arcoblue">变动</Tag>}
                        {freq && <Tag size="small" color="orangered">{freq}</Tag>}
                      </Space>
                    </td>
                    <td style={{ padding: '8px 16px', textAlign: 'right' }}>
                      {renderValue(entry)}
                    </td>
                  </tr>
                </tbody>
              );
            }

            // Multi-item categories (postal, retail, guangzhou)
            const subtotal = calculateCategoryTotal(allCategoryEntries);
            return (
              <tbody key={category}>
                {allCategoryEntries.map((entry, idx) => (
                  <tr
                    key={entry.id}
                    style={{
                      borderBottom: '1px solid #f0f0f0',
                      background: entry.is_variable ? 'rgba(0,113,227,0.02)' : 'transparent',
                    }}
                  >
                    {idx === 0 && (
                      <td
                        rowSpan={allCategoryEntries.length}
                        style={{
                          padding: '10px 16px',
                          fontWeight: 600,
                          fontSize: 14,
                          color: '#1d1d1f',
                          verticalAlign: 'middle',
                          borderRight: '1px solid #f0f0f0',
                          background: '#fafafa',
                        }}
                      >
                        {categoryLabels[category]}
                      </td>
                    )}
                    <td style={{ padding: '8px 16px' }}>
                      <Space size="small">
                        <span style={{ fontSize: 14 }}>{entry.sub_category}</span>
                        {entry.is_variable && <Tag size="small" color="arcoblue">变动</Tag>}
                        {freq && <Tag size="small" color="orangered">{freq}</Tag>}
                      </Space>
                    </td>
                    <td style={{ padding: '8px 16px', textAlign: 'right' }}>
                      {renderValue(entry)}
                    </td>
                  </tr>
                ))}
                <tr style={{ borderBottom: '2px solid #e5e5e5', background: '#fafafa' }}>
                  <td colSpan={2} style={{ padding: '8px 16px', fontWeight: 600, fontSize: 13, color: '#424245' }}>
                    {categoryLabels[category]}小计
                  </td>
                  <td style={{ padding: '8px 16px', textAlign: 'right', fontWeight: 600, fontSize: 14, color: '#1d1d1f' }}>
                    {subtotal.toLocaleString()} 份
                  </td>
                </tr>
              </tbody>
            );
          })}

          {/* Grand total */}
          <tfoot>
            <tr style={{ background: '#1d1d1f' }}>
              <td colSpan={2} style={{ padding: '12px 16px', fontWeight: 700, fontSize: 15, color: '#fff' }}>
                总印数
              </td>
              <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, fontSize: 16, color: '#fff' }}>
                {calculateTotal().toLocaleString()} 份
              </td>
            </tr>
          </tfoot>
        </table>
      </Card>

      {/* Revision History */}
      {revisions && revisions.length > 0 && (
        <Card style={{ marginTop: 24 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, color: '#1d1d1f' }}>
            变更历史（共 {revisions.length} 次作废）
          </h3>
          <Timeline>
            {revisions.map((rev: RevisionRecord) => (
              <Timeline.Item key={rev.id} label={rev.revoked_at?.replace('T', ' ').slice(0, 16)}>
                <div style={{ fontSize: 13 }}>
                  <strong>第 {rev.revision_number} 次作废</strong>
                  <span style={{ color: '#86868b', marginLeft: 8 }}>操作人：{rev.operator}</span>
                  {rev.reason && (
                    <div style={{ color: '#86868b', marginTop: 4 }}>原因：{rev.reason}</div>
                  )}
                </div>
              </Timeline.Item>
            ))}
          </Timeline>
        </Card>
      )}

      {/* Revoke Modal */}
      <Modal
        title="作废确认"
        visible={revokeModalVisible}
        onOk={() => { handleRevoke(); }}
        onCancel={() => setRevokeModalVisible(false)}
        confirmLoading={revoking}
        okText="确认作废"
        okButtonProps={{ status: 'warning' }}
      >
        <p style={{ marginBottom: 12, color: '#424245' }}>
          作废后该期报数将恢复为可编辑状态，此操作将被记录。
        </p>
        <Input.TextArea
          placeholder="作废原因（可选）"
          value={revokeReason}
          onChange={setRevokeReason}
          autoSize={{ minRows: 2 }}
        />
      </Modal>
    </div>
  );
}
