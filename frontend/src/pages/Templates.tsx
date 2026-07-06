import { useState, useMemo, useRef } from 'react';
import {
  Card,
  Row,
  Col,
  Button,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  Space,
  message,
  Popconfirm,
  Tooltip,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  InfoCircleOutlined,
  FileTextOutlined,
  AppstoreOutlined,
  SyncOutlined,
  BarChartOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Template, TemplateCreate } from '../api/templates';
import {
  getTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  reorderTemplates,
} from '../api/templates';
import { categoryLabels, categoryOrder, categoryFrequency, categoryLabel } from './reportCategories';

const categoryOptions = categoryOrder
  .filter((c) => categoryLabels[c])
  .map((c) => ({ value: c, label: `${categoryLabels[c]}（${c}）` }));

interface Group {
  category: string;
  items: Template[];
}

export default function Templates() {
  const queryClient = useQueryClient();
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [saving, setSaving] = useState(false);
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [form] = Form.useForm();

  const dragItem = useRef<{ id: number; category: string } | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['templates'],
    queryFn: () => getTemplates().then((r) => r.data),
  });

  const stats = useMemo(() => {
    const total = templates.length;
    const categories = new Set(templates.map((t) => t.category)).size;
    const variable = templates.filter((t) => t.is_variable).length;
    const defaultSum = templates.reduce((s, t) => s + (t.default_value || 0), 0);
    return { total, categories, variable, fixed: total - variable, defaultSum };
  }, [templates]);

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Template[]>();
    for (const t of templates) {
      if (!map.has(t.category)) map.set(t.category, []);
      map.get(t.category)!.push(t);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.sort_order - b.sort_order);
    const cats = Array.from(map.keys());
    cats.sort((a, b) => {
      const ia = categoryOrder.indexOf(a);
      const ib = categoryOrder.indexOf(b);
      const oa = ia === -1 ? 999 : ia;
      const ob = ib === -1 ? 999 : ib;
      if (oa !== ob) return oa - ob;
      return (map.get(a)![0]?.sort_order ?? 0) - (map.get(b)![0]?.sort_order ?? 0);
    });
    return cats.map((category) => ({ category, items: map.get(category)! }));
  }, [templates]);

  const visibleGroups = filterCategory ? groups.filter((g) => g.category === filterCategory) : groups;

  const openCreate = (category?: string) => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      default_value: 0,
      is_variable: false,
      sort_order: 0,
      category: category ? [category] : undefined,
    });
    setModalVisible(true);
  };

  const openEdit = (record: Template) => {
    setEditing(record);
    form.setFieldsValue({
      category: [record.category],
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
      const raw = await form.validateFields();
      const category = Array.isArray(raw.category)
        ? String(raw.category[raw.category.length - 1] ?? '').trim()
        : String(raw.category ?? '').trim();
      const values = { ...raw, category };
      setSaving(true);
      if (editing) {
        await updateTemplate(editing.id, values);
        message.success('模板已更新');
      } else {
        await createTemplate(values as TemplateCreate);
        message.success('模板已创建');
      }
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      setModalVisible(false);
    } catch {
      // validation error or API error (surfaced by interceptor)
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteTemplate(id);
      message.success('模板已删除');
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    } catch {
      message.error('删除失败');
    }
  };

  // ----- drag reorder (within a category) -----
  const handleDragStart = (item: Template) => {
    dragItem.current = { id: item.id, category: item.category };
  };
  const handleDragOver = (e: React.DragEvent, overItem: Template) => {
    if (dragItem.current && dragItem.current.category === overItem.category) {
      e.preventDefault();
      if (dragOverId !== overItem.id) setDragOverId(overItem.id);
    }
  };
  const handleDragEnd = () => {
    dragItem.current = null;
    setDragOverId(null);
  };
  const handleDrop = async (overItem: Template) => {
    const src = dragItem.current;
    handleDragEnd();
    if (!src || src.category !== overItem.category || src.id === overItem.id) return;

    const group = groups.find((g) => g.category === overItem.category);
    if (!group) return;
    const items = group.items;
    const fromIdx = items.findIndex((i) => i.id === src.id);
    const toIdx = items.findIndex((i) => i.id === overItem.id);
    if (fromIdx < 0 || toIdx < 0) return;

    const arr = [...items];
    const [moved] = arr.splice(fromIdx, 1);
    arr.splice(toIdx, 0, moved);

    // Reassign the category's existing sort_order pool to the new order,
    // so the category keeps its numeric range and other groups are untouched.
    const pool = items.map((i) => i.sort_order).sort((a, b) => a - b);
    const newSort = new Map<number, number>();
    arr.forEach((item, idx) => newSort.set(item.id, pool[idx]));
    const updates = arr
      .map((item, idx) => ({ id: item.id, sort_order: pool[idx] }))
      .filter((u) => {
        const orig = items.find((i) => i.id === u.id);
        return orig && orig.sort_order !== u.sort_order;
      });
    if (updates.length === 0) return;

    // optimistic update
    queryClient.setQueryData<Template[]>(['templates'], (old) =>
      old ? old.map((t) => (newSort.has(t.id) ? { ...t, sort_order: newSort.get(t.id)! } : t)) : old,
    );
    try {
      await reorderTemplates(updates);
    } catch {
      message.error('排序保存失败');
    } finally {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    }
  };

  const statCards = [
    {
      icon: <FileTextOutlined style={{ fontSize: 21, color: 'var(--color-accent)' }} />,
      bg: 'rgba(0, 113, 227, 0.08)',
      label: '模板项目',
      value: stats.total,
      suffix: '项',
      sub: '每期报数的行数',
    },
    {
      icon: <AppstoreOutlined style={{ fontSize: 21, color: '#722ed1' }} />,
      bg: 'rgba(114, 46, 209, 0.08)',
      label: '类别',
      value: stats.categories,
      suffix: '类',
      sub: '北京邮发 / 报零 / 广州…',
    },
    {
      icon: <SyncOutlined style={{ fontSize: 21, color: 'var(--color-accent)' }} />,
      bg: 'rgba(0, 113, 227, 0.08)',
      label: '变动项',
      value: stats.variable,
      suffix: '项',
      sub: `每期需重新填写（固定 ${stats.fixed} 项）`,
    },
    {
      icon: <BarChartOutlined style={{ fontSize: 21, color: '#52c41a' }} />,
      bg: 'rgba(82, 196, 26, 0.08)',
      label: '默认值合计',
      value: stats.defaultSum.toLocaleString(),
      suffix: '份',
      sub: '新建报数的基线印数',
    },
  ];

  return (
    <div className="tmpl-page">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 16 }}>
        <div>
          <h2
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: '#1d1d1f',
              margin: 0,
              letterSpacing: '-0.02em',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            报数模板
            <Tooltip title="定义每期《报数》包含哪些项目——新建报数时按此母表逐行生成">
              <InfoCircleOutlined style={{ fontSize: 15, color: 'var(--color-text-secondary)' }} />
            </Tooltip>
          </h2>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '6px 0 0', maxWidth: 640, lineHeight: 1.6 }}>
            定义每期《报数》包含哪些项目，新建报数时按这张母表逐行生成。按类别分组，和印数报数里的报表结构一致。
          </p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreate()}>
          新增项目
        </Button>
      </div>

      <Row gutter={16} style={{ marginBottom: 20 }}>
        {statCards.map((card, idx) => (
          <Col xs={12} md={6} key={idx} style={{ display: 'flex' }}>
            <Card loading={isLoading} className="dashboard-stat-card" size="small" style={{ flex: 1 }}>
              <div className="dashboard-stat-card-inner">
                <div className="dashboard-stat-icon" style={{ background: card.bg }}>
                  {card.icon}
                </div>
                <div className="dashboard-stat-content">
                  <div className="dashboard-stat-label">{card.label}</div>
                  <div className="dashboard-stat-value">
                    {card.value}
                    <span className="dashboard-stat-suffix"> {card.suffix}</span>
                  </div>
                  <div className="dashboard-stat-sub">{card.sub}</div>
                </div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      <div className="tmpl-card">
        <div className="tmpl-toolbar">
          <div className="tmpl-chips">
            <span className={`tmpl-chip ${!filterCategory ? 'on' : ''}`} onClick={() => setFilterCategory(null)}>
              全部 <span className="n">{stats.total}</span>
            </span>
            {groups.map((g) => (
              <span
                key={g.category}
                className={`tmpl-chip ${filterCategory === g.category ? 'on' : ''}`}
                onClick={() => setFilterCategory(g.category)}
              >
                {categoryLabel(g.category)} <span className="n">{g.items.length}</span>
              </span>
            ))}
          </div>
          <span className="tmpl-toolbar-count">
            共 <b>{stats.total}</b> 项 · <b>{stats.categories}</b> 类
          </span>
        </div>

        <table className="tmpl-table">
          <thead>
            <tr>
              <th style={{ width: 30 }} />
              <th>子类别</th>
              <th>显示名称</th>
              <th className="r" style={{ width: 110 }}>默认值</th>
              <th className="c" style={{ width: 100 }}>变动项</th>
              <th className="r" style={{ width: 80 }}>排序</th>
              <th className="c" style={{ width: 96 }}>操作</th>
            </tr>
          </thead>

          {visibleGroups.map((group) => {
            const subtotal = group.items.reduce((s, i) => s + (i.default_value || 0), 0);
            const freq = categoryFrequency[group.category];
            return (
              <tbody key={group.category}>
                <tr className="tmpl-grp">
                  <td colSpan={7}>
                    <div className="tmpl-grp-inner">
                      <span className="tmpl-cat-tag">{categoryLabel(group.category)}</span>
                      {freq && <span className="tmpl-freq">{freq}</span>}
                      <span className="tmpl-grp-meta">
                        <b>{group.items.length}</b> 项 · 合计 <b>{subtotal.toLocaleString()}</b> 份
                      </span>
                      <span className="tmpl-grp-add" onClick={() => openCreate(group.category)}>
                        <PlusOutlined /> 在此类别新增
                      </span>
                    </div>
                  </td>
                </tr>
                {group.items.map((item) => (
                  <tr
                    key={item.id}
                    className={`tmpl-item ${dragOverId === item.id ? 'tmpl-dragover' : ''}`}
                    draggable
                    onDragStart={() => handleDragStart(item)}
                    onDragOver={(e) => handleDragOver(e, item)}
                    onDrop={() => handleDrop(item)}
                    onDragEnd={handleDragEnd}
                  >
                    <td className="tmpl-drag" title="拖动改排序">⠿</td>
                    <td className="tmpl-sub">{item.sub_category}</td>
                    <td className="tmpl-disp">{item.display_name}</td>
                    <td className="r tmpl-num">{item.default_value.toLocaleString()}</td>
                    <td className="c">
                      <span className={`tmpl-tag ${item.is_variable ? 'var' : 'fixed'}`}>
                        <span className="tmpl-tag-dot" />
                        {item.is_variable ? '变动' : '固定'}
                      </span>
                    </td>
                    <td className="r tmpl-num tmpl-sortnum">{item.sort_order}</td>
                    <td className="c">
                      <Space size={2}>
                        <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(item)} />
                        <Popconfirm
                          title="确定删除此项目？"
                          okText="删除"
                          cancelText="取消"
                          onConfirm={() => handleDelete(item.id)}
                        >
                          <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                        </Popconfirm>
                      </Space>
                    </td>
                  </tr>
                ))}
              </tbody>
            );
          })}
        </table>

        {!isLoading && stats.total === 0 && (
          <div className="tmpl-empty">暂无模板项目，点击右上角「新增项目」添加。</div>
        )}
      </div>

      <Modal
        title={editing ? '编辑模板' : '新增模板'}
        open={modalVisible}
        onOk={handleSave}
        confirmLoading={saving}
        onCancel={() => setModalVisible(false)}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item name="category" label="类别" rules={[{ required: true, message: '请选择或输入类别' }]}>
            <Select placeholder="选择或输入类别" mode="tags" maxCount={1} options={categoryOptions} />
          </Form.Item>
          <Form.Item name="sub_category" label="子类别" rules={[{ required: true, message: '请输入子类别' }]}>
            <Input placeholder="例如: 外埠、本市" />
          </Form.Item>
          <Form.Item name="display_name" label="显示名称" rules={[{ required: true, message: '请输入显示名称' }]}>
            <Input placeholder="报表中显示的名称" />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            <Form.Item name="default_value" label="默认值">
              <InputNumber placeholder="0" style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="is_variable" label="变动项" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="sort_order" label="排序">
              <InputNumber placeholder="0" style={{ width: '100%' }} />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
