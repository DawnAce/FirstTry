import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import type { TableColumnsType } from 'antd';
import {
  createProduct,
  deactivateProduct,
  listProducts,
  productQueryKeys,
  updateProduct,
} from '../api/products';
import type { CoverageRule, Product, ProductCreatePayload } from '../api/products';
import {
  billingTypeLabel,
  deliveryMethodLabel,
  fulfillmentTypeLabel,
  publicationLabel,
  subscriptionTermLabel,
} from './orderUtils';

const { Title, Text } = Typography;

const PUBLICATION_OPTIONS = [
  { label: '中国经营报', value: 'cbj' },
  { label: '商学院', value: 'business_school' },
  { label: '其他', value: 'other' },
];
const FORMAT_OPTIONS = [
  { label: '纸质', value: 'paper' },
  { label: '电子', value: 'digital' },
];
const FULFILLMENT_OPTIONS = [
  { label: '订阅', value: 'subscription' },
  { label: '单期', value: 'single_issue' },
  { label: '赠阅', value: 'gift' },
  { label: '补寄', value: 'makeup' },
  { label: '续订', value: 'extension' },
  { label: '换订', value: 'replacement' },
];
const TERM_OPTIONS = [
  { label: '半年', value: 'half_year' },
  { label: '一年', value: 'one_year' },
  { label: '自定义', value: 'custom' },
];
const DELIVERY_OPTIONS = [
  { label: '邮局投递', value: 'post_office' },
  { label: 'ZTO-MF 快递', value: 'zto_mf' },
];
const BILLING_OPTIONS = [
  { label: '付费', value: 'paid' },
  { label: '免费赠阅', value: 'free_gift' },
  { label: '搭赠', value: 'bundle_gift' },
];
const COVERAGE_RULE_OPTIONS: Array<{ label: string; value: CoverageRule }> = [
  { label: '按起投月算（订阅）', value: 'term_from_month' },
  { label: '最新一期（单期）', value: 'latest_issue' },
  { label: '固定日期', value: 'explicit' },
  { label: '自定义', value: 'custom' },
];

const COVERAGE_RULE_LABELS: Record<CoverageRule, string> = {
  term_from_month: '按起投月算',
  latest_issue: '最新一期',
  explicit: '固定日期',
  custom: '自定义',
};

interface FormValues {
  code: string;
  display_name: string;
  aliases?: string[];
  is_bundle?: boolean;
  publication?: string | null;
  publication_format?: string;
  fulfillment_type: string;
  subscription_term?: string | null;
  delivery_method?: string | null;
  coverage_rule?: CoverageRule;
  list_price?: number;
  billing_type?: string;
  components?: Array<{ publication: string; fixed_price?: number; remainder?: boolean }>;
  active?: boolean;
  notes?: string;
}

