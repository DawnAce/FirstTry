import { useState } from 'react';
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  Space,
  Message,
  Popconfirm,
  Tag,
} from '@arco-design/web-react';
import { IconPlus, IconEdit, IconDelete } from '@arco-design/web-react/icon';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnProps } from '@arco-design/web-react/es/Table';
import type { Template, TemplateCreate } from '../api/templates';
import {
  getTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} from '../api/templates';

const categoryLabels: Record<string, string> = {
  postal: '北京邮发',
  retail: '北京报零',
  guangzhou: '广州日报',
  chengdu: '成都杂志铺',
  guotumao: '国图贸',
  social_use: '社用报',
  binding: '合订本（印厂留存）',
};

const categoryOptions = Object.entries(categoryLabels).map(([value, label]) => ({
  value,
  label: `${label}（${value}）`,
}));

export default function Templates() {
  const queryClient = useQueryClient();
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['templates'],
    queryFn: () => getTemplates().then((r) => r.data),
  });

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ default_value: 0, is_variable: false, sort_order: 0 });
    setModalVisible(true);
  };

  const openEdit = (record: Template) => {
    setEditing(record);
    form.setFieldsValue({
      category: record.category,
      sub_category: record.sub_category,
      display_name: record.display_name,
      default_value: record.default_value,
      is_variable: record.is_variable,
      sort_order: record.sort_order,
    });
    setModalVisible(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validate();
      setSaving(true);
      if (editing) {
        await updateTemplate(editing.id, values);
        Message.success('模板已更新');
      } else {
        await createTemplate(values as TemplateCreate);
        Message.success('模板已创建');
      }
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      setModalVisible(false);
    } catch {
      // validation error or API error
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteTemplate(id);
      Message.success('模板已删除');
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    } catch {
      Message.error('删除失败');
    }
  };

  const columns: ColumnProps<Template>[] = [
    {
      title: '类别',
      dataIndex: 'category',
      width: 160,
      render: (val: string) => (
        <Tag color="arcoblue">{categoryLabels[val] || val}</Tag>
      ),
      filters: categoryOptions.map((o) => ({ text: o.label, value: o.value })),
      onFilter: (value, record) => record.category === value,
    },
    {
      title: '子类别',
      dataIndex: 'sub_category',
      width: 160,
    },
    {
      title: '显示名称',
      dataIndex: 'display_name',
      width: 180,
    },
    {
      title: '默认值',
      dataIndex: 'default_value',
      width: 100,
      align: 'right' as const,
    },
    {
      title: '变动项',
      dataIndex: 'is_variable',
      width: 90,
      align: 'center' as const,
      render: (val: boolean) => (
        <Tag color={val ? 'green' : 'gray'}>{val ? '是' : '否'}</Tag>
      ),
    },
    {
      title: '排序',
      dataIndex: 'sort_order',
      width: 80,
      align: 'right' as const,
      sorter: (a: Template, b: Template) => a.sort_order - b.sort_order,
    },
    {
      title: '操作',
      width: 140,
      align: 'center' as const,
      render: (_: unknown, record: Template) => (
        <Space>
          <Button
            type="text"
            size="small"
            icon={<IconEdit />}
            onClick={() => openEdit(record)}
          />
          <Popconfirm
            title="确定删除此模板？"
            onOk={() => handleDelete(record.id)}
          >
            <Button type="text" size="small" status="danger" icon={<IconDelete />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#1d1d1f' }}>模板管理</h2>
        <Button type="primary" icon={<IconPlus />} onClick={openCreate}>
          新增项目
        </Button>
      </div>

      <Table
        rowKey="id"
        columns={columns}
        data={templates}
        loading={isLoading}
        pagination={{ pageSize: 50 }}
        scroll={{ y: 'calc(100vh - 240px)' }}
        style={{ background: '#fff', borderRadius: 12 }}
      />

      <Modal
        title={editing ? '编辑模板' : '新增模板'}
        visible={modalVisible}
        onOk={handleSave}
        confirmLoading={saving}
        onCancel={() => setModalVisible(false)}
        autoFocus={false}
        unmountOnExit
      >
        <Form form={form} layout="vertical">
          <Form.Item
            field="category"
            label="类别"
            rules={[{ required: true, message: '请选择或输入类别' }]}
          >
            <Select
              placeholder="选择或输入类别"
              allowCreate
              options={categoryOptions}
            />
          </Form.Item>
          <Form.Item
            field="sub_category"
            label="子类别"
            rules={[{ required: true, message: '请输入子类别' }]}
          >
            <Input placeholder="例如: 外埠、本市" />
          </Form.Item>
          <Form.Item
            field="display_name"
            label="显示名称"
            rules={[{ required: true, message: '请输入显示名称' }]}
          >
            <Input placeholder="报表中显示的名称" />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            <Form.Item field="default_value" label="默认值">
              <InputNumber placeholder="0" style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              field="is_variable"
              label="变动项"
              triggerPropName="checked"
            >
              <Switch />
            </Form.Item>
            <Form.Item field="sort_order" label="排序">
              <InputNumber placeholder="0" style={{ width: '100%' }} />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
