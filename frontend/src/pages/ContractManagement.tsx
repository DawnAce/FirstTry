import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd';
import {
  DownloadOutlined,
  PlusOutlined,
  ReloadOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import type { TableColumnsType } from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import {
  contractQueryKeys,
  createContract,
  createPartner,
  deleteContract,
  deleteContractAttachment,
  deletePartner,
  downloadContractAttachment,
  listContracts,
  listPartners,
  partnerQueryKeys,
  updateContract,
  updatePartner,
  uploadContractAttachment,
} from '../api/contracts';
import type {
  Contract,
  ContractPayload,
  ContractStatus,
  Partner,
  PartnerPayload,
  PartnerType,
} from '../api/contracts';
import { useAuth } from '../contexts/AuthContext';

const { Title, Text } = Typography;

// 与后端 MAX_ATTACHMENT_BYTES 对齐，前端先行拦截超大文件，省去整包上传再被 400。
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const PARTNER_TYPE_OPTIONS: Array<{ label: string; value: PartnerType }> = [
  { label: '物流', value: 'logistics' },
  { label: '发行', value: 'distribution' },
  { label: '零售', value: 'retail' },
  { label: '其他', value: 'other' },
];
const PARTNER_TYPE_LABELS: Record<PartnerType, string> = {
  logistics: '物流',
  distribution: '发行',
  retail: '零售',
  other: '其他',
};
const PARTNER_TYPE_COLORS: Record<PartnerType, string> = {
  logistics: 'blue',
  distribution: 'geekblue',
  retail: 'purple',
  other: 'default',
};

const STATUS_OPTIONS: Array<{ label: string; value: ContractStatus }> = [
  { label: '生效', value: 'active' },
  { label: '到期', value: 'expired' },
  { label: '已归档', value: 'archived' },
  { label: '作废', value: 'void' },
];
const STATUS_LABELS: Record<ContractStatus, string> = {
  active: '生效',
  expired: '到期',
  archived: '已归档',
  void: '作废',
};
const STATUS_COLORS: Record<ContractStatus, string> = {
  active: 'green',
  expired: 'orange',
  archived: 'default',
  void: 'red',
};

function partnerTypeTag(t: PartnerType | null | undefined) {
  if (!t) return null;
  return <Tag color={PARTNER_TYPE_COLORS[t]}>{PARTNER_TYPE_LABELS[t]}</Tag>;
}
function apiError(err: unknown, fallback: string) {
  const e = err as { response?: { data?: { detail?: string } } };
  return e.response?.data?.detail ?? fallback;
}

// =========================================================================== //
// 合作渠道 Tab
// =========================================================================== //
interface PartnerFormValues {
  name: string;
  partner_type: PartnerType;
  contact_person?: string;
  contact_phone?: string;
  settlement_account?: string;
  notes?: string;
  active: boolean;
}

function PartnersPanel({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [form] = Form.useForm<PartnerFormValues>();
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Partner | null>(null);

  const partnersQuery = useQuery({
    queryKey: partnerQueryKeys.list({ q: search || undefined }),
    queryFn: async () => (await listPartners({ q: search || undefined })).data,
  });

  const saveMutation = useMutation({
    mutationFn: async (values: PartnerFormValues) => {
      const payload: PartnerPayload = { ...values };
      return editing ? updatePartner(editing.id, payload) : createPartner(payload);
    },
    onSuccess: () => {
      message.success(editing ? '渠道已更新' : '渠道已新增');
      queryClient.invalidateQueries({ queryKey: partnerQueryKeys.all });
      setModalOpen(false);
      setEditing(null);
    },
    onError: (err) => message.error(apiError(err, '保存失败')),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deletePartner(id),
    onSuccess: () => {
      message.success('已删除');
      queryClient.invalidateQueries({ queryKey: partnerQueryKeys.all });
    },
    onError: (err) => message.error(apiError(err, '删除失败')),
  });

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ partner_type: 'other', active: true });
    setModalOpen(true);
  };
  const openEdit = (p: Partner) => {
    setEditing(p);
    form.resetFields();
    form.setFieldsValue({
      name: p.name,
      partner_type: p.partner_type,
      contact_person: p.contact_person ?? undefined,
      contact_phone: p.contact_phone ?? undefined,
      settlement_account: p.settlement_account ?? undefined,
      notes: p.notes ?? undefined,
      active: p.active,
    });
    setModalOpen(true);
  };

  const columns: TableColumnsType<Partner> = [
    { title: '渠道名称', dataIndex: 'name', key: 'name', render: (v) => <Text strong>{v}</Text> },
    { title: '类型', dataIndex: 'partner_type', key: 'partner_type', width: 90, render: (v: PartnerType) => partnerTypeTag(v) },
    { title: '联系人', dataIndex: 'contact_person', key: 'contact_person', render: (v) => v || <Text type="secondary">—</Text> },
    { title: '电话', dataIndex: 'contact_phone', key: 'contact_phone', render: (v) => v || <Text type="secondary">—</Text> },
    { title: '结算账户', dataIndex: 'settlement_account', key: 'settlement_account', render: (v) => v || <Text type="secondary">—</Text> },
    {
      title: '状态', dataIndex: 'active', key: 'active', width: 80,
      render: (active: boolean) => (active ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>),
    },
    ...(isAdmin
      ? [{
          title: '操作', key: 'actions', width: 130,
          render: (_: unknown, row: Partner) => (
            <Space size={4}>
              <Button type="link" size="small" onClick={() => openEdit(row)}>编辑</Button>
              <Popconfirm
                title="删除该渠道？"
                description="若该渠道下仍有合同将无法删除；可改为「停用」。"
                okText="删除" okButtonProps={{ danger: true }} cancelText="取消"
                onConfirm={() => deleteMutation.mutate(row.id)}
              >
                <Button type="link" size="small" danger>删除</Button>
              </Popconfirm>
            </Space>
          ),
        } as TableColumnsType<Partner>[number]]
      : []),
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <Input.Search placeholder="搜索 名称 / 联系人" allowClear style={{ width: 240 }} onSearch={setSearch} />
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => partnersQuery.refetch()} loading={partnersQuery.isFetching}>刷新</Button>
          {isAdmin && <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增渠道</Button>}
        </Space>
      </div>
      <Table<Partner>
        rowKey="id"
        size="small"
        loading={partnersQuery.isLoading}
        columns={columns}
        dataSource={partnersQuery.data ?? []}
        pagination={false}
        locale={{ emptyText: '暂无合作渠道' }}
      />

      <Modal
        title={editing ? `编辑渠道 ${editing.name}` : '新增合作渠道'}
        open={modalOpen}
        onCancel={() => { setModalOpen(false); setEditing(null); }}
        onOk={() => form.submit()}
        okText="保存"
        confirmLoading={saveMutation.isPending}
        destroyOnHidden
      >
        <Form<PartnerFormValues> form={form} layout="vertical" onFinish={(v) => saveMutation.mutate(v)}>
          <Form.Item name="name" label="渠道名称" rules={[{ required: true, message: '请填写渠道名称' }]}>
            <Input placeholder="如：中通 / 北京市报刊发行局" />
          </Form.Item>
          <Form.Item name="partner_type" label="类型">
            <Select options={PARTNER_TYPE_OPTIONS} />
          </Form.Item>
          <Space style={{ display: 'flex' }} align="start">
            <Form.Item name="contact_person" label="联系人" style={{ width: 200 }}>
              <Input />
            </Form.Item>
            <Form.Item name="contact_phone" label="联系电话" style={{ width: 200 }}>
              <Input />
            </Form.Item>
          </Space>
          <Form.Item name="settlement_account" label="结算账户 / 开户信息">
            <Input placeholder="给财务渠道结算用（可空）" />
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="active" label="状态" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="停用" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

