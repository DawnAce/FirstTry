import { useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Spin,
  Table,
  Tag,
  message,
} from 'antd';
import type { TableColumnsType } from 'antd';
import {
  CheckCircleOutlined,
  EditOutlined,
  FileExcelOutlined,
  LeftOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { getIssue } from '../api/issues';
import { getShippingDetails } from '../api/shippingDetails';
import type { ShippingDetail } from '../api/shippingDetails';
import {
  addWaybillImportRow,
  confirmWaybillImport,
  getWaybillImportDraft,
  previewWaybillImport,
  updateWaybillImportRow,
} from '../api/shippingWaybills';
import type {
  WaybillImportBatch,
  WaybillImportRow,
  WaybillImportRowInput,
} from '../api/shippingWaybills';
import { logisticsApiErrorMessage } from './logisticsIssueState';
import { filterWaybillRows, unresolvedStatuses } from './waybillImportUtils';
import type { RowFilter } from './waybillImportUtils';

const statusMeta: Record<WaybillImportRow['match_status'], { label: string; color: string }> = {
  matched: { label: '已匹配', color: 'green' },
  unmatched: { label: '待人工匹配', color: 'orange' },
  ambiguous: { label: '匹配不唯一', color: 'gold' },
  duplicate: { label: '重复运单', color: 'red' },
  invalid: { label: '未识别 / 无效', color: 'volcano' },
  ignored: { label: '已忽略', color: 'default' },
};

interface RowFormValues {
  carrier: string;
  tracking_no?: string;
  recipient_name: string;
  phone?: string;
  address?: string;
  quantity: number;
  no_tracking_required: boolean;
  shipping_detail_id?: number;
}

function detailLabel(detail: ShippingDetail): string {
  const contact = [detail.phone, detail.address].filter(Boolean).join(' · ');
  return `${detail.name} · ${detail.quantity}份${contact ? ` · ${contact}` : ''}`;
}

export default function WaybillImportWorkbench() {
  const { id } = useParams<{ id: string }>();
  const issueId = Number(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const forceReparseRef = useRef(false);
  const [batchOverride, setBatch] = useState<WaybillImportBatch | null | undefined>(undefined);
  const [filter, setFilter] = useState<RowFilter>('unresolved');
  const [parsing, setParsing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [editingRow, setEditingRow] = useState<WaybillImportRow | null>(null);
  const [addingRow, setAddingRow] = useState(false);
  const [savingRow, setSavingRow] = useState(false);
  const [rowForm] = Form.useForm<RowFormValues>();

  const issueQuery = useQuery({
    queryKey: ['issue', issueId],
    queryFn: async () => (await getIssue(issueId)).data,
    enabled: Number.isFinite(issueId),
  });
  const draftQuery = useQuery({
    queryKey: ['waybillImportDraft', issueId],
    queryFn: async () => (await getWaybillImportDraft(issueId)).data,
    enabled: Number.isFinite(issueId),
    retry: false,
  });
  const detailsQuery = useQuery({
    queryKey: ['shippingDetailsAll', issueQuery.data?.issue_number, 'waybill-workbench'],
    queryFn: async () => (await getShippingDetails({ issue_number: issueQuery.data!.issue_number })).data,
    enabled: issueQuery.data?.issue_number != null,
  });

  const batch = batchOverride === undefined ? draftQuery.data ?? null : batchOverride;
  const details = useMemo(() => detailsQuery.data ?? [], [detailsQuery.data]);
  const detailsById = useMemo(() => new Map(details.map((detail) => [detail.id, detail])), [details]);
  const unresolvedQuantity = useMemo(
    () => batch?.rows.filter((row) => unresolvedStatuses.has(row.match_status))
      .reduce((sum, row) => sum + Math.max(row.quantity, 0), 0) ?? 0,
    [batch],
  );
  const visibleRows = useMemo(() => filterWaybillRows(batch?.rows ?? [], filter), [batch, filter]);

  const openFilePicker = (forceReparse: boolean) => {
    forceReparseRef.current = forceReparse;
    fileInputRef.current?.click();
  };

  const handleFile = async (file: File) => {
    setParsing(true);
    try {
      const response = await previewWaybillImport(issueId, file, forceReparseRef.current);
      setBatch(response.data);
      setFilter(response.data.unmatched_rows > 0 ? 'unresolved' : 'all');
      queryClient.setQueryData(['waybillImportDraft', issueId], response.data.status === 'previewed' ? response.data : null);
      message.success(response.data.status === 'confirmed' ? '该文件已经确认导入，未重复创建运单' : '运单文件已解析，草稿会自动保留');
    } catch (error) {
      message.error(logisticsApiErrorMessage(error, '运单文件解析失败'));
    } finally {
      setParsing(false);
      forceReparseRef.current = false;
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const openEdit = (row: WaybillImportRow) => {
    setEditingRow(row);
    setAddingRow(false);
    rowForm.setFieldsValue({
      carrier: row.carrier,
      tracking_no: row.tracking_no ?? undefined,
      recipient_name: row.recipient_name,
      phone: row.phone ?? undefined,
      address: row.address ?? undefined,
      quantity: row.quantity,
      no_tracking_required: row.no_tracking_required,
      shipping_detail_id: row.shipping_detail_id ?? undefined,
    });
  };

  const openAdd = () => {
    setEditingRow(null);
    setAddingRow(true);
    rowForm.resetFields();
    rowForm.setFieldsValue({ carrier: '中通', quantity: 1, no_tracking_required: false });
  };

  const closeEditor = () => {
    setEditingRow(null);
    setAddingRow(false);
    rowForm.resetFields();
  };

  const saveRow = async () => {
    if (!batch) return;
    const values = await rowForm.validateFields();
    const payload: WaybillImportRowInput = {
      ...values,
      tracking_no: values.no_tracking_required ? null : values.tracking_no || null,
      phone: values.phone || null,
      address: values.address || null,
      shipping_detail_id: values.shipping_detail_id ?? null,
      ignored: false,
    };
    setSavingRow(true);
    try {
      const response = editingRow
        ? await updateWaybillImportRow(batch.id, editingRow.id, payload)
        : await addWaybillImportRow(batch.id, payload);
      setBatch(response.data);
      queryClient.setQueryData(['waybillImportDraft', issueId], response.data);
      closeEditor();
      message.success(editingRow ? '本行修改已自动保存' : '已补充一行并重新核对');
    } catch (error) {
      message.error(logisticsApiErrorMessage(error, '保存失败'));
    } finally {
      setSavingRow(false);
    }
  };

  const toggleIgnored = async (row: WaybillImportRow) => {
    if (!batch) return;
    try {
      const response = await updateWaybillImportRow(batch.id, row.id, {
        ignored: row.match_status !== 'ignored',
        shipping_detail_id: row.match_status === 'ignored' ? row.shipping_detail_id : null,
      });
      setBatch(response.data);
      queryClient.setQueryData(['waybillImportDraft', issueId], response.data);
      message.success(row.match_status === 'ignored' ? '已恢复并重新匹配' : '本行已忽略');
    } catch (error) {
      message.error(logisticsApiErrorMessage(error, '操作失败'));
    }
  };

  const handleConfirm = async () => {
    if (!batch) return;
    setConfirming(true);
    try {
      const response = await confirmWaybillImport(batch.id);
      setBatch(response.data);
      queryClient.setQueryData(['waybillImportDraft', issueId], null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['shippingDetails'] }),
        queryClient.invalidateQueries({ queryKey: ['shippingDetailsAll'] }),
        queryClient.invalidateQueries({ queryKey: ['shippingFulfillment', issueId] }),
      ]);
      message.success(`已核销 ${response.data.matched_quantity.toLocaleString()} 份，保留 ${response.data.pending_quantity.toLocaleString()} 份待处理`);
    } catch (error) {
      message.error(logisticsApiErrorMessage(error, '确认导入失败'));
    } finally {
      setConfirming(false);
    }
  };

  const alternativesFor = (row: WaybillImportRow): ShippingDetail[] => {
    const name = row.recipient_name.trim();
    const phone = (row.phone ?? '').replace(/\D/g, '');
    return details
      .filter((detail) => detail.id !== row.shipping_detail_id)
      .map((detail) => ({
        detail,
        score: Number(detail.name === name) * 3
          + Number(Boolean(phone) && (detail.phone ?? '').replace(/\D/g, '') === phone) * 2
          + Number(Boolean(row.address) && detail.address === row.address),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.detail.quantity - a.detail.quantity)
      .slice(0, 5)
      .map((item) => item.detail);
  };

  const columns: TableColumnsType<WaybillImportRow> = [
    {
      title: '来源行', key: 'source', width: 190,
      render: (_, row) => <div className="waybill-source"><b>{row.source_sheet}</b><span>第 {row.source_row} 行</span></div>,
    },
    {
      title: '收件信息', key: 'recipient', width: 260,
      render: (_, row) => <div className="waybill-recipient"><b>{row.recipient_name || '未识别收件人'}</b><span>{row.phone || '无电话'} · {row.address || '无地址'}</span></div>,
    },
    {
      title: '承运 / 运单', key: 'tracking', width: 220,
      render: (_, row) => row.no_tracking_required
        ? <Tag color="blue">无需运单</Tag>
        : <div className="waybill-tracking"><b>{row.carrier || '—'}</b><span>{row.tracking_no || '缺少运单号'}</span></div>,
    },
    { title: '份数', dataIndex: 'quantity', width: 90, align: 'right' },
    {
      title: '核对结果', key: 'status', width: 190,
      render: (_, row) => <div className="waybill-status-cell">
        <Tag color={statusMeta[row.match_status].color}>{statusMeta[row.match_status].label}</Tag>
        <span>{row.match_reason || (row.manual_reviewed ? '已人工确认' : '自动匹配')}</span>
      </div>,
    },
    {
      title: '操作', key: 'actions', width: 130, fixed: 'right',
      render: (_, row) => batch?.status === 'confirmed' ? '—' : <div className="waybill-row-actions">
        <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>核对</Button>
        <Button type="link" size="small" danger={row.match_status !== 'ignored'} onClick={() => void toggleIgnored(row)}>
          {row.match_status === 'ignored' ? '恢复' : '忽略'}
        </Button>
      </div>,
    },
  ];

  const expandedRow = (row: WaybillImportRow) => {
    const matchedDetail = row.shipping_detail_id ? detailsById.get(row.shipping_detail_id) : undefined;
    const alternatives = alternativesFor(row);
    return <div className="waybill-expanded">
      <section>
        <h4>Excel 原始单元格</h4>
        {row.raw_values?.length ? <div className="waybill-raw-values">
          {row.raw_values.map((value, index) => <span key={index}><small>第 {index + 1} 列</small>{String(value) || '（空）'}</span>)}
        </div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="人工补充行，没有原始单元格" />}
      </section>
      <section>
        <h4>当前关联的发货明细</h4>
        {matchedDetail ? <div className="waybill-detail-card is-current">
          <b>{matchedDetail.name} · {matchedDetail.quantity} 份</b>
          <span>{matchedDetail.phone || '无电话'} · {matchedDetail.address || '无地址'}</span>
          <small>明细 #{matchedDetail.id} · 已处理 {matchedDetail.handled_quantity} 份 · {matchedDetail.channel}</small>
        </div> : <Alert showIcon type="warning" title="尚未关联发货明细" description="点击“核对”可选择本期确认版发货明细；这里不会新建或修改发货计划。" />}
      </section>
      <section>
        <h4>可能对应的其他明细</h4>
        {alternatives.length ? <div className="waybill-alternatives">
          {alternatives.map((detail) => <div className="waybill-detail-card" key={detail.id}>
            <b>{detail.name} · {detail.quantity} 份</b>
            <span>{detail.phone || '无电话'} · {detail.address || '无地址'}</span>
          </div>)}
        </div> : <span className="waybill-muted">没有发现相似明细，可在“核对”中搜索全部本期明细。</span>}
      </section>
    </div>;
  };

  const filterOptions: Array<{ label: string; value: RowFilter }> = batch ? [
    { label: `待处理 ${batch.unmatched_rows}`, value: 'unresolved' },
    { label: `全部 ${batch.rows.length}`, value: 'all' },
    { label: `已匹配 ${batch.matched_rows}`, value: 'matched' },
    { label: '待人工匹配', value: 'manual' },
    { label: '未识别 / 无效', value: 'invalid' },
    { label: '重复运单', value: 'duplicate' },
    { label: '无需运单', value: 'no_tracking' },
    { label: '已忽略', value: 'ignored' },
  ] : [];

  if (draftQuery.isLoading || issueQuery.isLoading) {
    return <div className="waybill-page-loading"><Spin size="large" description="正在读取运单草稿" /></div>;
  }

  return <div className="waybill-page">
    <input
      ref={fileInputRef}
      className="waybill-file-input"
      type="file"
      accept=".xlsx,.xlsm"
      onChange={(event) => event.target.files?.[0] && void handleFile(event.target.files[0])}
    />
    <Button type="link" size="small" icon={<LeftOutlined />} className="waybill-back" onClick={() => navigate(`/logistics/issues/${issueId}`)}>
      返回第 {issueQuery.data?.issue_number ?? '—'} 期快递管理
    </Button>

    <header className="waybill-head">
      <div>
        <div className="waybill-title-line">
          <h1>运单核对工作台</h1>
          {batch && <Tag color={batch.status === 'confirmed' ? 'green' : 'blue'}>{batch.status === 'confirmed' ? '已确认导入' : '草稿自动保存'}</Tag>}
        </div>
        <p>
          第 {issueQuery.data?.issue_number ?? '—'} 期 · {issueQuery.data ? dayjs(issueQuery.data.publish_date).format('YYYY-MM-DD') : '—'}
          {batch ? ` · ${batch.filename}` : ' · 尚未选择运单文件'}
        </p>
      </div>
      <div className="waybill-head-actions">
        {batch?.status !== 'confirmed' && <>
          <Button icon={<PlusOutlined />} onClick={openAdd} disabled={!batch}>手工补充一行</Button>
          <Button icon={<ReloadOutlined />} loading={parsing} onClick={() => openFilePicker(true)}>重新上传并解析</Button>
        </>}
        {batch?.status === 'confirmed' && <Button icon={<UploadOutlined />} onClick={() => { setBatch(null); openFilePicker(false); }}>导入补充文件</Button>}
      </div>
    </header>

    {(draftQuery.isError || issueQuery.isError || detailsQuery.isError) && <Alert
      showIcon
      type="error"
      title="工作台部分数据加载失败"
      description={logisticsApiErrorMessage(draftQuery.error || issueQuery.error || detailsQuery.error, '请重新加载页面')}
    />}

    {!batch ? <Card className="waybill-empty-card">
      <div className="waybill-upload-zone" onClick={() => openFilePicker(false)}>
        <FileExcelOutlined />
        <h2>上传发货表，开始核对运单</h2>
        <p>支持 .xlsx / .xlsm。解析不出的原始行也会保留，可在工作台中手工补充。</p>
        <Button type="primary" icon={<UploadOutlined />} loading={parsing}>选择运单 Excel</Button>
      </div>
    </Card> : <>
      <div className="waybill-metrics">
        <Card><span>确认印数基准</span><b>{batch.expected_quantity.toLocaleString()}</b><small>不可由运单表改写</small></Card>
        <Card><span>工作表份数</span><b>{batch.parsed_quantity.toLocaleString()}</b><small>{batch.rows.length} 行已保留</small></Card>
        <Card><span>可自动 / 人工核销</span><b>{batch.matched_quantity.toLocaleString()}</b><small>{batch.matched_rows} 行已匹配</small></Card>
        <Card className={unresolvedQuantity ? 'is-warning' : ''}><span>未解决份数</span><b>{unresolvedQuantity.toLocaleString()}</b><small>{batch.unmatched_rows} 行待处理</small></Card>
        <Card className={batch.warning_count ? 'is-warning' : ''}><span>警告 / 错误</span><b>{batch.warning_count.toLocaleString()}</b><small>含份数不一致提醒</small></Card>
        <Card className={batch.pending_quantity ? 'is-warning' : 'is-success'}><span>导入后待发货</span><b>{batch.pending_quantity.toLocaleString()}</b><small>{batch.extra_quantity ? `另有超出 ${batch.extra_quantity} 份` : '以确认印数为准'}</small></Card>
      </div>

      {batch.status === 'previewed' && batch.pending_quantity > 0 && <Alert
        showIcon
        type="warning"
        title={`仍有 ${batch.pending_quantity.toLocaleString()} 份待处理，但不会阻止 ${batch.matched_quantity.toLocaleString()} 份已匹配数据核销。`}
        description="可先导入确认无误的运单；未匹配的份数继续保留在发货计划中，后续找到单号后再补录。"
      />}
      {batch.status === 'confirmed' && <Alert
        showIcon
        type="success"
        title={`已导入并核销 ${batch.matched_quantity.toLocaleString()} 份`}
        description={`本批次已锁定，仍有 ${batch.pending_quantity.toLocaleString()} 份留待后续补充文件或手工补录。`}
      />}

      <Card className="waybill-table-card" styles={{ body: { padding: 0 } }}>
        <div className="waybill-table-toolbar">
          <Segmented<RowFilter> value={filter} options={filterOptions} onChange={setFilter} />
          <span>当前显示 {visibleRows.length} 行，按影响份数从高到低排列</span>
        </div>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={visibleRows}
          pagination={{ pageSize: 15, showSizeChanger: false, showTotal: (total) => `共 ${total} 行` }}
          scroll={{ x: 1080 }}
          expandable={{ expandedRowRender: expandedRow }}
          locale={{ emptyText: <Empty description={filter === 'unresolved' ? '没有待处理行' : '当前筛选没有数据'} /> }}
        />
      </Card>

      <div className="waybill-confirm-bar">
        <div>
          <b>{batch.status === 'confirmed' ? '本批次已经确认' : `准备核销 ${batch.matched_quantity.toLocaleString()} 份`}</b>
          <span>{batch.status === 'confirmed' ? '如有补充运单，请导入新的补充文件。' : `确认后保留 ${batch.pending_quantity.toLocaleString()} 份待处理；未解决行不会写入实际发货。`}</span>
        </div>
        {batch.status === 'previewed' ? <Popconfirm
          title={`确认导入已核销的 ${batch.matched_quantity.toLocaleString()} 份？`}
          description={`将保留 ${batch.pending_quantity.toLocaleString()} 份待处理。已确认批次不能再编辑。`}
          okText="确认导入"
          cancelText="继续核对"
          onConfirm={() => void handleConfirm()}
        >
          <Button type="primary" size="large" icon={<CheckCircleOutlined />} loading={confirming} disabled={batch.matched_rows === 0}>
            导入已核销的 {batch.matched_quantity.toLocaleString()} 份，保留 {batch.pending_quantity.toLocaleString()} 份待处理
          </Button>
        </Popconfirm> : <Button icon={<LeftOutlined />} onClick={() => navigate(`/logistics/issues/${issueId}`)}>返回快递管理</Button>}
      </div>
    </>}

    <Modal
      title={editingRow ? `核对 ${editingRow.source_sheet} · 第 ${editingRow.source_row} 行` : '手工补充未识别行'}
      open={Boolean(editingRow) || addingRow}
      width={760}
      okText="保存并重新核对"
      okButtonProps={{ icon: <SaveOutlined />, loading: savingRow }}
      onOk={() => void saveRow()}
      onCancel={closeEditor}
    >
      <Alert
        className="waybill-editor-note"
        showIcon
        type="info"
        title="这里只核对运单与已有发货明细的关系"
        description="选择的明细必须来自本期确认版发货计划；不会在这里新建或改动发货计划份数。"
      />
      <Form form={rowForm} layout="vertical">
        <div className="waybill-form-grid">
          <Form.Item name="recipient_name" label="收件人" rules={[{ required: true, message: '请输入收件人' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="phone" label="电话"><Input /></Form.Item>
          <Form.Item name="address" label="地址" className="is-wide"><Input /></Form.Item>
          <Form.Item name="quantity" label="本包裹份数" rules={[{ required: true, type: 'number', min: 1, message: '份数必须大于 0' }]}>
            <InputNumber min={1} precision={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="carrier" label="承运公司" rules={[{ required: true, message: '请输入承运公司' }]}>
            <Select showSearch options={['中通', '顺丰', '邮政', '邮政挂号'].map((value) => ({ value, label: value }))} />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(previous, current) => previous.no_tracking_required !== current.no_tracking_required}>
            {({ getFieldValue }) => !getFieldValue('no_tracking_required') && <Form.Item name="tracking_no" label="运单号" rules={[{ required: true, message: '请输入运单号' }]}>
              <Input />
            </Form.Item>}
          </Form.Item>
          <Form.Item name="no_tracking_required" valuePropName="checked" label="运单要求">
            <Checkbox>无需运单（备用报、社用报等）</Checkbox>
          </Form.Item>
          <Form.Item name="shipping_detail_id" label="关联本期发货明细" className="is-wide" rules={[{ required: true, message: '请选择本期发货明细' }]}>
            <Select
              showSearch
              allowClear
              optionFilterProp="label"
              placeholder="按姓名、电话或地址搜索本期确认版明细"
              options={details.map((detail) => ({ value: detail.id, label: detailLabel(detail) }))}
            />
          </Form.Item>
        </div>
      </Form>
    </Modal>
  </div>;
}
