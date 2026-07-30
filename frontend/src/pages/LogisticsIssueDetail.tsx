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
  message,
  Drawer,
  Timeline,
  DatePicker,
  InputNumber,
  Popconfirm,
  Card,
  Tooltip,
  Popover,
  Empty,
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
  InboxOutlined,
  CheckOutlined,
  CloseOutlined,
  ReloadOutlined,
  MoreOutlined,
  RightOutlined,
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
import { DrawerTitle, StatusPill } from '../components/UiPrimitives';

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
  const [actionMenuRecordId, setActionMenuRecordId] = useState<number | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
  const [expandedRowKeys, setExpandedRowKeys] = useState<Key[]>([]);
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
    setActionMenuRecordId(null);
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
    columnWidth: 44,
  };
  const confirmationSummary = report?.confirmation_summary;
  const currentShippingTotal = details.reduce((sum, detail) => sum + (detail.quantity ?? 0), 0);
  const allShippingTotal = allDetails.reduce((sum, detail) => sum + (detail.quantity ?? 0), 0);
  const check = report?.shipping_check;
  const advancedFilterCount = [shippingFilters.frequency, shippingFilters.transport, shippingFilters.sub_channel].filter(Boolean).length;
  const uploaded = allDetails.length > 0;
  const anomalyRows = allDetails.filter((d) => d.sync_status !== 'synced');
  const hasDrift = !!confirmationSummary?.has_shipping_drift;
  const displayedReportTotal = check?.report_zt_total ?? confirmationSummary?.confirmed_report_total ?? null;
  const displayedShippingTotal = check?.shipping_total ?? confirmationSummary?.current_shipping_total ?? allShippingTotal;
  const displayedDelta = check?.delta ?? confirmationSummary?.current_delta ?? null;
  const currentIsMatch = check?.is_match ?? confirmationSummary?.current_is_match ?? null;
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
  );

  const toggleExpanded = (recordId: number) => {
    setExpandedRowKeys((keys) => (
      keys.includes(recordId) ? keys.filter((key) => key !== recordId) : [...keys, recordId]
    ));
  };

  const shippingColumns: TableColumnsType<ShippingDetail> = [
    {
      title: '姓名 / 渠道',
      dataIndex: 'name',
      key: 'name',
      width: 170,
      render: (_: unknown, r: ShippingDetail) => (
        <div className="zto-person-cell">
          <Button
            type="text"
            size="small"
            className={`zto-expand-btn ${expandedRowKeys.includes(r.id) ? 'open' : ''}`}
            icon={<RightOutlined />}
            aria-label={expandedRowKeys.includes(r.id) ? `收起${r.name}详情` : `展开${r.name}详情`}
            onClick={() => toggleExpanded(r.id)}
          />
          <div className="zto-person-copy">
            <strong>{r.name}</strong>
            <div className="zto-person-tags">
              {r.channel ? <Tag color={channelColors[r.channel] || 'default'}>{r.channel}</Tag> : null}
              {r.sub_channel ? <Tag color={r.sub_channel === '监管' ? 'orange' : 'gold'}>{r.sub_channel}</Tag> : null}
            </div>
          </div>
        </div>
      ),
    },
    {
      title: '签约公司',
      dataIndex: 'company',
      key: 'company',
      width: 135,
      render: (v: string | null) => (
        <Tooltip title={v || ''}><span className="zto-company">{v || '—'}</span></Tooltip>
      ),
    },
    {
      title: '收件信息',
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
      width: 66,
      render: (v: number) => <span className="zto-quantity">{v ?? '—'}</span>,
    },
    {
      title: '来源 / 同步',
      key: 'mark',
      width: 116,
      render: (_: unknown, r: ShippingDetail) => (
        <div className="zto-mark">
          <span className="zto-source">{sourceTypeMeta[r.source_type]?.label || r.source_type}</span>
          <span className={`zto-sync zto-sync--${r.sync_status}`}>
            {r.sync_status === 'synced' ? '✓ ' : ''}{syncStatusMeta[r.sync_status]?.label || r.sync_status}
          </span>
        </div>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 70,
      render: (v: string) => (
        <span className="zto-status"><span className="zto-status-dot" style={{ background: v === '正常' ? 'var(--color-success)' : 'var(--color-danger)' }} />{v || '—'}</span>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 92,
      align: 'right',
      render: (_: unknown, record: ShippingDetail) => (
        <div className="zto-row-actions">
          <Button type="link" size="small" onClick={() => handleEdit(record)}>编辑</Button>
          <Popover
            trigger="click"
            placement="bottomRight"
            open={actionMenuRecordId === record.id}
            onOpenChange={(open) => setActionMenuRecordId(open ? record.id : null)}
            content={
              <div className="zto-action-menu">
                <Button type="text" icon={<HistoryOutlined />} onClick={() => handleShowLogs(record)}>操作日志</Button>
                <Popconfirm title="确认删除？" onConfirm={() => handleDelete(record.id)}>
                  <Button type="text" danger icon={<DeleteOutlined />}>删除</Button>
                </Popconfirm>
              </div>
            }
          >
            <Button type="text" size="small" icon={<MoreOutlined />} aria-label={`${record.name}更多操作`} />
          </Popover>
        </div>
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
          <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenCreate}>新增明细</Button>
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
          <div className={`zto-reconcile-result ${currentIsMatch === true ? 'is-match' : currentIsMatch === false ? 'is-mismatch' : 'is-pending'}`}>
            <div className="zto-reconcile-icon">
              {!uploaded
                ? <InboxOutlined />
                : currentIsMatch === true
                  ? <CheckOutlined />
                  : currentIsMatch === false
                    ? <CloseOutlined />
                    : <ReloadOutlined />}
            </div>
            <div>
              <span>本期对账结果</span>
              <strong>{!uploaded ? '等待发货明细' : currentIsMatch === true ? '当前一致' : currentIsMatch === false ? '当前不一致' : '等待校验'}</strong>
              <small>{!uploaded ? '新增明细后将自动计算差异' : currentIsMatch === true ? '报数与当前发货明细一致' : currentIsMatch === false ? '报数与当前发货明细存在差异' : '暂无可用的报数校验'}</small>
            </div>
          </div>
          <div className="zto-reconcile-metric">
            <span>报数 · 中通</span>
            <strong>{displayedReportTotal == null ? '—' : displayedReportTotal.toLocaleString()}</strong>
            <small>{displayedReportTotal == null ? '暂无数据' : '份'}</small>
          </div>
          <div className="zto-reconcile-metric">
            <span>发货明细</span>
            <strong>{displayedShippingTotal.toLocaleString()}</strong>
            <small>份</small>
          </div>
          <div className="zto-reconcile-metric">
            <span>当前差值</span>
            <strong className={currentIsMatch === false ? 'is-danger' : currentIsMatch === true ? 'is-success' : ''}>
              {displayedDelta == null ? '—' : displayedDelta.toLocaleString()}
            </strong>
            <small>{displayedDelta == null ? '暂无数据' : '份'}</small>
          </div>
          <div className="zto-reconcile-metric">
            <span>明细记录</span>
            <strong>{allDetails.length.toLocaleString()}</strong>
            <small>条 · 异常 {anomalyRows.length.toLocaleString()} 条</small>
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
              <Button size="small" className="zto-reverify-btn" icon={<ReloadOutlined />} onClick={handleReverify}>重新校验</Button>
            </div>
          </div>
        )}
      </Card>

      {allDetails.length === 0 ? (
        <Card className="zto-empty-card">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <div>
                <div className="zto-empty-title">当前期数尚未上传发货明细</div>
                <div className="zto-empty-copy">请新建记录，完成后系统将自动计算发货与报数差异。</div>
              </div>
            }
          >
            <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenCreate}>新增第一条</Button>
          </Empty>
        </Card>
      ) : (
        <Card className="zto-list-card" styles={{ body: { padding: 0 } }}>
          <div className="zto-list-head">
            <div className="zto-list-title">
              <h2>发货明细</h2>
              <span>收件人、地址与同步状态统一在此维护</span>
            </div>
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
                共 <b>{details.length}</b> 条 · 合计 <b>{currentShippingTotal.toLocaleString()}</b> 份
              </span>
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
            className="zto-table"
            loading={isLoading}
            columns={shippingColumns}
            dataSource={details}
            rowKey="id"
            rowSelection={rowSelection}
            tableLayout="fixed"
            scroll={{ x: 960 }}
            expandable={{
              expandedRowRender: renderExpanded,
              expandedRowKeys,
              showExpandColumn: false,
            }}
            pagination={{ pageSize: 20, showSizeChanger: false, showTotal: (total) => `共 ${total} 条记录` }}
          />
        </Card>
      )}

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
