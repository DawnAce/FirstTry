import { useEffect, useMemo, useState } from 'react';
import type { Key, ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  Select,
  Tag,
  Space,
  message,
  Drawer,
  Timeline,
  DatePicker,
  InputNumber,
  Popconfirm,
  Card,
  Tabs,
  Tooltip,
  Popover,
  Row,
  Col,
} from 'antd';
import {
  PlusOutlined,
  PauseCircleOutlined,
  CaretRightOutlined,
  SearchOutlined,
  DeleteOutlined,
  EditOutlined,
  HistoryOutlined,
  DownloadOutlined,
  FilterOutlined,
  LeftOutlined,
  RightOutlined,
  FileTextOutlined,
  InboxOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { TableColumnsType, TableProps } from 'antd';
import type { Recipient, Subscription } from '../api/recipients';
import type { ShippingDetail, ShippingDetailCreate, ShippingDetailUpdate } from '../api/shippingDetails';
import type { Issue } from '../api/issues';
import {
  getRecipients,
  createRecipient,
  updateRecipient,
  updateRecipientStatus,
  getSubscriptions,
  createSubscription,
} from '../api/recipients';
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
import { getIssues } from '../api/issues';
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

const typeLabels: Record<string, string> = { corporate: '对公', reader: '读者', sample: '样报' };
const typeColors: Record<string, string> = { corporate: 'blue', reader: 'green', sample: 'purple' };
const freqLabels: Record<string, string> = { weekly: '周', biweekly: '半月', monthly: '月' };
const statusLabels: Record<string, string> = { active: '正常', suspended: '停发' };
const statusColors: Record<string, string> = { active: 'green', suspended: 'red' };
const subTypeLabels: Record<string, string> = { new: '新订', renewal: '续订' };

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
  manual: { label: '手工', color: 'default' },
  order_generated: { label: '订单生成', color: 'blue' },
  historical_import: { label: '历史导入', color: 'default' },
};
const syncStatusMeta: Record<string, { label: string; color: string }> = {
  synced: { label: '已同步', color: 'green' },
  manually_modified: { label: '人工修改', color: 'orange' },
  orphaned: { label: '孤立', color: 'red' },
};
const issueStatusLabel: Record<string, string> = { draft: '草稿 · 尚未确认', confirmed: '已确认', exported: '已导出' };

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
}