export default function ProductCatalog() {
  const queryClient = useQueryClient();
  const [form] = Form.useForm<FormValues>();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [search, setSearch] = useState('');
  const isBundle = Form.useWatch('is_bundle', form);

  const productsQuery = useQuery({
    queryKey: productQueryKeys.list({ q: search || undefined }),
    queryFn: async () => (await listProducts({ q: search || undefined })).data,
  });

  const saveMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload: ProductCreatePayload = {
        code: values.code,
        display_name: values.display_name,
        aliases: values.aliases?.length ? values.aliases : null,
        is_bundle: !!values.is_bundle,
        publication: (values.is_bundle ? null : (values.publication ?? null)) as ProductCreatePayload['publication'],
        publication_format: (values.publication_format ?? 'paper') as ProductCreatePayload['publication_format'],
        fulfillment_type: values.fulfillment_type as ProductCreatePayload['fulfillment_type'],
        subscription_term: (values.subscription_term as ProductCreatePayload['subscription_term']) ?? null,
        delivery_method: (values.delivery_method as ProductCreatePayload['delivery_method']) ?? null,
        coverage_rule: values.coverage_rule ?? 'term_from_month',
        list_price: values.list_price ?? 0,
        billing_type: (values.billing_type as ProductCreatePayload['billing_type']) ?? 'paid',
        components: values.is_bundle
          ? (values.components ?? []).map((c) => ({
              publication: c.publication as never,
              fixed_price: c.remainder ? null : (c.fixed_price ?? null),
              remainder: !!c.remainder,
            }))
          : null,
        active: values.active ?? true,
        notes: values.notes || null,
      };
      if (editing) {
        const { code: _code, ...rest } = payload;
        return updateProduct(editing.id, rest);
      }
      return createProduct(payload);
    },
    onSuccess: () => {
      message.success(editing ? '商品已更新' : '商品已新增');
      queryClient.invalidateQueries({ queryKey: productQueryKeys.all });
      setModalOpen(false);
      setEditing(null);
    },
    onError: (err: { response?: { data?: { detail?: string } } }) => {
      message.error(err.response?.data?.detail ?? '保存失败');
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: number) => deactivateProduct(id),
    onSuccess: () => {
      message.success('已停用');
      queryClient.invalidateQueries({ queryKey: productQueryKeys.all });
    },
    onError: () => message.error('停用失败'),
  });

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      publication_format: 'paper',
      fulfillment_type: 'subscription',
      coverage_rule: 'term_from_month',
      billing_type: 'paid',
      active: true,
      is_bundle: false,
    });
    setModalOpen(true);
  };

  const openEdit = (p: Product) => {
    setEditing(p);
    form.resetFields();
    form.setFieldsValue({
      code: p.code,
      display_name: p.display_name,
      aliases: p.aliases ?? [],
      is_bundle: p.is_bundle,
      publication: p.publication,
      publication_format: p.publication_format,
      fulfillment_type: p.fulfillment_type,
      subscription_term: p.subscription_term,
      delivery_method: p.delivery_method,
      coverage_rule: p.coverage_rule,
      list_price: Number(p.list_price),
      billing_type: p.billing_type,
      components: (p.components ?? []).map((c) => ({
        publication: c.publication,
        fixed_price: c.fixed_price == null ? undefined : Number(c.fixed_price),
        remainder: !!c.remainder,
      })),
      active: p.active,
      notes: p.notes ?? undefined,
    });
    setModalOpen(true);
  };

  const reactivate = (p: Product) =>
    updateProduct(p.id, { active: true }).then(() => {
      message.success('已启用');
      queryClient.invalidateQueries({ queryKey: productQueryKeys.all });
    });

  const columns: TableColumnsType<Product> = useMemo(
    () => [
      {
        title: '商品名称（电商原文）',
        dataIndex: 'display_name',
        key: 'display_name',
        render: (name: string, row) => (
          <Space direction="vertical" size={0}>
            <Text>{name}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>{row.code}</Text>
          </Space>
        ),
      },
      {
        title: '刊物',
        key: 'publication',
        width: 110,
        render: (_: unknown, row) =>
          row.is_bundle ? <Tag color="purple">套餐</Tag> : <Tag color="blue">{publicationLabel(row.publication ?? 'other')}</Tag>,
      },
      {
        title: '类型',
        dataIndex: 'fulfillment_type',
        key: 'fulfillment_type',
        width: 80,
        render: (v) => fulfillmentTypeLabel(v),
      },
      {
        title: '期限',
        dataIndex: 'subscription_term',
        key: 'subscription_term',
        width: 80,
        render: (v) => (v ? subscriptionTermLabel(v) : '-'),
      },
      {
        title: '投递',
        dataIndex: 'delivery_method',
        key: 'delivery_method',
        width: 110,
        render: (v) => (v ? deliveryMethodLabel(v) : '-'),
      },
      {
        title: '覆盖期算法',
        dataIndex: 'coverage_rule',
        key: 'coverage_rule',
        width: 110,
        render: (v: CoverageRule) => COVERAGE_RULE_LABELS[v] ?? v,
      },
      {
        title: '参考价',
        dataIndex: 'list_price',
        key: 'list_price',
        width: 90,
        align: 'right',
        render: (v: string) => `¥${v}`,
      },
      {
        title: '别名',
        dataIndex: 'aliases',
        key: 'aliases',
        render: (aliases: string[] | null) =>
          aliases?.length ? aliases.map((a) => <Tag key={a}>{a}</Tag>) : <Text type="secondary">-</Text>,
      },
      {
        title: '计费',
        dataIndex: 'billing_type',
        key: 'billing_type',
        width: 90,
        render: (v) => billingTypeLabel(v),
      },
      {
        title: '状态',
        dataIndex: 'active',
        key: 'active',
        width: 80,
        render: (active: boolean) =>
          active ? <Tag color="green">启用</Tag> : <Tag color="default">停用</Tag>,
      },
      {
        title: '操作',
        key: 'actions',
        width: 130,
        fixed: 'right',
        render: (_: unknown, row) => (
          <Space size={4}>
            <Button type="link" size="small" onClick={() => openEdit(row)}>编辑</Button>
            {row.active ? (
              <Button type="link" size="small" danger onClick={() => deactivateMutation.mutate(row.id)}>停用</Button>
            ) : (
              <Button type="link" size="small" onClick={() => reactivate(row)}>启用</Button>
            )}
          </Space>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>商品库</Title>
        <Space>
          <Input.Search placeholder="搜索编码 / 名称" allowClear style={{ width: 220 }} onSearch={setSearch} />
          <Button icon={<ReloadOutlined />} onClick={() => productsQuery.refetch()} loading={productsQuery.isFetching}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增商品</Button>
        </Space>
      </div>

      <Card size="small" style={{ marginBottom: 12 }}>
        <Text type="secondary">
          商品库把电商的商品名「翻译」成订单信息。新出一个促销 = 加一行，不用改代码；导入时系统照此自动识别（识别不到的会进「待确认」）。
        </Text>
      </Card>

      <Table<Product>
        rowKey="id"
        columns={columns}
        dataSource={productsQuery.data ?? []}
        loading={productsQuery.isLoading}
        scroll={{ x: 1300 }}
        pagination={false}
      />

      <Modal
        title={editing ? `编辑商品 ${editing.code}` : '新增商品'}
        open={modalOpen}
        onCancel={() => { setModalOpen(false); setEditing(null); }}
        onOk={() => form.submit()}
        okText="保存"
        confirmLoading={saveMutation.isPending}
        width={640}
        destroyOnClose
      >
        <Form<FormValues> form={form} layout="vertical" onFinish={(v) => saveMutation.mutate(v)}>
          <Form.Item name="display_name" label="商品名称（电商原文）" rules={[{ required: true, message: '请填写商品名称' }]}>
            <Input placeholder="如：《中国经营报》全年订阅-618促销活动" />
          </Form.Item>
          <Form.Item name="code" label="商品编码（唯一）" rules={[{ required: true, message: '请填写编码' }]}>
            <Input placeholder="如：CBJ-SUB-1Y-PROMO" disabled={!!editing} />
          </Form.Item>
          <Form.Item name="aliases" label="别名（活动后缀归一）" tooltip="如「618促销活动」「双十一订阅优惠」">
            <Select mode="tags" placeholder="回车添加" />
          </Form.Item>

          <Form.Item name="is_bundle" label="是否套餐（多刊合售）" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Space style={{ display: 'flex' }} align="start">
            {!isBundle && (
              <Form.Item name="publication" label="刊物" rules={[{ required: true, message: '非套餐必须选刊物' }]} style={{ width: 180 }}>
                <Select options={PUBLICATION_OPTIONS} />
              </Form.Item>
            )}
            <Form.Item name="publication_format" label="版式" style={{ width: 140 }}>
              <Select options={FORMAT_OPTIONS} />
            </Form.Item>
          </Space>

          <Space style={{ display: 'flex' }} align="start">
            <Form.Item name="fulfillment_type" label="履约类型" rules={[{ required: true }]} style={{ width: 180 }}>
              <Select options={FULFILLMENT_OPTIONS} />
            </Form.Item>
            <Form.Item name="subscription_term" label="订阅期限" style={{ width: 140 }}>
              <Select allowClear options={TERM_OPTIONS} />
            </Form.Item>
            <Form.Item name="delivery_method" label="投递方式（默认）" style={{ width: 180 }}>
              <Select allowClear options={DELIVERY_OPTIONS} />
            </Form.Item>
          </Space>

          <Space style={{ display: 'flex' }} align="start">
            <Form.Item name="coverage_rule" label="覆盖期算法" style={{ width: 200 }}>
              <Select options={COVERAGE_RULE_OPTIONS} />
            </Form.Item>
            <Form.Item name="list_price" label="参考价（仅对账提示）" style={{ width: 160 }}>
              <InputNumber min={0} style={{ width: '100%' }} prefix="¥" />
            </Form.Item>
            <Form.Item name="billing_type" label="计费" style={{ width: 140 }}>
              <Select options={BILLING_OPTIONS} />
            </Form.Item>
          </Space>

          {isBundle && (
            <Card size="small" title="套餐组件（按固定价 + 余额拆分）" style={{ marginBottom: 12 }}>
              <Form.List name="components">
                {(fields, { add, remove }) => (
                  <>
                    {fields.map((field) => (
                      <Space key={field.key} align="baseline" style={{ display: 'flex', marginBottom: 4 }}>
                        <Form.Item {...field} name={[field.name, 'publication']} rules={[{ required: true, message: '选刊物' }]}>
                          <Select options={PUBLICATION_OPTIONS} placeholder="刊物" style={{ width: 150 }} />
                        </Form.Item>
                        <Form.Item {...field} name={[field.name, 'fixed_price']}>
                          <InputNumber min={0} placeholder="固定价" prefix="¥" style={{ width: 130 }} />
                        </Form.Item>
                        <Form.Item {...field} name={[field.name, 'remainder']} valuePropName="checked">
                          <Checkbox>拿余额</Checkbox>
                        </Form.Item>
                        <Button danger type="link" onClick={() => remove(field.name)}>删</Button>
                      </Space>
                    ))}
                    <Button type="dashed" onClick={() => add({})} block icon={<PlusOutlined />}>加一个刊物</Button>
                  </>
                )}
              </Form.List>
            </Card>
          )}

          <Form.Item name="active" label="状态" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="停用" />
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