// =========================================================================== //
// 合同 Tab
// =========================================================================== //
interface ContractFormValues {
  partner_id: number;
  title: string;
  contract_no?: string;
  sign_year?: number;
  sign_date?: Dayjs | null;
  start_date?: Dayjs | null;
  end_date?: Dayjs | null;
  amount?: number | null;
  status: ContractStatus;
  notes?: string;
}

function buildContractPayload(v: ContractFormValues): ContractPayload {
  const fmt = (d?: Dayjs | null) => (d ? d.format('YYYY-MM-DD') : null);
  return {
    partner_id: v.partner_id,
    title: v.title,
    contract_no: v.contract_no || null,
    sign_year: v.sign_year ?? null,
    sign_date: fmt(v.sign_date),
    start_date: fmt(v.start_date),
    end_date: fmt(v.end_date),
    amount: v.amount ?? null,
    status: v.status,
    notes: v.notes || null,
  };
}

function ContractsPanel({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [form] = Form.useForm<ContractFormValues>();
  const [filters, setFilters] = useState<{ partner_id?: number; status?: ContractStatus; q?: string }>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Contract | null>(null);

  const partnersQuery = useQuery({
    queryKey: partnerQueryKeys.list(),
    queryFn: async () => (await listPartners()).data,
  });
  const partnerOptions = (partnersQuery.data ?? []).map((p) => ({ label: p.name, value: p.id }));

  const contractsQuery = useQuery({
    queryKey: contractQueryKeys.list(filters),
    queryFn: async () => (await listContracts(filters)).data,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: contractQueryKeys.all });

  const saveMutation = useMutation({
    mutationFn: async (values: ContractFormValues) => {
      const payload = buildContractPayload(values);
      return editing ? updateContract(editing.id, payload) : createContract(payload);
    },
    onSuccess: () => {
      message.success(editing ? '合同已更新' : '合同已新增');
      invalidate();
      setModalOpen(false);
      setEditing(null);
    },
    onError: (err) => message.error(apiError(err, '保存失败')),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteContract(id),
    onSuccess: () => { message.success('已删除'); invalidate(); },
    onError: (err) => message.error(apiError(err, '删除失败')),
  });

  const uploadMutation = useMutation({
    mutationFn: ({ id, file }: { id: number; file: File }) => uploadContractAttachment(id, file),
    onSuccess: () => { message.success('附件已上传'); invalidate(); },
    onError: (err) => message.error(apiError(err, '上传失败')),
  });

  const delAttachMutation = useMutation({
    mutationFn: (id: number) => deleteContractAttachment(id),
    onSuccess: () => { message.success('附件已删除'); invalidate(); },
    onError: (err) => message.error(apiError(err, '删除附件失败')),
  });

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ status: 'active', sign_year: dayjs().year() });
    setModalOpen(true);
  };
  const openEdit = (c: Contract) => {
    setEditing(c);
    form.resetFields();
    form.setFieldsValue({
      partner_id: c.partner_id,
      title: c.title,
      contract_no: c.contract_no ?? undefined,
      sign_year: c.sign_year ?? undefined,
      sign_date: c.sign_date ? dayjs(c.sign_date) : null,
      start_date: c.start_date ? dayjs(c.start_date) : null,
      end_date: c.end_date ? dayjs(c.end_date) : null,
      amount: c.amount == null ? undefined : Number(c.amount),
      status: c.status,
      notes: c.notes ?? undefined,
    });
    setModalOpen(true);
  };

  const columns: TableColumnsType<Contract> = [
    {
      title: '合同', key: 'title',
      render: (_: unknown, row) => (
        <Space direction="vertical" size={0}>
          <Text strong>{row.title}</Text>
          {row.contract_no && <Text type="secondary" style={{ fontSize: 12 }}>{row.contract_no}</Text>}
        </Space>
      ),
    },
    {
      title: '合作渠道', key: 'partner', width: 170,
      render: (_: unknown, row) => (
        <Space size={4}>{row.partner_name}{partnerTypeTag(row.partner_type)}</Space>
      ),
    },
    { title: '签署年度', dataIndex: 'sign_year', key: 'sign_year', width: 90, render: (v) => v ?? <Text type="secondary">—</Text> },
    {
      title: '有效期', key: 'period', width: 200,
      render: (_: unknown, row) => (
        <Space size={4} wrap>
          <Text>{row.start_date ?? '—'} ~ {row.end_date ?? '—'}</Text>
          {row.is_expiring && <Tag color="orange">快到期</Tag>}
        </Space>
      ),
    },
    { title: '金额', dataIndex: 'amount', key: 'amount', width: 110, align: 'right', render: (v: string | null) => (v == null ? <Text type="secondary">—</Text> : `¥${v}`) },
    { title: '状态', dataIndex: 'status', key: 'status', width: 90, render: (v: ContractStatus) => <Tag color={STATUS_COLORS[v]}>{STATUS_LABELS[v]}</Tag> },
    {
      title: '附件', key: 'attachment', width: 150,
      render: (_: unknown, row) =>
        row.has_attachment ? (
          <Space size={4}>
            <Button type="link" size="small" icon={<DownloadOutlined />} onClick={() => downloadContractAttachment(row)}>下载</Button>
            {isAdmin && (
              <Popconfirm title="删除附件？" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => delAttachMutation.mutate(row.id)}>
                <Button type="link" size="small" danger>删</Button>
              </Popconfirm>
            )}
          </Space>
        ) : isAdmin ? (
          <Upload
            showUploadList={false}
            accept=".pdf,.jpg,.jpeg,.png"
            beforeUpload={(file) => {
              if (file.size > MAX_ATTACHMENT_BYTES) {
                message.error('附件不能超过 20 MB');
              } else {
                uploadMutation.mutate({ id: row.id, file });
              }
              return Upload.LIST_IGNORE;
            }}
          >
            <Button type="link" size="small" icon={<UploadOutlined />}>上传</Button>
          </Upload>
        ) : (
          <Text type="secondary">无</Text>
        ),
    },
    ...(isAdmin
      ? [{
          title: '操作', key: 'actions', width: 120, fixed: 'right' as const,
          render: (_: unknown, row: Contract) => (
            <Space size={4}>
              <Button type="link" size="small" onClick={() => openEdit(row)}>编辑</Button>
              <Popconfirm
                title="删除该合同？" description="附件一并删除，不可恢复。"
                okText="删除" okButtonProps={{ danger: true }} cancelText="取消"
                onConfirm={() => deleteMutation.mutate(row.id)}
              >
                <Button type="link" size="small" danger>删除</Button>
              </Popconfirm>
            </Space>
          ),
        } as TableColumnsType<Contract>[number]]
      : []),
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
        <Space wrap>
          <Select
            allowClear placeholder="按渠道筛选" style={{ width: 180 }}
            options={partnerOptions}
            value={filters.partner_id}
            onChange={(v) => setFilters((f) => ({ ...f, partner_id: v }))}
          />
          <Select
            allowClear placeholder="按状态筛选" style={{ width: 140 }}
            options={STATUS_OPTIONS}
            value={filters.status}
            onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
          />
          <Input.Search
            placeholder="搜索 标题 / 合同号" allowClear style={{ width: 220 }}
            onSearch={(v) => setFilters((f) => ({ ...f, q: v || undefined }))}
          />
        </Space>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => contractsQuery.refetch()} loading={contractsQuery.isFetching}>刷新</Button>
          {isAdmin && <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增合同</Button>}
        </Space>
      </div>

      <Table<Contract>
        rowKey="id"
        size="small"
        loading={contractsQuery.isLoading}
        columns={columns}
        dataSource={contractsQuery.data ?? []}
        pagination={false}
        scroll={{ x: 1100 }}
        locale={{ emptyText: '暂无合同（点「新增合同」录入年度渠道合同并上传扫描件归档）' }}
      />

      <Modal
        title={editing ? `编辑合同 ${editing.title}` : '新增渠道合同'}
        open={modalOpen}
        onCancel={() => { setModalOpen(false); setEditing(null); }}
        onOk={() => form.submit()}
        okText="保存"
        confirmLoading={saveMutation.isPending}
        width={640}
        destroyOnHidden
      >
        <Form<ContractFormValues> form={form} layout="vertical" onFinish={(v) => saveMutation.mutate(v)}>
          <Form.Item name="partner_id" label="合作渠道" rules={[{ required: true, message: '请选择合作渠道' }]}>
            <Select options={partnerOptions} placeholder="选择渠道（在「合作渠道」页维护）" showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item name="title" label="合同标题" rules={[{ required: true, message: '请填写合同标题' }]}>
            <Input placeholder="如：2026 年度中通物流配送合作合同" />
          </Form.Item>
          <Space style={{ display: 'flex' }} align="start">
            <Form.Item name="contract_no" label="合同编号" style={{ width: 240 }}>
              <Input placeholder="可空" />
            </Form.Item>
            <Form.Item name="sign_year" label="签署年度" style={{ width: 130 }}>
              <InputNumber min={1900} max={2999} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="status" label="状态" style={{ width: 130 }}>
              <Select options={STATUS_OPTIONS} />
            </Form.Item>
          </Space>
          <Space style={{ display: 'flex' }} align="start">
            <Form.Item name="sign_date" label="签署日期" style={{ width: 160 }}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="start_date" label="生效日" style={{ width: 160 }}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="end_date" label="到期日" style={{ width: 160 }}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Form.Item name="amount" label="合同金额（可空）" style={{ width: 220 }}>
            <InputNumber min={0} prefix="¥" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
          {!editing && (
            <Text type="secondary">提示：保存后可在合同行的「附件」列上传扫描件归档。</Text>
          )}
        </Form>
      </Modal>
    </div>
  );
}

// =========================================================================== //
export default function ContractManagement() {
  const { isAdmin } = useAuth();
  return (
    <div>
      <Title level={3}>合同管理</Title>
      <Card size="small" style={{ marginBottom: 12 }}>
        <Text type="secondary">
          登记与归档<Text strong>上游物流 / 发行 / 零售渠道</Text>（中通、北京市报刊发行局、北京报刊零售局、成都邮征天下、广州日报等）的年度合同：合同信息 + 扫描件归档。合同挂在「合作渠道」下；
          {isAdmin ? '可在两个页签内增删改、上传附件。' : '仅管理员可编辑，您可查看与下载附件。'}
        </Text>
      </Card>
      <Tabs
        items={[
          { key: 'contracts', label: '合同', children: <ContractsPanel isAdmin={isAdmin} /> },
          { key: 'partners', label: '合作渠道', children: <PartnersPanel isAdmin={isAdmin} /> },
        ]}
      />
    </div>
  );
}