function ShippingDetailsTab({ initialIssueId }: { initialIssueId?: number }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [shippingFilters, setShippingFilters] = useState<ShippingFilters>({});
  const [selectedIssueNumber, setSelectedIssueNumber] = useState<number>();
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<ShippingDetail | null>(null);
  const [form] = Form.useForm();
  const [logDrawerOpen, setLogDrawerOpen] = useState(false);
  const [logRecordId, setLogRecordId] = useState<number | null>(null);
  const [logRecordName, setLogRecordName] = useState<string>('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
  const [batchDeadline, setBatchDeadline] = useState<dayjs.Dayjs | null>(null);
  const [exporting, setExporting] = useState(false);
  const [clearingIssue, setClearingIssue] = useState(false);

  const { data: issues = [], isLoading: issuesLoading } = useQuery({
    queryKey: ['issues', 'shipping-details'],
    queryFn: async () => {
      const res = await getIssues(0, 100);
      return [...res.data].sort((a: Issue, b: Issue) => b.issue_number - a.issue_number);
    },
  });
  const currentIssue = useMemo(() => {
    if (selectedIssueNumber != null) {
      const selectedIssue = issues.find((issue) => issue.issue_number === selectedIssueNumber);
      if (selectedIssue) return selectedIssue;
    }
    return issues[0];
  }, [issues, selectedIssueNumber]);

  const currentIssueNumber = currentIssue?.issue_number;
  const currentIssueDate = currentIssue?.publish_date ? dayjs(currentIssue.publish_date) : null;

  const currentIdx = issues.findIndex((i) => i.issue_number === currentIssueNumber);
  const olderIssue = currentIdx >= 0 && currentIdx < issues.length - 1 ? issues[currentIdx + 1] : null;
  const newerIssue = currentIdx > 0 ? issues[currentIdx - 1] : null;

  useEffect(() => {
    if (initialIssueId == null || selectedIssueNumber != null || issues.length === 0) {
      return;
    }
    const matchedIssue = issues.find((issue) => issue.id === initialIssueId);
    if (matchedIssue) {
      setSelectedIssueNumber(matchedIssue.issue_number);
    }
  }, [initialIssueId, issues, selectedIssueNumber]);

  const selectIssue = (issueNumber: number) => {
    setSelectedIssueNumber(issueNumber);
    setShippingFilters((f) => ({ ...f, company: undefined }));
  };

  const handleIssueDateChange = (date: dayjs.Dayjs | null) => {
    if (!date) return;
    const issue = issues.find((item) => dayjs(item.publish_date).isSame(date, 'day'));
    if (!issue) {
      message.warning('该日期暂无已创建期数');
      return;
    }
    selectIssue(issue.issue_number);
  };

  const handleExportShipping = async () => {
    if (currentIssue?.id == null) {
      message.warning('请先选择期号');
      return;
    }
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

  const { data: details = [], isLoading } = useQuery({
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

  // Unfiltered per-issue list — powers the "记录数 / 渠道 / 签约公司" overview card
  // (kept separate from the filtered table query so filters don't skew the totals).
  const { data: allDetails = [] } = useQuery({
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

  const { data: report } = useQuery({
    queryKey: ['report', currentIssue?.id],
    queryFn: async () => {
      if (currentIssue?.id == null) return null;
      const res = await getReport(currentIssue.id);
      return res.data;
    },
    enabled: currentIssue?.id != null,
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
    setLogRecordId(record.id);
    setLogRecordName(record.name);
    setLogDrawerOpen(true);
  };

  const refreshShippingDetails = () => {
    queryClient.invalidateQueries({ queryKey: ['shippingDetails'] });
    queryClient.invalidateQueries({ queryKey: ['shippingDetailsAll'] });
    queryClient.invalidateQueries({ queryKey: ['shippingCompanies'] });
    queryClient.invalidateQueries({ queryKey: ['operationLogs'] });
    queryClient.invalidateQueries({ queryKey: ['report', currentIssue?.id] });
  };

  const handleEdit = (record: ShippingDetail) => {
    setEditingRecord(record);
    form.setFieldsValue({
      ...record,
      shipped_at: record.shipped_at ? dayjs(record.shipped_at) : null,
    });
    setModalVisible(true);
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteShippingDetail(id);
      message.success('删除成功');
      refreshShippingDetails();
    } catch {
      message.error('删除失败');
    }
  };

  const handleOpenCreate = () => {
    if (currentIssueNumber == null) {
      message.warning('请先选择期号');
      return;
    }
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
      const shipped_at = values.shipped_at ? dayjs(values.shipped_at).format('YYYY-MM-DD') : null;
      if (editingRecord) {
        const updateData: ShippingDetailUpdate = { ...values, shipped_at };
        await updateShippingDetail(editingRecord.id, updateData);
        message.success('更新成功');
      } else {
        if (currentIssueNumber == null) {
          message.warning('请先选择期号');
          return;
        }
        const createData: ShippingDetailCreate = {
          ...values,
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
      const res = await batchUpdateShippingDetails({
        ids: getSelectedIds(),
        updates: { status },
      });
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
    if (currentIssueNumber == null) {
      message.warning('请先选择期号');
      return;
    }
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

  const rowSelection: TableProps<ShippingDetail>['rowSelection'] = {
    selectedRowKeys,
    onChange: (keys) => setSelectedRowKeys(keys),
  };
  const confirmationSummary = report?.confirmation_summary;
  const currentShippingTotal = details.reduce((sum, detail) => sum + (detail.quantity ?? 0), 0);
  const check = report?.shipping_check;
  const allChannelCount = new Set(allDetails.map((d) => d.channel).filter(Boolean)).size;
  const allCompanyCount = new Set(allDetails.map((d) => d.company).filter(Boolean)).size;
  const advancedFilterCount = [shippingFilters.frequency, shippingFilters.transport, shippingFilters.sub_channel].filter(Boolean).length;

  const statCards: {
    icon: ReactNode; bg: string; label: string; value: ReactNode; suffix?: string;
    sub: string; cardClass?: string; valueColor?: string;
  }[] = [
    {
      icon: <FileTextOutlined style={{ fontSize: 21, color: 'var(--color-accent)' }} />,
      bg: 'rgba(0, 113, 227, 0.08)',
      label: '报数 · 中通合计',
      value: check ? check.report_zt_total.toLocaleString() : '—',
      suffix: check ? '份' : '',
      sub: '报数编辑页「中通物流公司」合计',
    },
    {
      icon: <InboxOutlined style={{ fontSize: 21, color: '#13c2c2' }} />,
      bg: 'rgba(19, 194, 194, 0.10)',
      label: '发货明细 · 合计',
      value: check ? check.shipping_total.toLocaleString() : currentShippingTotal.toLocaleString(),
      suffix: '份',
      sub: `本期 ${allDetails.length} 条明细求和`,
    },
    {
      icon: check
        ? (check.is_match
          ? <CheckCircleOutlined style={{ fontSize: 21, color: '#389e0d' }} />
          : <CloseCircleOutlined style={{ fontSize: 21, color: '#cf1322' }} />)
        : <CheckCircleOutlined style={{ fontSize: 21, color: '#86868b' }} />,
      bg: check ? (check.is_match ? 'rgba(82,196,26,.14)' : 'rgba(255,77,79,.12)') : 'rgba(0,0,0,.05)',
      label: '对账 · 差值',
      value: check ? (check.is_match ? '✓ 一致' : `✗ 差 ${Math.abs(check.delta).toLocaleString()} 份`) : '—',
      suffix: '',
      sub: check
        ? (check.is_match
          ? '报数与发货明细一致'
          : `报数 ${check.report_zt_total.toLocaleString()} / 发货 ${check.shipping_total.toLocaleString()}`)
        : '暂无报数校验',
      cardClass: check ? (check.is_match ? 'zto-stat--ok' : 'zto-stat--bad') : '',
      valueColor: check ? (check.is_match ? '#389e0d' : '#cf1322') : undefined,
    },
    {
      icon: <UnorderedListOutlined style={{ fontSize: 21, color: '#722ed1' }} />,
      bg: 'rgba(114, 46, 209, 0.08)',
      label: '记录数',
      value: allDetails.length.toLocaleString(),
      suffix: '条',
      sub: `${allChannelCount} 个渠道 · ${allCompanyCount} 家签约公司`,
    },
  ];

  const shippingColumns: TableColumnsType<ShippingDetail> = [
    {
      title: '姓名 / 渠道',
      dataIndex: 'name',
      key: 'name',
      render: (_: unknown, r: ShippingDetail) => (
        <div>
          <div style={{ fontWeight: 600 }}>{r.name}</div>
          <div style={{ marginTop: 2 }}>
            {r.channel ? <Tag color={channelColors[r.channel] || 'default'} style={{ marginInlineEnd: 4 }}>{r.channel}</Tag> : null}
            {r.sub_channel ? <Tag color={r.sub_channel === '监管' ? 'orange' : 'gold'} style={{ marginInlineEnd: 0 }}>{r.sub_channel}</Tag> : null}
          </div>
        </div>
      ),
    },
    { title: '签约公司', dataIndex: 'company', key: 'company', render: (v: string | null) => v || '—' },
    {
      title: '收件信息（地址 · 电话）',
      key: 'recv',
      render: (_: unknown, r: ShippingDetail) => (
        <div>
          <Tooltip title={r.address || ''}>
            <div className="zto-recv-addr">{r.address || '—'}</div>
          </Tooltip>
          <div className="zto-sub">{r.phone || '—'}</div>
        </div>
      ),
    },
    {
      title: '份数',
      dataIndex: 'quantity',
      key: 'quantity',
      align: 'right',
      width: 72,
      render: (v: number) => <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{v ?? '—'}</span>,
    },
    {
      title: '来源 · 同步',
      key: 'mark',
      width: 116,
      render: (_: unknown, r: ShippingDetail) => (
        <div className="zto-mark">
          <Tag color={sourceTypeMeta[r.source_type]?.color || 'default'}>{sourceTypeMeta[r.source_type]?.label || r.source_type}</Tag>
          <Tag color={syncStatusMeta[r.sync_status]?.color || 'default'}>{syncStatusMeta[r.sync_status]?.label || r.sync_status}</Tag>
        </div>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 84,
      render: (v: string) => (
        <span><span className="zto-status-dot" style={{ background: v === '正常' ? '#52c41a' : '#ff4d4f' }} />{v || '—'}</span>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 110,
      render: (_: unknown, record: ShippingDetail) => (
        <Space size="small">
          <Tooltip title="编辑">
            <Button type="text" size="small" icon={<EditOutlined style={{ color: '#1677ff' }} />} onClick={() => handleEdit(record)} />
          </Tooltip>
          <Popconfirm title="确认删除？" onConfirm={() => handleDelete(record.id)}>
            <Tooltip title="删除">
              <Button type="text" size="small" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
          <Tooltip title="操作日志">
            <Button type="text" size="small" icon={<HistoryOutlined />} onClick={() => handleShowLogs(record)} />
          </Tooltip>
        </Space>
      ),
    },
  ];

  const renderExpanded = (r: ShippingDetail) => {
    const deadlineText = (!r.deadline || r.deadline === '-' || r.deadline === '长期') ? '长期' : r.deadline;
    const station = [r.station_name, r.station_hall].filter(Boolean).join(' / ');
    const cells: { k: string; v: ReactNode }[] = [
      { k: '子渠道', v: r.sub_channel || '—' },
      { k: '频率', v: r.frequency || '—' },
      { k: '运输方式', v: r.transport ? <Tag color={transportColors[r.transport] || 'default'}>{r.transport}</Tag> : '—' },
      { k: '截止日期', v: deadlineText },
      { k: '发货时间', v: r.shipped_at ? dayjs(r.shipped_at).format('YYYY-MM-DD') : '—' },
      { k: '实发份数', v: r.shipped_quantity ?? '—' },
      { k: '快递单号', v: r.tracking_no || '—' },
      { k: '站点 / 站厅', v: station || '—' },
      { k: '联系人', v: r.contact_person || '—' },
      {
        k: '来源订单',
        v: r.order_id
          ? <a onClick={() => navigate(`/orders/${r.order_id}`)}>查看订单 #{r.order_id}</a>
          : '—',
      },
      { k: '备注', v: r.notes || '—' },
      { k: '附加信息', v: r.extra_info || '—' },
    ];
    return (
      <div className="zto-expand">
        {cells.map((c) => (
          <div className="zto-cell" key={c.k}>
            <div className="k">{c.k}</div>
            <div className="v">{c.v}</div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="zto-page">
      {/* 期次条 */}
      <div className="zto-issuebar">
        <Tooltip title={olderIssue ? `上一期 第 ${olderIssue.issue_number} 期` : '已是最早期'}>
          <Button className="zto-navib" icon={<LeftOutlined />} disabled={!olderIssue} onClick={() => olderIssue && selectIssue(olderIssue.issue_number)} />
        </Tooltip>
        <DatePicker
          allowClear={false}
          placeholder="出刊日期"
          style={{ width: 160 }}
          disabled={issues.length === 0}
          value={currentIssueDate}
          onChange={handleIssueDateChange}
        />
        <Select
          placeholder="期号"
          style={{ width: 220 }}
          loading={issuesLoading}
          disabled={issues.length === 0}
          value={currentIssueNumber}
          onChange={selectIssue}
        >
          {issues.map((issue) => (
            <Select.Option key={issue.id} value={issue.issue_number}>
              第 {issue.issue_number} 期（{dayjs(issue.publish_date).format('YYYY-MM-DD')}）
            </Select.Option>
          ))}
        </Select>
        <Tooltip title={newerIssue ? `下一期 第 ${newerIssue.issue_number} 期` : '已是最新期'}>
          <Button className="zto-navib" icon={<RightOutlined />} disabled={!newerIssue} onClick={() => newerIssue && selectIssue(newerIssue.issue_number)} />
        </Tooltip>
        {currentIssue && (
          <span className="zto-issue-status">{issueStatusLabel[currentIssue.status] || currentIssue.status}</span>
        )}
      </div>

      {/* 对账统计卡 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        {statCards.map((card, idx) => (
          <Col xs={12} md={6} key={idx} style={{ display: 'flex' }}>
            <Card className={`dashboard-stat-card ${card.cardClass || ''}`} size="small" style={{ flex: 1 }}>
              <div className="dashboard-stat-card-inner">
                <div className="dashboard-stat-icon" style={{ background: card.bg }}>{card.icon}</div>
                <div className="dashboard-stat-content">
                  <div className="dashboard-stat-label">{card.label}</div>
                  <div className="dashboard-stat-value" style={card.valueColor ? { color: card.valueColor } : undefined}>
                    {card.value}
                    {card.suffix && <span className="dashboard-stat-suffix"> {card.suffix}</span>}
                  </div>
                  <div className="dashboard-stat-sub">{card.sub}</div>
                </div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      {confirmationSummary && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
            <Space size="small" wrap>
              <span style={{ fontSize: 15, fontWeight: 600 }}>当期中通校验状态</span>
              <Tag color={confirmationSummary.confirmed_is_match ? 'green' : 'red'}>
                确认时{confirmationSummary.confirmed_is_match ? '一致' : '不一致'}
              </Tag>
              <Tag color={confirmationSummary.current_is_match ? 'green' : 'orange'}>
                当前{confirmationSummary.current_is_match ? '一致' : '不一致'}
              </Tag>
              {confirmationSummary.has_shipping_drift && (
                <Tag color="gold">确认后明细已变更</Tag>
              )}
            </Space>
            <span style={{ color: '#666', fontSize: 13 }}>
              当前页合计 {currentShippingTotal.toLocaleString()} 份
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <div style={{ padding: 12, borderRadius: 12, background: '#fafafa' }}>
              <div style={{ fontSize: 13, color: '#86868b', marginBottom: 6 }}>确认时快照</div>
              <div style={{ fontSize: 14, color: '#1d1d1f', lineHeight: 1.8 }}>
                <div>报数中通：{confirmationSummary.confirmed_report_total.toLocaleString()} 份</div>
                <div>发货明细：{confirmationSummary.confirmed_shipping_total.toLocaleString()} 份</div>
                <div>差值：{confirmationSummary.confirmed_delta.toLocaleString()} 份</div>
              </div>
            </div>
            <div style={{ padding: 12, borderRadius: 12, background: '#fafafa' }}>
              <div style={{ fontSize: 13, color: '#86868b', marginBottom: 6 }}>当前状态</div>
              <div style={{ fontSize: 14, color: '#1d1d1f', lineHeight: 1.8 }}>
                <div>当前发货明细：{confirmationSummary.current_shipping_total.toLocaleString()} 份</div>
                <div>相对报数差值：{confirmationSummary.current_delta.toLocaleString()} 份</div>
                <div>{confirmationSummary.has_shipping_drift ? '当前数量已偏离确认快照' : '当前数量与确认快照一致'}</div>
              </div>
            </div>
          </div>
        </Card>
      )}

      <Card styles={{ body: { padding: 0 } }}>
        <div className="zto-toolbar">
          <Select
            placeholder="渠道"
            style={{ width: 150 }}
            allowClear
            value={shippingFilters.channel}
            onChange={(value) => setShippingFilters((f) => ({ ...f, channel: value, sub_channel: undefined }))}
          >
            {CHANNEL_OPTIONS.map((ch) => (
              <Select.Option key={ch} value={ch}>{ch}</Select.Option>
            ))}
          </Select>
          <Select
            mode="multiple"
            placeholder="签约公司"
            style={{ width: 240, maxWidth: '100%' }}
            allowClear
            maxTagCount="responsive"
            value={shippingFilters.company}
            onChange={(value: string[]) => setShippingFilters((f) => ({ ...f, company: value }))}
          >
            {companyOptions.map((c) => (
              <Select.Option key={c} value={c}>{c}</Select.Option>
            ))}
          </Select>
          <Select
            placeholder="状态"
            style={{ width: 120 }}
            allowClear
            value={shippingFilters.status}
            onChange={(value) => setShippingFilters((f) => ({ ...f, status: value }))}
          >
            {SHIPPING_STATUS_OPTIONS.map((st) => (
              <Select.Option key={st} value={st}>{st}</Select.Option>
            ))}
          </Select>
          <Input
            placeholder="搜索姓名"
            prefix={<SearchOutlined />}
            style={{ width: 190 }}
            allowClear
            value={shippingFilters.search ?? ''}
            onChange={(e) => setShippingFilters((f) => ({ ...f, search: e.target.value }))}
          />
          <Popover
            trigger="click"
            placement="bottomLeft"
            title="更多筛选"
            content={
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: 200 }}>
                <Select
                  placeholder="频率"
                  style={{ width: '100%' }}
                  allowClear
                  value={shippingFilters.frequency}
                  onChange={(value) => setShippingFilters((f) => ({ ...f, frequency: value }))}
                >
                  {FREQUENCY_OPTIONS.map((fr) => (
                    <Select.Option key={fr} value={fr}>{fr}</Select.Option>
                  ))}
                </Select>
                <Select
                  placeholder="运输方式"
                  style={{ width: '100%' }}
                  allowClear
                  value={shippingFilters.transport}
                  onChange={(value) => setShippingFilters((f) => ({ ...f, transport: value }))}
                >
                  {TRANSPORT_OPTIONS.map((tr) => (
                    <Select.Option key={tr} value={tr}>{tr}</Select.Option>
                  ))}
                </Select>
                <Select
                  placeholder="子渠道"
                  style={{ width: '100%' }}
                  allowClear
                  value={shippingFilters.sub_channel}
                  onChange={(value) => setShippingFilters((f) => ({ ...f, sub_channel: value }))}
                >
                  {SUB_CHANNEL_OPTIONS.map((sc) => (
                    <Select.Option key={sc} value={sc}>{sc}</Select.Option>
                  ))}
                </Select>
              </div>
            }
          >
            <Button icon={<FilterOutlined />}>更多筛选{advancedFilterCount > 0 ? ` · ${advancedFilterCount}` : ''}</Button>
          </Popover>
          <div className="zto-toolbar-tail">
            <span className="zto-toolbar-count">
              共 <b>{details.length}</b> 条 · 合计 <b>{currentShippingTotal.toLocaleString()}</b> 份
            </span>
            <Button icon={<DownloadOutlined />} onClick={handleExportShipping} disabled={currentIssue?.id == null} loading={exporting}>
              导出
            </Button>
            {isAdmin && (
              <Popconfirm
                title={`确认清空第 ${currentIssueNumber ?? '-'} 期 ZTO-MF？`}
                description="只删除该期 ZTO-MF，不会删除期号和报数数据。此操作不可恢复。"
                okText="清空"
                cancelText="取消"
                onConfirm={handleClearCurrentIssueShippingDetails}
                disabled={currentIssueNumber == null}
              >
                <Button danger loading={clearingIssue} disabled={currentIssueNumber == null}>
                  清空本期
                </Button>
              </Popconfirm>
            )}
            <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenCreate}>
              新增
            </Button>
          </div>
        </div>

        {selectedRowKeys.length > 0 && (
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

        <Table
          loading={isLoading}
          columns={shippingColumns}
          dataSource={details}
          rowKey="id"
          rowSelection={rowSelection}
          expandable={{ expandedRowRender: renderExpanded }}
          pagination={{ pageSize: 20, showTotal: (total) => `共 ${total} 条记录` }}
        />
      </Card>

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
            <Select placeholder="请选择渠道">
              {CHANNEL_OPTIONS.map((ch) => (
                <Select.Option key={ch} value={ch}>{ch}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item noStyle dependencies={['channel']}>
            {({ getFieldValue }) =>
              getFieldValue('channel') === '赠阅' ? (
                <Form.Item label="子渠道" name="sub_channel">
                  <Select placeholder="请选择子渠道" allowClear>
                    {SUB_CHANNEL_OPTIONS.map((sc) => (
                      <Select.Option key={sc} value={sc}>{sc}</Select.Option>
                    ))}
                  </Select>
                </Form.Item>
              ) : null
            }
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
              {FREQUENCY_OPTIONS.map((fr) => (
                <Select.Option key={fr} value={fr}>{fr}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item label="运输方式" name="transport">
            <Select placeholder="请选择运输方式" allowClear>
              {TRANSPORT_OPTIONS.map((tr) => (
                <Select.Option key={tr} value={tr}>{tr}</Select.Option>
              ))}
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
              {SHIPPING_STATUS_OPTIONS.map((st) => (
                <Select.Option key={st} value={st}>{st}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item label="备注" name="notes">
            <Input.TextArea placeholder="请输入备注" rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={`操作日志 — ${logRecordName}`}
        open={logDrawerOpen}
        onClose={() => { setLogDrawerOpen(false); setLogRecordId(null); }}
        width={480}
      >
        {logsLoading ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>加载中...</div>
        ) : operationLogs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>暂无操作日志</div>
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
                      <span style={{ color: '#999', marginLeft: 8, fontSize: 12 }}>
                        {dayjs(log.created_at).format('YYYY-MM-DD HH:mm:ss')}
                      </span>
                    </div>
                    {log.action === 'update' && log.changes && (
                      <div style={{ fontSize: 13, color: '#555', marginTop: 4 }}>
                        {Object.entries(log.changes).map(([field, val]) => {
                          const v = val as { old: any; new: any };
                          return (
                            <div key={field} style={{ marginBottom: 2 }}>
                              <span style={{ color: '#888' }}>{fieldLabels[field] || field}：</span>
                              <span style={{ textDecoration: 'line-through', color: '#999' }}>{v.old ?? '空'}</span>
                              {' → '}
                              <span style={{ fontWeight: 500 }}>{v.new ?? '空'}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {log.action === 'create' && log.changes && (
                      <div style={{ fontSize: 13, color: '#555', marginTop: 4 }}>
                        {Object.entries(log.changes)
                          .filter(([, v]) => v != null && v !== '' && v !== 0)
                          .map(([field, v]) => (
                            <div key={field} style={{ marginBottom: 2 }}>
                              <span style={{ color: '#888' }}>{fieldLabels[field] || field}：</span>
                              <span>{String(v)}</span>
                            </div>
                          ))}
                      </div>
                    )}
                    {log.action === 'delete' && (
                      <div style={{ fontSize: 13, color: '#999', marginTop: 4 }}>记录已删除</div>
                    )}
                  </div>
                ),
              };
            })}
          />
        )}
      </Drawer>
    </div>
  );
}

export default function Recipients() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState<Record<string, any>>({});
  const activeTab = searchParams.get('tab') === 'recipients' ? 'recipients' : 'shipping';
  const issueIdParam = Number(searchParams.get('issueId'));
  const initialIssueId = Number.isFinite(issueIdParam) ? issueIdParam : undefined;

  // 顶栏全局搜索跳转到 /recipients?tab=recipients&search=xxx 时，一次性预填收件人姓名搜索：
  // 用掉后即从 URL 去掉 search，避免切 tab 反复覆盖用户后续输入。
  useEffect(() => {
    if (activeTab !== 'recipients') return;
    const s = searchParams.get('search');
    if (!s) return;
    setFilters((f) => ({ ...f, search: s }));
    const next = new URLSearchParams(searchParams);
    next.delete('search');
    setSearchParams(next, { replace: true });
  }, [activeTab, searchParams, setSearchParams]);

  // Create/Edit modal
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecipient, setEditingRecipient] = useState<Recipient | null>(null);
  const [form] = Form.useForm();

  // Subscription drawer
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [currentRecipient, setCurrentRecipient] = useState<Recipient | null>(null);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [subLoading, setSubLoading] = useState(false);

  // Subscription modal
  const [subModalVisible, setSubModalVisible] = useState(false);
  const [subForm] = Form.useForm();

  const { data: recipients = [], isLoading: loading } = useQuery({
    queryKey: ['recipients', filters],
    queryFn: async () => {
      const res = await getRecipients(filters);
      return res.data;
    },
  });

  const handleOpenModal = (recipient?: Recipient) => {
    setEditingRecipient(recipient || null);
    if (recipient) {
      form.setFieldsValue(recipient);
    } else {
      form.resetFields();
      form.setFieldsValue({ type: 'reader', frequency: 'weekly', status: 'active' });
    }
    setModalVisible(true);
  };

  const handleCloseModal = () => {
    setModalVisible(false);
    setEditingRecipient(null);
    form.resetFields();
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editingRecipient) {
        await updateRecipient(editingRecipient.id, values);
        message.success('更新成功');
      } else {
        await createRecipient(values);
        message.success('创建成功');
      }
      handleCloseModal();
      queryClient.invalidateQueries({ queryKey: ['recipients'] });
    } catch (error) {
      message.error('操作失败');
    }
  };

  const handleToggleStatus = async (recipient: Recipient) => {
    const newStatus = recipient.status === 'active' ? 'suspended' : 'active';
    try {
      await updateRecipientStatus(recipient.id, newStatus);
      message.success(newStatus === 'active' ? '已恢复发送' : '已停止发送');
      queryClient.invalidateQueries({ queryKey: ['recipients'] });
    } catch (error) {
      message.error('状态更新失败');
    }
  };

  const handleOpenDrawer = async (recipient: Recipient) => {
    setCurrentRecipient(recipient);
    setDrawerVisible(true);
    setSubLoading(true);
    try {
      const response = await getSubscriptions(recipient.id);
      setSubscriptions(response.data);
    } catch (error) {
      message.error('加载订阅记录失败');
    } finally {
      setSubLoading(false);
    }
  };

  const handleCloseDrawer = () => {
    setDrawerVisible(false);
    setCurrentRecipient(null);
    setSubscriptions([]);
  };

  const handleOpenSubModal = () => {
    subForm.resetFields();
    subForm.setFieldsValue({ type: 'renewal', quantity: 1 });
    setSubModalVisible(true);
  };

  const handleCloseSubModal = () => {
    setSubModalVisible(false);
    subForm.resetFields();
  };

  const handleSubmitSubscription = async () => {
    if (!currentRecipient) return;
    try {
      const values = await subForm.validateFields();
      const data = {
        ...values,
        start_date: values.start_date ? dayjs(values.start_date).format('YYYY-MM-DD') : undefined,
        end_date: values.end_date ? dayjs(values.end_date).format('YYYY-MM-DD') : undefined,
      };
      await createSubscription(currentRecipient.id, data);
      message.success('订阅创建成功');
      handleCloseSubModal();
      // Refresh subscriptions
      const response = await getSubscriptions(currentRecipient.id);
      setSubscriptions(response.data);
      // Refresh recipients list to update active_subscription_end
      queryClient.invalidateQueries({ queryKey: ['recipients'] });
    } catch (error) {
      message.error('订阅创建失败');
    }
  };

  const columns: TableColumnsType<Recipient> = [
    {
      title: '姓名',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      render: (type: string) => (
        <Tag color={typeColors[type]}>{typeLabels[type]}</Tag>
      ),
    },
    {
      title: '频率',
      dataIndex: 'frequency',
      key: 'frequency',
      render: (freq: string) => freqLabels[freq],
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Tag color={statusColors[status]}>{statusLabels[status]}</Tag>
      ),
    },
    {
      title: '订阅截止',
      dataIndex: 'active_subscription_end',
      key: 'active_subscription_end',
      render: (date: string | null) => date || '-',
    },
    {
      title: '电话',
      dataIndex: 'phone',
      key: 'phone',
      render: (phone: string | null) => phone || '-',
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: any, record: Recipient) => (
        <Space>
          <Button type="text" size="small" onClick={() => handleOpenModal(record)}>
            编辑
          </Button>
          <Button type="text" size="small" onClick={() => handleOpenDrawer(record)}>
            订阅
          </Button>
          <Popconfirm
            title={record.status === 'active' ? '确认停发？' : '确认恢复？'}
            onConfirm={() => handleToggleStatus(record)}
          >
            <Button
              type="text"
              size="small"
              danger={record.status === 'active'}
              icon={record.status === 'active' ? <PauseCircleOutlined /> : <CaretRightOutlined />}
            >
              {record.status === 'active' ? '停发' : '恢复'}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <h2 style={{
        fontSize: 24,
        fontWeight: 700,
        color: '#1d1d1f',
        margin: '0 0 24px 0',
        letterSpacing: '-0.02em',
      }}>
        物流管理 · {activeTab === 'recipients' ? '收件人' : 'ZTO-MF'}
      </h2>

      <Tabs
        activeKey={activeTab}
        tabBarStyle={{ display: 'none' }}
        onChange={(key) => {
          const nextParams = new URLSearchParams(searchParams);
          if (key === 'recipients') {
            nextParams.set('tab', 'recipients');
          } else {
            nextParams.delete('tab');
            nextParams.delete('issueId');
          }
          setSearchParams(nextParams);
        }}
        size="large"
        items={[
        {
          key: 'shipping',
          label: 'ZTO-MF',
          children: <ShippingDetailsTab initialIssueId={initialIssueId} />,
        },
        {
          key: 'recipients',
          label: '收件人',
          children: (
            <>
      <div style={{
        marginBottom: 20,
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        padding: '16px 20px',
        background: '#fff',
        borderRadius: 12,
        boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06)',
      }}>
        <Select
          placeholder="类型"
          style={{ width: 120 }}
          allowClear
          onChange={(value) => setFilters({ ...filters, type: value })}
        >
          <Select.Option value="corporate">对公</Select.Option>
          <Select.Option value="reader">读者</Select.Option>
          <Select.Option value="sample">样报</Select.Option>
        </Select>

        <Select
          placeholder="状态"
          style={{ width: 120 }}
          allowClear
          onChange={(value) => setFilters({ ...filters, status: value })}
        >
          <Select.Option value="active">正常</Select.Option>
          <Select.Option value="suspended">停发</Select.Option>
        </Select>

        <Input
          placeholder="搜索姓名"
          style={{ width: 200 }}
          allowClear
          value={filters.search ?? ''}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
        />

        <div style={{ flex: 1 }} />

        <Button type="primary" icon={<PlusOutlined />} onClick={() => handleOpenModal()}>
          新增收件人
        </Button>
      </div>

      <Card style={{ padding: 0 }}>
        <Table
          loading={loading}
          columns={columns}
          dataSource={recipients}
          rowKey="id"
          pagination={{ pageSize: 20 }}
        />
      </Card>

      {/* Create/Edit Modal */}
      <Modal
        title={editingRecipient ? '编辑收件人' : '新增收件人'}
        open={modalVisible}
        onOk={handleSubmit}
        onCancel={handleCloseModal}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="姓名" name="name" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input placeholder="请输入姓名" />
          </Form.Item>

          <Form.Item label="电话" name="phone">
            <Input placeholder="请输入电话" />
          </Form.Item>

          <Form.Item label="类型" name="type" rules={[{ required: true }]}>
            <Select>
              <Select.Option value="corporate">对公</Select.Option>
              <Select.Option value="reader">读者</Select.Option>
              <Select.Option value="sample">样报</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item label="频率" name="frequency" rules={[{ required: true }]}>
            <Select>
              <Select.Option value="weekly">周</Select.Option>
              <Select.Option value="biweekly">半月</Select.Option>
              <Select.Option value="monthly">月底</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item label="省份" name="province">
            <Input placeholder="请输入省份" />
          </Form.Item>

          <Form.Item label="城市" name="city">
            <Input placeholder="请输入城市" />
          </Form.Item>

          <Form.Item label="地址" name="address">
            <Input.TextArea placeholder="请输入详细地址" rows={3} />
          </Form.Item>

          <Form.Item label="备注" name="notes">
            <Input.TextArea placeholder="请输入备注" rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Subscriptions Drawer */}
      <Drawer
        width={500}
        title={`订阅记录 - ${currentRecipient?.name}`}
        open={drawerVisible}
        onClose={handleCloseDrawer}
        footer={
          <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenSubModal}>
            新增订阅/续订
          </Button>
        }
      >
        {subLoading ? (
          <div>加载中...</div>
        ) : subscriptions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
            暂无订阅记录
          </div>
        ) : (
          <Timeline>
            {subscriptions.map((sub) => (
              <Timeline.Item key={sub.id}>
                <div style={{ marginBottom: '8px' }}>
                  <Tag color={sub.type === 'new' ? 'blue' : 'green'}>{subTypeLabels[sub.type]}</Tag>
                  <span style={{ marginLeft: '8px', fontWeight: 'bold' }}>
                    {sub.start_date} ~ {sub.end_date}
                  </span>
                </div>
                <div style={{ fontSize: '12px', color: '#666' }}>
                  数量: {sub.quantity}份
                  {sub.duration_months && ` | 时长: ${sub.duration_months}个月`}
                </div>
                {sub.notes && (
                  <div style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>
                    备注: {sub.notes}
                  </div>
                )}
              </Timeline.Item>
            ))}
          </Timeline>
        )}
      </Drawer>

      {/* Subscription Modal */}
      <Modal
        title="新增订阅/续订"
        open={subModalVisible}
        onOk={handleSubmitSubscription}
        onCancel={handleCloseSubModal}
      >
        <Form form={subForm} layout="vertical">
          <Form.Item label="类型" name="type" rules={[{ required: true }]}>
            <Select>
              <Select.Option value="new">新订</Select.Option>
              <Select.Option value="renewal">续订</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item label="开始日期" name="start_date" rules={[{ required: true, message: '请选择开始日期' }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item label="结束日期" name="end_date" rules={[{ required: true, message: '请选择结束日期' }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item label="时长(月)" name="duration_months">
            <InputNumber placeholder="例如: 12" style={{ width: '100%' }} min={1} />
          </Form.Item>

          <Form.Item label="数量" name="quantity" rules={[{ required: true }]}>
            <InputNumber placeholder="发送数量" style={{ width: '100%' }} min={1} />
          </Form.Item>

          <Form.Item label="备注" name="notes">
            <Input.TextArea placeholder="请输入备注" rows={3} />
          </Form.Item>
        </Form>
      </Modal>
            </>
          ),
        },
      ]}
      />
    </div>
  );
}
