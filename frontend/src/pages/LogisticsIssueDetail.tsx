import { useState } from 'react';
import type { Key, ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
  Tooltip,
  Popover,
  Row,
  Col,
  Empty,
  Descriptions,
} from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  DeleteOutlined,
  EditOutlined,
  HistoryOutlined,
  DownloadOutlined,
  FilterOutlined,
  LeftOutlined,
  FileTextOutlined,
  InboxOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  ReloadOutlined,
  UnorderedListOutlined,
  CloudUploadOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { TableColumnsType, TableProps } from 'antd';
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
}

export default function LogisticsIssueDetail() {
  const { id } = useParams<{ id: string }>();
  const issueId = Number(id);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [shippingFilters, setShippingFilters] = useState<ShippingFilters>({});
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
  const [changeLogOpen, setChangeLogOpen] = useState(false);

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

  // Unfiltered per-issue list — powers 摘要条 / 处理状态 / 空态判定（不受筛选影响）。
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
    queryKey: ['report', issueId],
    queryFn: async () => {
      if (!Number.isFinite(issueId)) return null;
      const res = await getReport(issueId);
      return res.data;
    },
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
  };

  const handleEdit = (record: ShippingDetail) => {
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
      const shipped_at = values.shipped_at ? dayjs(values.shipped_at).format('YYYY-MM-DD') : null;
      if (editingRecord) {
        const updateData: ShippingDetailUpdate = { ...values, shipped_at };
        await updateShippingDetail(editingRecord.id, updateData);
        message.success('更新成功');
      } else {
        if (currentIssueNumber == null) return;
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

  const rowSelection: TableProps<ShippingDetail>['rowSelection'] = {
    selectedRowKeys,
    onChange: (keys) => setSelectedRowKeys(keys),
  };
  const confirmationSummary = report?.confirmation_summary;
  const currentShippingTotal = details.reduce((sum, detail) => sum + (detail.quantity ?? 0), 0);
  const check = report?.shipping_check;
  const advancedFilterCount = [shippingFilters.frequency, shippingFilters.transport, shippingFilters.sub_channel].filter(Boolean).length;

  // ---- 本期处理状态 ----
  const uploaded = allDetails.length > 0;
  const anomalyRows = allDetails.filter((d) => d.sync_status !== 'synced');
  const hasDrift = !!confirmationSummary?.has_shipping_drift;
  const isException = uploaded && (((check && !check.is_match) ?? false) || hasDrift);
  const isConfirmed = currentIssue?.status === 'confirmed' || currentIssue?.status === 'exported';

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
      label: '对账 · 差值（报数−发货）',
      value: check ? (check.is_match ? '一致' : `差 ${Math.abs(check.delta).toLocaleString()} 份`) : '—',
      suffix: '',
      sub: check
        ? (check.is_match
          ? '报数与发货明细一致'
          : `报数 ${check.report_zt_total.toLocaleString()} / 发货 ${check.shipping_total.toLocaleString()}`)
        : '暂无报数校验',
      valueColor: check ? (check.is_match ? '#389e0d' : '#cf1322') : undefined,
    },
    {
      icon: anomalyRows.length === 0
        ? <CheckCircleOutlined style={{ fontSize: 21, color: '#389e0d' }} />
        : <CloseCircleOutlined style={{ fontSize: 21, color: '#cf1322' }} />,
      bg: anomalyRows.length === 0 ? 'rgba(82,196,26,.10)' : 'rgba(255,77,79,.10)',
      label: '异常状态',
      value: anomalyRows.length.toLocaleString(),
      suffix: '条',
      sub: anomalyRows.length === 0 ? '当前无异常记录' : '人工修改 / 孤立明细',
      valueColor: anomalyRows.length === 0 ? undefined : '#cf1322',
    },
  ];

  // ---- 本期处理状态 3 卡 ----
  const processCards = [
    {
      icon: <CloudUploadOutlined style={{ fontSize: 24, color: uploaded ? '#0071e3' : '#86868b' }} />,
      title: '是否已上传',
      state: uploaded ? '已上传' : '未上传',
      stateColor: uploaded ? '#0071e3' : '#86868b',
      desc: uploaded ? `发货明细已录入 ${allDetails.length} 条` : '尚未上传发货明细',
    },
    {
      icon: isException
        ? <CloseCircleOutlined style={{ fontSize: 24, color: '#fa8c16' }} />
        : <CheckCircleOutlined style={{ fontSize: 24, color: '#52c41a' }} />,
      title: '是否有异常',
      state: isException ? '有异常' : '暂无异常',
      stateColor: isException ? '#fa8c16' : '#52c41a',
      desc: isException ? '存在差异 / 确认后变更 / 孤立明细' : '当前未发现异常报告',
    },
    {
      icon: <SafetyCertificateOutlined style={{ fontSize: 24, color: isConfirmed ? '#52c41a' : '#86868b' }} />,
      title: '是否已确认',
      state: isConfirmed ? '已确认' : '未确认',
      stateColor: isConfirmed ? '#52c41a' : '#86868b',
      desc: isConfirmed ? '发货数据已确认并锁定' : '确认后本期将计入统计',
    },
  ];

  const todoSteps = [
    { label: '上传发货明细', done: uploaded },
    { label: '检查并处理异常', done: uploaded && !isException },
    { label: '确认本期数据', done: isConfirmed },
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
        v: r.order_id ? <a onClick={() => navigate(`/orders/${r.order_id}`)}>查看订单 #{r.order_id}</a> : '—',
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
      {/* 面包屑返回 */}
      <Button
        type="link"
        size="small"
        icon={<LeftOutlined />}
        style={{ paddingLeft: 0, marginBottom: 4 }}
        onClick={() => navigate('/logistics/issues')}
      >
        期数总览
      </Button>

      {/* 标题 + 状态 */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1d1d1f', margin: 0, letterSpacing: '-0.02em' }}>
          快递管理 · ZTO-MF
        </h2>
        {currentIssue && (
          <>
            <span style={{ fontSize: 15, color: '#5a5a62' }}>
              第 {currentIssue.issue_number} 期（{dayjs(currentIssue.publish_date).format('YYYY-MM-DD')}）
            </span>
            <Tag color={issueStatusColor[currentIssue.status] || 'default'} style={{ marginInlineEnd: 0, fontWeight: 500 }}>
              {issueStatusLabel[currentIssue.status] || currentIssue.status}
            </Tag>
          </>
        )}
      </div>

      <Row gutter={20}>
        {/* 主列 */}
        <Col xs={24} lg={17}>
          {/* 摘要条 */}
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

          {/* 本期处理状态 */}
          <Row gutter={16} style={{ marginBottom: 16 }}>
            {processCards.map((c, idx) => (
              <Col xs={24} md={8} key={idx} style={{ display: 'flex' }}>
                <Card size="small" style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {c.icon}
                    <div>
                      <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{c.title}</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: c.stateColor }}>{c.state}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 8 }}>{c.desc}</div>
                </Card>
              </Col>
            ))}
          </Row>

          {confirmationSummary && (
            <Card style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>当期中通校验状态</span>
                <span style={{ color: '#86868b', fontSize: 13 }}>当前页合计 {currentShippingTotal.toLocaleString()} 份</span>
              </div>
              <div className="zto-check-grid">
                <div className={`zto-check-result ${confirmationSummary.current_is_match ? 'ok' : 'bad'}`}>
                  <div className="zto-check-title">当前校验结果</div>
                  <div className="zto-check-hero">
                    {confirmationSummary.current_is_match
                      ? <CheckCircleFilled style={{ fontSize: 34, color: '#52c41a' }} />
                      : <CloseCircleFilled style={{ fontSize: 34, color: '#ff4d4f' }} />}
                    <span className="zto-check-hero-text" style={{ color: confirmationSummary.current_is_match ? '#389e0d' : '#cf1322' }}>
                      {confirmationSummary.current_is_match ? '当前一致' : '当前不一致'}
                    </span>
                  </div>
                  <div className="zto-check-rows">
                    <div><span>报数中通</span><b>{confirmationSummary.confirmed_report_total.toLocaleString()} 份</b></div>
                    <div><span>当前发货明细</span><b>{confirmationSummary.current_shipping_total.toLocaleString()} 份</b></div>
                    <div><span>当前差值</span><b>{confirmationSummary.current_delta.toLocaleString()} 份</b></div>
                  </div>
                </div>
                <div className="zto-check-snapshot">
                  <div className="zto-check-title">确认时快照与变更</div>
                  <div className="zto-check-snapshot-body">
                    <div className="zto-check-rows">
                      <div><span>确认时发货明细</span><b>{confirmationSummary.confirmed_shipping_total.toLocaleString()} 份</b></div>
                      <div><span>当前发货明细</span><b>{confirmationSummary.current_shipping_total.toLocaleString()} 份</b></div>
                      <div><span>与确认时差值</span><b style={{ color: (confirmationSummary.current_shipping_total - confirmationSummary.confirmed_shipping_total) !== 0 ? '#d46b08' : undefined }}>{(confirmationSummary.current_shipping_total - confirmationSummary.confirmed_shipping_total).toLocaleString()} 份</b></div>
                    </div>
                    <div className="zto-check-changes">
                      {confirmationSummary.has_shipping_drift && <Tag color="orange" style={{ marginInlineEnd: 0 }}>确认后明细已变更</Tag>}
                      <p className="zto-check-changes-text">
                        {confirmationSummary.has_shipping_drift
                          ? (confirmationSummary.current_is_match
                            ? '当前数据与报数页一致，但发货明细已偏离确认时快照。'
                            : '发货明细已偏离确认时快照，且当前与报数不一致。')
                          : '当前发货明细与确认时快照一致。'}
                      </p>
                      <Space>
                        <Button icon={<FileTextOutlined />} onClick={() => setChangeLogOpen(true)}>查看变更记录</Button>
                        <Button className="zto-reverify-btn" icon={<ReloadOutlined />} onClick={handleReverify}>重新校验</Button>
                      </Space>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          )}

          {allDetails.length === 0 ? (
            <Card>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: '#1d1d1f' }}>当前期数尚未上传发货明细</div>
                    <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
                      请新建记录，完成后系统将自动计算发货与报数差异。
                    </div>
                  </div>
                }
              >
                <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenCreate}>新增第一条</Button>
              </Empty>
            </Card>
          ) : (
            <Card styles={{ body: { padding: 0 } }}>
              <div className="zto-toolbar">
                <Select
                  placeholder="渠道"
                  style={{ width: 150 }}
                  allowClear
                  value={shippingFilters.channel}
                  onChange={(value) => setShippingFilters((f) => ({ ...f, channel: value, sub_channel: undefined }))}
                >
                  {CHANNEL_OPTIONS.map((ch) => <Select.Option key={ch} value={ch}>{ch}</Select.Option>)}
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
                  {companyOptions.map((c) => <Select.Option key={c} value={c}>{c}</Select.Option>)}
                </Select>
                <Select
                  placeholder="状态"
                  style={{ width: 120 }}
                  allowClear
                  value={shippingFilters.status}
                  onChange={(value) => setShippingFilters((f) => ({ ...f, status: value }))}
                >
                  {SHIPPING_STATUS_OPTIONS.map((st) => <Select.Option key={st} value={st}>{st}</Select.Option>)}
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
                      <Select placeholder="频率" style={{ width: '100%' }} allowClear value={shippingFilters.frequency} onChange={(value) => setShippingFilters((f) => ({ ...f, frequency: value }))}>
                        {FREQUENCY_OPTIONS.map((fr) => <Select.Option key={fr} value={fr}>{fr}</Select.Option>)}
                      </Select>
                      <Select placeholder="运输方式" style={{ width: '100%' }} allowClear value={shippingFilters.transport} onChange={(value) => setShippingFilters((f) => ({ ...f, transport: value }))}>
                        {TRANSPORT_OPTIONS.map((tr) => <Select.Option key={tr} value={tr}>{tr}</Select.Option>)}
                      </Select>
                      <Select placeholder="子渠道" style={{ width: '100%' }} allowClear value={shippingFilters.sub_channel} onChange={(value) => setShippingFilters((f) => ({ ...f, sub_channel: value }))}>
                        {SUB_CHANNEL_OPTIONS.map((sc) => <Select.Option key={sc} value={sc}>{sc}</Select.Option>)}
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
                      <Button danger loading={clearingIssue} disabled={currentIssueNumber == null}>清空本期</Button>
                    </Popconfirm>
                  )}
                  <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenCreate}>新增</Button>
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
          )}
        </Col>

        {/* 右侧栏 */}
        <Col xs={24} lg={7}>
          <Card size="small" title="下一步待办" style={{ marginBottom: 16 }}>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {todoSteps.map((step, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      background: step.done ? 'rgba(82,196,26,.12)' : 'rgba(0,0,0,.05)',
                      color: step.done ? '#52c41a' : '#86868b', fontSize: 12,
                    }}>{idx + 1}</span>
                    <span style={{ color: step.done ? '#1d1d1f' : '#5a5a62' }}>{step.label}</span>
                  </span>
                  <Tag color={step.done ? 'success' : 'default'} style={{ marginInlineEnd: 0 }}>
                    {step.done ? '已完成' : '待处理'}
                  </Tag>
                </div>
              ))}
            </Space>
          </Card>

          <Card size="small" title="期数信息" style={{ marginBottom: 16 }}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="期号">{currentIssue ? `第 ${currentIssue.issue_number} 期` : '—'}</Descriptions.Item>
              <Descriptions.Item label="出版日期">{currentIssue ? dayjs(currentIssue.publish_date).format('YYYY-MM-DD') : '—'}</Descriptions.Item>
              <Descriptions.Item label="状态">
                {currentIssue ? (
                  <Tag color={issueStatusColor[currentIssue.status] || 'default'} style={{ marginInlineEnd: 0 }}>
                    {issueStatusLabel[currentIssue.status] || currentIssue.status}
                  </Tag>
                ) : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="创建时间">
                {currentIssue?.created_at ? dayjs(currentIssue.created_at).format('YYYY-MM-DD HH:mm') : '—'}
              </Descriptions.Item>
            </Descriptions>
          </Card>

          <Card size="small" title="快捷操作">
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Button block icon={<FileTextOutlined />} onClick={() => navigate(`/report/${issueId}`)}>去报数</Button>
              <Button block icon={<DownloadOutlined />} onClick={handleExportShipping} disabled={currentIssue?.id == null} loading={exporting}>导出本期</Button>
              <Button block icon={<UnorderedListOutlined />} onClick={() => navigate('/logistics/issues')}>返回期数总览</Button>
            </Space>
          </Card>
        </Col>
      </Row>

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
              {CHANNEL_OPTIONS.map((ch) => <Select.Option key={ch} value={ch}>{ch}</Select.Option>)}
            </Select>
          </Form.Item>
          <Form.Item noStyle dependencies={['channel']}>
            {({ getFieldValue }) =>
              getFieldValue('channel') === '赠阅' ? (
                <Form.Item label="子渠道" name="sub_channel">
                  <Select placeholder="请选择子渠道" allowClear>
                    {SUB_CHANNEL_OPTIONS.map((sc) => <Select.Option key={sc} value={sc}>{sc}</Select.Option>)}
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
