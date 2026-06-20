import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Space,
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
import type { CoverageRule, Product } from '../api/products';
import {
  COVERAGE_RULE_LABELS,
  ProductFormFields,
  buildProductPayload,
} from './ProductForm';
import type { ProductFormValues } from './ProductForm';
import {
  billingTypeLabel,
  deliveryMethodLabel,
  fulfillmentTypeLabel,
  publicationLabel,
  subscriptionTermLabel,
} from './orderUtils';

const { Title, Text } = Typography;

export default function ProductCatalog() {
  const queryClient = useQueryClient();
  const [form] = Form.useForm<ProductFormValues>();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [search, setSearch] = useState('');

  const productsQuery = useQuery({
    queryKey: productQueryKeys.list({ q: search || undefined }),
    queryFn: async () => (await listProducts({ q: search || undefined })).data,
  });

  const saveMutation = useMutation({
    mutationFn: async (values: ProductFormValues) => {
      const payload = buildProductPayload(values);
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
      { title: '类型', dataIndex: 'fulfillment_type', key: 'fulfillment_type', width: 80, render: (v) => fulfillmentTypeLabel(v) },
      { title: '期限', dataIndex: 'subscription_term', key: 'subscription_term', width: 80, render: (v) => (v ? subscriptionTermLabel(v) : '-') },
      { title: '投递', dataIndex: 'delivery_method', key: 'delivery_method', width: 110, render: (v) => (v ? deliveryMethodLabel(v) : '-') },
      { title: '覆盖期算法', dataIndex: 'coverage_rule', key: 'coverage_rule', width: 110, render: (v: CoverageRule) => COVERAGE_RULE_LABELS[v] ?? v },
      { title: '参考价', dataIndex: 'list_price', key: 'list_price', width: 90, align: 'right', render: (v: string) => `¥${v}` },
      {
        title: '别名',
        dataIndex: 'aliases',
        key: 'aliases',
        render: (aliases: string[] | null) =>
          aliases?.length ? aliases.map((a) => <Tag key={a}>{a}</Tag>) : <Text type="secondary">-</Text>,
      },
      { title: '计费', dataIndex: 'billing_type', key: 'billing_type', width: 90, render: (v) => billingTypeLabel(v) },
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
        destroyOnHidden
      >
        <Form<ProductFormValues> form={form} layout="vertical" onFinish={(v) => saveMutation.mutate(v)}>
          <ProductFormFields editing={!!editing} />
        </Form>
      </Modal>
    </div>
  );
}
