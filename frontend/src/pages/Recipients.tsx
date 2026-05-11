import { useState } from 'react';
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
import { PlusOutlined, PauseCircleOutlined, CaretRightOutlined, SearchOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { TableColumnsType } from 'antd';
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
  getShippingCompanies,
} from '../api/shippingDetails';
import dayjs from 'dayjs';

const typeLabels: Record<string, string> = { corporate: '对公', reader: '读者', sample: '样报' };
const typeColors: Record<string, string> = { corporate: 'blue', reader: 'green', sample: 'purple' };
const freqLabels: Record<string, string> = { weekly: '周', biweekly: '半月', monthly: '月' };
const statusLabels: Record<string, string> = { active: '正常', suspended: '停发' };
const statusColors: Record<string, string> = { active: 'green', suspended: 'red' };
const subTypeLabels: Record<string, string> = { new: '新订', renewal: '续订' };

const CHANNEL_OPTIONS = ['渠道订阅', '对公订阅', '个人订户', '记者站', '监管赠阅', '政府赠阅', '库房留存', '报社留存'] as const;
const FREQUENCY_OPTIONS = ['周', '半月', '月'] as const;
const TRANSPORT_OPTIONS = ['中通物流', '邮政物流', '包车运输', '库房留存'] as const;
const SHIPPING_STATUS_OPTIONS = ['正常', '停发'] as const;

const channelColors: Record<string, string> = {
  '渠道订阅': 'blue',
  '对公订阅': 'blue',
  '个人订户': 'green',
  '记者站': 'purple',
  '监管赠阅': 'orange',
  '政府赠阅': 'gold',
  '库房留存': 'gray',
  '报社留存': 'cyan',
};

interface ShippingFilters {
  channel?: string;
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

  const { data: details = [], isLoading } = useQuery({
    queryKey: ['shippingDetails', shippingFilters],
    queryFn: async () => {
      const params: Record<string, any> = { issue_number: 2649 };
      if (shippingFilters.channel) params.channel = shippingFilters.channel;
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

  const handleEdit = (record: ShippingDetail) => {
    setEditingRecord(record);
    form.setFieldsValue(record);
    setModalVisible(true);
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteShippingDetail(id);
      message.success('删除成功');
      queryClient.invalidateQueries({ queryKey: ['shippingDetails'] });
      queryClient.invalidateQueries({ queryKey: ['shippingCompanies'] });
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
      if (editingRecord) {
        const updateData: ShippingDetailUpdate = { ...values };
        await updateShippingDetail(editingRecord.id, updateData);
        message.success('更新成功');
      } else {
        const createData: ShippingDetailCreate = {
          ...values,
          issue_number: 2649,
          sheet_name: '手动添加',
        };
        await createShippingDetail(createData);
        message.success('创建成功');
      }
      handleCloseModal();
      queryClient.invalidateQueries({ queryKey: ['shippingDetails'] });
      queryClient.invalidateQueries({ queryKey: ['shippingCompanies'] });
    } catch {
      message.error('操作失败');
    }
  };

  const transportColors: Record<string, string> = {
    '中通物流': 'blue',
    '邮政物流': 'green',
    '包车运输': 'orange',
    '库房留存': 'default',
  };

  const shippingColumns: TableColumnsType<ShippingDetail> = [
    { title: '姓名', dataIndex: 'name', key: 'name', width: 80 },
    {
      title: '渠道',
      dataIndex: 'channel',
      key: 'channel',
      width: 100,
      render: (v: string) => v ? <Tag color={channelColors[v] || 'gray'}>{v}</Tag> : '-',
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
    { title: '截止日期', dataIndex: 'deadline', key: 'deadline', width: 90, render: (v: string | null) => v ?? '-' },
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
      width: 70,
      fixed: 'end',
      render: (_: any, record: ShippingDetail) => (
        <Space size="small">
          <Tooltip title="编辑">
            <Button type="text" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
          </Tooltip>
          <Popconfirm title="确认删除？" onConfirm={() => handleDelete(record.id)}>
            <Tooltip title="删除">
              <Button type="text" size="small" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
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
          onChange={(value) => setShippingFilters((f) => ({ ...f, channel: value }))}
        >
          {CHANNEL_OPTIONS.map((ch) => (
            <Select.Option key={ch} value={ch}>{ch}</Select.Option>
          ))}
        </Select>
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
        <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenCreate}>
          新增
        </Button>
      </div>

      <Card style={{ padding: 0 }}>
        <Table
          loading={isLoading}
          columns={shippingColumns}
          dataSource={details}
          rowKey="id"
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
