import { useState } from 'react';
import type { Key } from 'react';
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
} from 'antd';
import { PlusOutlined, PauseCircleOutlined, CaretRightOutlined, SearchOutlined, DeleteOutlined, EditOutlined, HistoryOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { TableColumnsType, TableProps } from 'antd';
import type { Recipient, Subscription } from '../api/recipients';
import type { ShippingDetail, ShippingDetailCreate, ShippingDetailUpdate } from '../api/shippingDetails';
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
  getShippingCompanies,
} from '../api/shippingDetails';
import { getOperationLogs } from '../api/operationLogs';
import type { OperationLog } from '../api/operationLogs';
import dayjs from 'dayjs';

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

const fieldLabels: Record<string, string> = {
  issue_number: '期号', sheet_name: '工作表', channel: '渠道', sub_channel: '子渠道', transport: '运输方式',
  frequency: '频率', status: '状态', name: '姓名', address: '地址', phone: '电话',
  quantity: '份数', deadline: '截止日期', notes: '备注', extra_info: '附加信息',
  city: '城市', station_name: '站点', station_hall: '站厅', contact_person: '联系人',
  seq_number: '序号', period_count: '期数', confirmation: '确认', company: '签约公司',
  shipped_at: '发货时间',
};

const channelColors: Record<string, string> = {
  '渠道订阅': 'blue',
  '对公订阅': 'blue',
  '个人订阅': 'green',
  '记者站': 'purple',
  '赠阅': 'orange',
  '库房留存': 'gray',
  '报社留存': 'cyan',
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

function ShippingDetailsTab() {
  const queryClient = useQueryClient();
  const [shippingFilters, setShippingFilters] = useState<ShippingFilters>({});
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<ShippingDetail | null>(null);
  const [form] = Form.useForm();
  const [logDrawerOpen, setLogDrawerOpen] = useState(false);
  const [logRecordId, setLogRecordId] = useState<number | null>(null);
  const [logRecordName, setLogRecordName] = useState<string>('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
  const [batchDeadline, setBatchDeadline] = useState<dayjs.Dayjs | null>(null);

  const { data: details = [], isLoading } = useQuery({
    queryKey: ['shippingDetails', shippingFilters],
    queryFn: async () => {
      const params: Record<string, any> = { issue_number: 2649 };
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
  });

  const { data: companyOptions = [] } = useQuery({
    queryKey: ['shippingCompanies'],
    queryFn: async () => {
      const res = await getShippingCompanies({ issue_number: 2649 });
      return res.data;
    },
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
    queryClient.invalidateQueries({ queryKey: ['shippingCompanies'] });
    queryClient.invalidateQueries({ queryKey: ['operationLogs'] });
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
        const createData: ShippingDetailCreate = {
          ...values,
          shipped_at,
          issue_number: 2649,
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

  const transportColors: Record<string, string> = {
    '中通物流': 'blue',
    '邮政物流': 'green',
    '包车运输': 'orange',
    '库房留存': 'default',
  };

  const rowSelection: TableProps<ShippingDetail>['rowSelection'] = {
    selectedRowKeys,
    onChange: (keys) => setSelectedRowKeys(keys),
  };

  const shippingColumns: TableColumnsType<ShippingDetail> = [
    { title: '姓名', dataIndex: 'name', key: 'name', width: 80 },
    {
      title: '渠道',
      dataIndex: 'channel',
      key: 'channel',
      width: 80,
      render: (v: string) => v ? <Tag color={channelColors[v] || 'gray'}>{v}</Tag> : '-',
    },
    {
      title: '子渠道',
      dataIndex: 'sub_channel',
      key: 'sub_channel',
      width: 80,
      render: (v: string | null) => v ? <Tag color={v === '监管' ? 'orange' : 'gold'}>{v}</Tag> : '-',
    },
    {
      title: '签约公司',
      dataIndex: 'company',
      key: 'company',
      width: 120,
      render: (v: string | null) => v ?? '-',
    },
    {
      title: '地址',
      dataIndex: 'address',
      key: 'address',
      width: 180,
      ellipsis: true,
      render: (v: string | null) => v ?? '-',
    },
    { title: '电话', dataIndex: 'phone', key: 'phone', width: 120, render: (v: string | null) => v ?? '-' },
    { title: '份数', dataIndex: 'quantity', key: 'quantity', width: 60, render: (v: number) => v ?? '-' },
    { title: '频率', dataIndex: 'frequency', key: 'frequency', width: 60, render: (v: string | null) => v ?? '-' },
    {
      title: '运输方式',
      dataIndex: 'transport',
      key: 'transport',
      width: 100,
      render: (v: string | null) => v ? <Tag color={transportColors[v] || 'default'}>{v}</Tag> : '-',
    },
    { title: '发货时间', dataIndex: 'shipped_at', key: 'shipped_at', width: 100, render: (v: string | null) => v ? dayjs(v).format('YYYY-MM-DD') : '-' },
    { title: '截止日期', dataIndex: 'deadline', key: 'deadline', width: 90, render: (v: string | null) => (!v || v === '-' || v === '长期') ? <Tag style={{ backgroundColor: '#000', color: '#fff', borderRadius: 4, border: 'none' }}>长期</Tag> : v },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 70,
      render: (v: string) => v ? <Tag color={v === '正常' ? 'green' : 'red'}>{v}</Tag> : '-',
    },
    {
      title: '备注',
      dataIndex: 'notes',
      key: 'notes',
      width: 100,
      ellipsis: true,
      render: (v: string | null) => v ?? '-',
    },
    {
      title: '操作',
      key: 'actions',
      width: 100,
      fixed: 'end',
      render: (_: any, record: ShippingDetail) => (
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

  return (
    <div>
      <div style={{
        marginBottom: 20,
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        flexWrap: 'wrap',
        padding: '16px 20px',
        background: '#fff',
        borderRadius: 12,
        boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06)',
      }}>
        <Select
          placeholder="渠道"
          style={{ width: 130 }}
          allowClear
          value={shippingFilters.channel}
          onChange={(value) => setShippingFilters((f) => ({ ...f, channel: value, sub_channel: undefined }))}
        >
          {CHANNEL_OPTIONS.map((ch) => (
            <Select.Option key={ch} value={ch}>{ch}</Select.Option>
          ))}
        </Select>
        {shippingFilters.channel === '赠阅' && (
          <Select
            placeholder="子渠道"
            style={{ width: 110 }}
            allowClear
            value={shippingFilters.sub_channel}
            onChange={(value) => setShippingFilters((f) => ({ ...f, sub_channel: value }))}
          >
            {SUB_CHANNEL_OPTIONS.map((sc) => (
              <Select.Option key={sc} value={sc}>{sc}</Select.Option>
            ))}
          </Select>
        )}
        <Select
          mode="multiple"
          placeholder="签约公司"
          style={{ minWidth: 160, maxWidth: 320 }}
          allowClear
          maxTagCount="responsive"
          onChange={(value: string[]) => setShippingFilters((f) => ({ ...f, company: value }))}
        >
          {companyOptions.map((c) => (
            <Select.Option key={c} value={c}>{c}</Select.Option>
          ))}
        </Select>
        <Select
          placeholder="频率"
          style={{ width: 120 }}
          allowClear
          onChange={(value) => setShippingFilters((f) => ({ ...f, frequency: value }))}
        >
          {FREQUENCY_OPTIONS.map((fr) => (
            <Select.Option key={fr} value={fr}>{fr}</Select.Option>
          ))}
        </Select>
        <Select
          placeholder="运输方式"
          style={{ width: 130 }}
          allowClear
          onChange={(value) => setShippingFilters((f) => ({ ...f, transport: value }))}
        >
          {TRANSPORT_OPTIONS.map((tr) => (
            <Select.Option key={tr} value={tr}>{tr}</Select.Option>
          ))}
        </Select>
        <Select
          placeholder="状态"
          style={{ width: 100 }}
          allowClear
          onChange={(value) => setShippingFilters((f) => ({ ...f, status: value }))}
        >
          {SHIPPING_STATUS_OPTIONS.map((st) => (
            <Select.Option key={st} value={st}>{st}</Select.Option>
          ))}
        </Select>
        <Input
          placeholder="搜索姓名"
          style={{ width: 200 }}
          allowClear
          prefix={<SearchOutlined />}
          onChange={(e) => setShippingFilters((f) => ({ ...f, search: e.target.value }))}
        />
        <div style={{ flex: 1 }} />
        <span style={{ color: '#888', fontSize: 14 }}>
          共 {details.length} 条记录，合计 {details.reduce((sum, d) => sum + (d.quantity ?? 0), 0)} 份
        </span>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenCreate}>
          新增
        </Button>
      </div>

      {selectedRowKeys.length > 0 && (
        <div style={{
          marginBottom: 12,
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          flexWrap: 'wrap',
          padding: '12px 16px',
          background: '#fff',
          borderRadius: 12,
          boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06)',
        }}>
          <span style={{ color: '#666' }}>已选 {selectedRowKeys.length} 条</span>
          <Button size="small" onClick={() => handleBatchStatus('正常')}>设为正常</Button>
          <Button size="small" danger onClick={() => handleBatchStatus('停发')}>设为停发</Button>
          <DatePicker
            size="small"
            placeholder="选择截止日期"
            value={batchDeadline}
            onChange={setBatchDeadline}
          />
          <Button size="small" onClick={handleBatchDeadline}>修改截止日期</Button>
          <Popconfirm title={`确认删除选中的 ${selectedRowKeys.length} 条记录？`} onConfirm={handleBatchDelete}>
            <Button size="small" danger>批量删除</Button>
          </Popconfirm>
          <Button size="small" type="link" onClick={() => setSelectedRowKeys([])}>取消选择</Button>
        </div>
      )}

      <Card style={{ padding: 0 }}>
        <Table
          loading={isLoading}
          columns={shippingColumns}
          dataSource={details}
          rowKey="id"
          rowSelection={rowSelection}
          scroll={{ x: 'max-content' }}
          pagination={{ pageSize: 20, showTotal: (total) => `共 ${total} 条记录` }}
        />
      </Card>

      <Modal
        title={editingRecord ? '编辑记录' : '新增记录'}
        open={modalVisible}
        onOk={handleSubmit}
        onCancel={handleCloseModal}
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
  const [filters, setFilters] = useState<Record<string, any>>({});
  
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
        收件人管理
      </h2>

      <Tabs defaultActiveKey="recipients" size="large" items={[
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
          onChange={(e) => setFilters({ ...filters, name: e.target.value })}
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
        {
          key: 'shipping',
          label: '中通发货明细',
          children: <ShippingDetailsTab />,
        },
      ]} />
    </div>
  );
}
