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
  Popconfirm,
  Message,
} from '@arco-design/web-react';
import {
  IconCheck,
  IconDownload,
  IconArrowLeft,
} from '@arco-design/web-react/icon';
import { getIssue, updateIssue } from '../api/issues';
import type { ReportEntry } from '../api/reports';
import { getReport, updateReport, confirmReport } from '../api/reports';

const categoryLabels: Record<string, string> = {
  postal: '北京邮发',
  retail: '北京报零',
  guangzhou: '广州日报',
  chengdu: '成都杂志铺',
  guotumao: '国图贸',
  social_use: '社用报',
  binding: '合订本',
};

// Display order (临时加印 extracted from social_use, shown at top separately)
const categoryOrder = ['postal', 'retail', 'guangzhou', 'chengdu', 'guotumao', 'social_use', 'binding'];

const categoryFrequency: Record<string, string> = {
  postal: '每周',
  retail: '每周',
  guangzhou: '每周',
  chengdu: '每月',
  guotumao: '每年',
};

// Items that are "加印" extras, grouped at bottom of social_use
const EXTRA_ITEMS = ['营报传媒加印', '财经中心加印', '中经未来', '产经中心加印', '临时加印'];

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

export default function ReportEditor() {
  const { issueId } = useParams<{ issueId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [entries, setEntries] = useState<ReportEntry[]>([]);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const entriesRef = useRef<ReportEntry[]>([]);
  const initialLoadRef = useRef(true);

  const { data: issue, isLoading: issueLoading } = useQuery({
    queryKey: ['issue', issueId],
    queryFn: async () => {
      const res = await getIssue(Number(issueId));
      return res.data;
    },
    enabled: !!issueId,
  });

  const { isLoading: reportLoading } = useQuery({
    queryKey: ['report', issueId],
    queryFn: async () => {
      const res = await getReport(Number(issueId));
      return res.data;
    },
    enabled: !!issueId,
    select: (data) => {
      if (entries.length === 0) {
        setEntries(data.entries);
        entriesRef.current = data.entries;
      }
      return data;
    },
  });

  const loading = issueLoading || reportLoading;

  // Auto-save: persist to server after 1.5s of no edits
  const doSave = useCallback(async () => {
    if (!issueId || entriesRef.current.length === 0) return;
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
    } catch {
      setSaveStatus('error');
    }
  }, [issueId, queryClient]);

  const handleValueChange = (entryId: number, value: number | undefined) => {
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
    return entries.reduce((sum, entry) => sum + entry.value, 0);
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
    return categoryEntries.reduce((sum, entry) => sum + entry.value, 0);
  };

  const handleConfirm = async () => {
    if (!issueId) return;
    // Flush any pending auto-save
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaving(true);
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
      if (err.response?.data?.detail) {
        const details = err.response.data.detail;
        if (Array.isArray(details)) {
          details.forEach((error: any) => {
            Message.error(error.msg || JSON.stringify(error));
          });
        } else {
          Message.error(details);
        }
      } else {
        Message.error('确认失败');
      }
      console.error(err);
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
          <InputNumber
            value={entry.value}
            onChange={(value) => handleValueChange(entry.id, value)}
            min={0}
            precision={0}
            style={{ width: 140 }}
            suffix="份"
          />
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
              版数：
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
            </span>
          </Space>
        </div>
        <Space size="medium">
          {/* Auto-save status indicator */}
          <span style={{ fontSize: 13, color: saveStatus === 'error' ? '#f53f3f' : '#86868b' }}>
            {saveStatus === 'saving' && '⏳ 保存中...'}
            {saveStatus === 'saved' && '✅ 已自动保存'}
            {saveStatus === 'error' && '❌ 保存失败，请重试'}
          </span>
          <Button icon={<IconDownload />} onClick={handleExport}>
            导出
          </Button>
          <Popconfirm
            title="确认报数"
            content="确认后将无法再修改，是否继续？"
            onOk={handleConfirm}
          >
            <Button type="primary" icon={<IconCheck />} loading={saving}>
              确认报数
            </Button>
          </Popconfirm>
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
            <InputNumber
              value={tempEntry.value}
              onChange={(value) => handleValueChange(tempEntry.id, value)}
              min={0}
              precision={0}
              style={{ width: 160 }}
              suffix="份"
              size="large"
            />
          </div>
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
              // Identify all sub_categories that belong to composite groups
              const compositeSubCategories = new Set<string>();
              COMPOSITE_GROUPS.forEach(g => g.items.forEach(i => compositeSubCategories.add(i)));

              const mainItems = allCategoryEntries.filter(
                e => !EXTRA_ITEMS.includes(e.sub_category) &&
                     !compositeSubCategories.has(e.sub_category)
              );
              const extraItems = allCategoryEntries.filter(
                e => EXTRA_ITEMS.includes(e.sub_category) && e.sub_category !== '临时加印'
              );
              const subtotal = calculateCategoryTotal(allCategoryEntries);

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
                          <InputNumber
                            value={entry.value}
                            onChange={(value) => handleValueChange(entry.id, value)}
                            min={0}
                            precision={0}
                            style={{ width: 120 }}
                            suffix="份"
                            size="small"
                          />
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
                      <InputNumber
                        value={entry.value}
                        onChange={(value) => handleValueChange(entry.id, value)}
                        min={0}
                        precision={0}
                        style={{ width: 140 }}
                        suffix="份"
                      />
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
                      <InputNumber
                        value={entry.value}
                        onChange={(value) => handleValueChange(entry.id, value)}
                        min={0}
                        precision={0}
                        style={{ width: 140 }}
                        suffix="份"
                      />
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
    </div>
  );
}
