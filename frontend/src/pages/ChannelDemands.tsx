import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Checkbox, DatePicker, Descriptions, Empty, Form, Input, InputNumber, Modal, Select, Space, Spin, Table, Tag, Upload, message } from 'antd';
import type { TableColumnsType } from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { useAuth } from '../contexts/AuthContext';
import { PageHeader } from '../components/UiPrimitives';
import { confirmDemand, demandKeys, downloadDemandAttachment, getDemand, getDemandOptions, getDemandTrace, listDemands, reviseDemand, saveDemand, uploadDemandAttachment } from '../api/channelDemands';
import type { Demand, DemandInput, DemandLine, DemandOptions, DemandTrace, ReviewStatus } from '../api/channelDemands';
import { getSchedule } from '../api/schedule';
import { cycleOptions, demandError, demandStatusLabel, demandSummary, expandDemandLines, kindLabel, lineKey, reviewOptions } from './channelDemandUtils';
import { categoryLabel } from './reportCategories';
import './channel-demands.css';

export default function ChannelDemands() {
  const { id } = useParams();
  const location = useLocation();
  return id || location.pathname.endsWith('/new') ? <DemandLoader key={id ?? 'new'} id={id ? Number(id) : undefined} /> : <DemandList />;
}

function DemandList() {
  const navigate = useNavigate();
  const { canMutate } = useAuth();
  const [filters, setFilters] = useState<{ partner_id?: number; status?: string; document_type?: string; skip: number; limit: number }>({ skip: 0, limit: 20 });
  const options = useQuery({ queryKey: demandKeys.options, queryFn: async () => (await getDemandOptions()).data });
  const list = useQuery({ queryKey: [...demandKeys.all, 'list', filters], queryFn: async () => (await listDemands(filters)).data });
  const columns: TableColumnsType<Demand> = [
    { title: '需求单', render: (_, row) => <Link to={`/orders/channel-demands/${row.id}`}>需求 #{row.id}<small className="channel-demand-muted">{row.display_name}</small></Link> },
    { title: '单据类型', dataIndex: 'document_type', render: (type: Demand['document_type']) => kindLabel[type] },
    { title: '收到日期', dataIndex: 'received_date' },
    { title: '覆盖刊期', render: (_, row) => `${row.lines[0]?.publish_date ?? '—'} 至 ${row.lines.at(-1)?.publish_date ?? '—'}` },
    { title: '已核对数量', render: (_, row) => `${demandSummary(row.lines).quantity.toLocaleString()} 份` },
    { title: '核对状态', render: (_, row) => <Space wrap><Tag>{demandStatusLabel[row.status]}</Tag>{demandSummary(row.lines).pending > 0 && <Tag color="orange">{demandSummary(row.lines).pending}项待确认</Tag>}</Space> },
  ];
  return <div className="channel-demand-page">
    <PageHeader title="机构／渠道需求" description="统一录入机构订货和渠道报数，按正式刊期核对并引用到印数。" actions={<Space wrap><Button onClick={() => navigate('/orders')}>返回订单管理</Button><Button loading={list.isFetching} onClick={() => void list.refetch()}>刷新</Button>{canMutate && <Button type="primary" onClick={() => navigate('/orders/channel-demands/new')}>新增需求</Button>}</Space>} />
    <Card><Space wrap>
      <Select aria-label="筛选机构" placeholder="全部机构" allowClear showSearch optionFilterProp="label" value={filters.partner_id} style={{ minWidth: 220 }} options={options.data?.partners.map(p => ({ value: p.id, label: `${p.display_name} · ${p.name}` }))} onChange={partner_id => setFilters(f => ({ ...f, partner_id, skip: 0 }))} />
      <Select aria-label="筛选需求状态" placeholder="全部状态" allowClear value={filters.status} style={{ minWidth: 140 }} options={Object.entries(demandStatusLabel).map(([value, label]) => ({ value, label }))} onChange={status => setFilters(f => ({ ...f, status, skip: 0 }))} />
      <Select aria-label="筛选单据类型" placeholder="全部类型" allowClear value={filters.document_type} style={{ minWidth: 150 }} options={Object.entries(kindLabel).map(([value, label]) => ({ value, label }))} onChange={document_type => setFilters(f => ({ ...f, document_type, skip: 0 }))} />
    </Space></Card>
    {(list.isError || options.isError) && <Alert type="error" showIcon title="需求列表未能加载" description={demandError(list.error ?? options.error)} />}
    <Table rowKey="id" columns={columns} dataSource={list.data?.items ?? []} locale={{ emptyText: <Empty description="暂无机构需求" /> }} loading={list.isLoading} scroll={{ x: 900 }} pagination={{ current: filters.skip / filters.limit + 1, pageSize: filters.limit, total: list.data?.total ?? 0, onChange: (page, limit) => setFilters(f => ({ ...f, skip: (page - 1) * limit, limit })) }} />
  </div>;
}

function DemandLoader({ id }: { id?: number }) {
  const options = useQuery({ queryKey: demandKeys.options, queryFn: async () => (await getDemandOptions()).data });
  const query = useQuery({ queryKey: demandKeys.detail(id ?? 0), queryFn: async () => (await getDemand(id!)).data, enabled: !!id });
  if (options.isPending || (id && query.isPending)) return <Spin aria-label="加载机构需求" />;
  if (options.isError || query.isError) return <Alert type="error" showIcon title="需求加载失败" description={demandError(options.error ?? query.error)} action={<Button onClick={() => { void options.refetch(); if (id) void query.refetch(); }}>重试</Button>} />;
  return <DemandEditor initial={query.data} options={options.data!} />;
}

type FormValues = Omit<DemandInput, 'lines' | 'version' | 'received_date'> & { received_date: Dayjs };
function DemandEditor({ initial, options }: { initial?: Demand; options: DemandOptions }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { canMutate } = useAuth();
  const [doc, setDoc] = useState(initial);
  const [form] = Form.useForm<FormValues>();
  const [lines, setLines] = useState<DemandLine[]>(initial?.lines ?? []);
  const [year, setYear] = useState(Number(initial?.lines[0]?.publish_date?.slice(0, 4) ?? dayjs().year()));
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null]>([dayjs().add(1, 'month').startOf('month'), dayjs().add(1, 'month').endOf('month')]);
  const [preview, setPreview] = useState<Demand | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const readonly = !canMutate || (doc && doc.status !== 'draft');
  const partnerId = Form.useWatch('partner_id', form);
  const category = Form.useWatch('category', form);
  const type = Form.useWatch('document_type', form);
  const cycle = Form.useWatch('cycle', form);
  const transport = Form.useWatch('transport', form);
  const partner = options.partners.find(p => p.id === partnerId);
  const schedule = useQuery({ queryKey: ['schedule', year], queryFn: async () => (await getSchedule(year)).data });
  const trace = useQuery({ queryKey: demandKeys.trace(doc?.id ?? 0), queryFn: async () => (await getDemandTrace(doc!.id)).data, enabled: !!doc });
  const summary = demandSummary(lines);
  const lockedNumbers = new Set((trace.data ?? []).filter(t => ['confirmed', 'exported'].includes(t.print_status)).map(t => t.issue_number));
  const refresh = async (saved: Demand) => {
    setDoc(saved);
    qc.setQueryData(demandKeys.detail(saved.id), saved);
    await qc.invalidateQueries({ queryKey: demandKeys.all });
  };
  const save = useMutation({
    mutationFn: async () => {
      const values = await form.validateFields();
      if (!lines.length) throw new Error('请先从正式刊期表展开至少一期明细');
      const result = await saveDemand({ ...values, contract_id: values.contract_id ?? null, received_date: values.received_date.format('YYYY-MM-DD'), lines, version: doc?.version ?? 1 }, doc?.id);
      return result.data;
    },
    onSuccess: async saved => { setDirty(false); await refresh(saved); message.success('草稿已保存'); if (!doc) navigate(`/orders/channel-demands/${saved.id}`, { replace: true }); },
    onError: err => setError(err instanceof Error && !('response' in err) ? err.message : demandError(err)),
  });
  const confirm = useMutation({ mutationFn: async () => (await confirmDemand(preview!.id, preview!.version)).data,
    onSuccess: async saved => { setPreview(null); setReviewed(false); await refresh(saved); message.success('需求已确认；待定项继续保留'); }, onError: err => setError(demandError(err)) });
  const revise = useMutation({ mutationFn: async () => (await reviseDemand(doc!.id, doc!.version)).data,
    onSuccess: async saved => { await qc.invalidateQueries({ queryKey: demandKeys.all }); navigate(`/orders/channel-demands/${saved.id}`); }, onError: err => setError(demandError(err)) });
  const upload = useMutation({ mutationFn: async (file: File) => (await uploadDemandAttachment(doc!.id, doc!.version, file)).data,
    onSuccess: async saved => { await refresh(saved); setReviewed(false); message.success('原件已归档，请对照识别结果核对明细'); }, onError: err => setError(demandError(err)) });
  const busy = save.isPending || upload.isPending || confirm.isPending || revise.isPending;
  const changeLine = (key: string, patch: Partial<DemandLine>) => { setDirty(true); setLines(rows => rows.map(l => lineKey(l) === key ? { ...l, ...patch } : l)); };
  const lineColumns: TableColumnsType<DemandLine> = [
    { title: '正式刊期', render: (_, line) => <><strong>第{line.issue_number}期</strong><small className="channel-demand-muted">{line.publish_date}</small></> },
    { title: '分项', dataIndex: 'sub_category' },
    { title: '数量（份）', render: (_, line) => <InputNumber aria-label={`第${line.issue_number}期${line.sub_category}数量`} min={0} max={10000000} precision={0} value={line.quantity} disabled={!!readonly || busy || lockedNumbers.has(line.issue_number) || line.review_status === 'none'} onChange={quantity => changeLine(lineKey(line), { quantity })} /> },
    { title: '核对状态', render: (_, line) => <Select aria-label={`第${line.issue_number}期${line.sub_category}核对状态`} value={line.review_status} options={reviewOptions} disabled={!!readonly || busy || lockedNumbers.has(line.issue_number)} onChange={(review_status: ReviewStatus) => changeLine(lineKey(line), { review_status, ...(review_status === 'none' ? { quantity: 0 } : {}) })} style={{ minWidth: 130 }} /> },
  ];
  const showPreview = () => { setError(null); setReviewed(false); setPreview(doc!); };
  const expand = () => {
    if (!category) { setError('请先选择机构和印数归属'); return; }
    const filtered = (schedule.data ?? []).filter(s => (!range[0] || s.publish_date >= range[0].format('YYYY-MM-DD')) && (!range[1] || s.publish_date <= range[1].format('YYYY-MM-DD')));
    const additions = expandDemandLines(filtered, options.templates.filter(t => t.category === category).map(t => t.sub_category), lines);
    if (!additions.length) { setError('所选范围没有正式刊期或缺少印数分项模板，请先维护刊期表和模板'); return; }
    const existing = new Map(lines.map(l => [lineKey(l), l]));
    for (const line of additions) existing.set(lineKey(line), line);
    setLines([...existing.values()].sort((a, b) => a.issue_number - b.issue_number || a.sub_category.localeCompare(b.sub_category)));
    setDirty(true); setError(null);
  };
  const download = async (attachmentId: number, filename: string) => {
    try { const result = await downloadDemandAttachment(doc!.id, attachmentId); const url = URL.createObjectURL(result.data); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url); } catch (err) { setError(demandError(err)); }
  };
  return <div className="channel-demand-page">
    <PageHeader title={doc ? `${doc.display_name} · 需求 #${doc.id}` : '新增机构／渠道需求'} description="收到报数日期、订购刊期与实际交付分别记录。合同可选关联。" actions={<Space wrap><Button disabled={busy} onClick={() => { if (!dirty || window.confirm('有未保存的修改，确定返回列表吗？')) navigate('/orders/channel-demands'); }}>返回列表</Button>{doc && <Tag>{demandStatusLabel[doc.status]} · v{doc.version}</Tag>}{doc?.status === 'confirmed' && canMutate && <Button loading={revise.isPending} disabled={busy} onClick={() => revise.mutate()}>创建更正版本</Button>}</Space>} />
    {error && <Alert type="error" showIcon title={error} closable onClose={() => setError(null)} />}
    {doc?.supersedes_id && <Alert type="info" showIcon title={<span>这是需求 <Link to={`/orders/channel-demands/${doc.supersedes_id}`}>#{doc.supersedes_id}</Link> 的更正版本，确认前原单继续有效。</span>} />}
    <div className="channel-demand-layout"><main><Form form={form} layout="vertical" disabled={!!readonly || busy} initialValues={initial ? { ...initial, received_date: dayjs(initial.received_date), pricing_mode: initial.pricing ? 'chengdu_annual' : 'unpriced' } : { received_date: dayjs(), document_type: 'order', cycle: 'month', transport: 'pending', pricing_mode: 'unpriced' }} onValuesChange={() => { setDirty(true); setReviewed(false); }}>
      <Card title="1 · 机构与业务"><div className="channel-demand-fields">
        <Form.Item name="partner_id" label="已有机构" rules={[{ required: true, message: '请选择已有机构' }]}><Select showSearch optionFilterProp="label" options={options.partners.map(p => ({ value: p.id, label: `${p.display_name} · ${p.name}` }))} disabled={!!readonly || busy || !!doc?.supersedes_id || !!doc?.attachments.length} onChange={value => { const p = options.partners.find(p => p.id === value)!; form.setFieldsValue({ category: p.category ?? undefined, document_type: p.document_type, cycle: p.cycle, transport: p.transport, contract_id: undefined, pricing_mode: 'unpriced' }); setLines([]); }} /></Form.Item>
        <Form.Item name="document_type" label="业务类型" rules={[{ required: true }]}><Select disabled={!!readonly || busy || !!doc?.supersedes_id} options={Object.entries(kindLabel).map(([value, label]) => ({ value, label }))} onChange={() => form.setFieldValue('pricing_mode', 'unpriced')} /></Form.Item>
        <Form.Item name="category" label="印数归属" rules={[{ required: true, message: '请选择印数归属' }]}><Select disabled={!!readonly || busy || !!partner?.category || !!doc?.supersedes_id || !!doc?.attachments.length} options={[...new Set(options.templates.map(t => t.category))].map(value => ({ value, label: categoryLabel(value) }))} onChange={() => setLines([])} /></Form.Item>
        <Form.Item name="contract_id" label="关联合同（可选）"><Select allowClear placeholder="无需合同也可确认需求" options={options.contracts.filter(c => c.partner_id === partnerId).map(c => ({ value: c.id, label: c.title || `合同 #${c.id}` }))} /></Form.Item>
      </div><p className="channel-demand-muted">正式主体：{partner?.legal_name ?? partner?.name ?? initial?.partner_name ?? '选择后显示'}。机构关联使用固定档案，不受显示名称变化影响。</p>
      {type === 'report' && <Alert type="info" title="渠道报数仅记录发行需求，不自动创建读者订单或销售应收。" />}</Card>
      <Card title="2 · 时间范围与刊期明细"><div className="channel-demand-fields"><Form.Item name="received_date" label="收到报数日期" rules={[{ required: true, message: '请填写收到日期' }]}><DatePicker /></Form.Item><Form.Item name="cycle" label="报数周期" rules={[{ required: true }]}><Select options={cycleOptions} onChange={value => { if (value === 'week' || value === 'biweek') { const start = range[0] ?? dayjs(); setRange([start, start.add(value === 'week' ? 6 : 13, 'day')]); } }} /></Form.Item></div>
      {!readonly && <Space wrap className="channel-demand-picker"><InputNumber aria-label="正式刊期年份" min={2000} max={2100} value={year} disabled={busy || !!doc?.supersedes_id} onChange={value => { if (value) { setYear(value); setRange([dayjs(`${value}-01-01`), dayjs(`${value}-12-31`)]); } }} />
        {cycle === 'month' ? <DatePicker aria-label="订购月份" picker="month" value={range[0]} disabled={busy || !!doc?.supersedes_id} onChange={value => { if (value) { setYear(value.year()); setRange([value.startOf('month'), value.endOf('month')]); } }} /> : <DatePicker.RangePicker aria-label="覆盖日期范围" value={range} disabled={busy || !!doc?.supersedes_id} onChange={values => setRange(values ? [values[0], values[1]] : [null, null])} />}
        <Button loading={schedule.isFetching} disabled={busy || !!doc?.supersedes_id || schedule.isError || schedule.isPending} onClick={expand}>从正式刊期展开／补入</Button><Button disabled={busy || !!doc?.supersedes_id || !lines.length} onClick={() => { if (window.confirm('清空当前未保存的刊期明细，重新选择范围？')) { setLines([]); setDirty(true); } }}>清空重选</Button>
      </Space>}
      {schedule.isError && <Alert type="error" title="正式刊期表加载失败" action={<Button onClick={() => void schedule.refetch()}>重试</Button>} />}
      <p className="channel-demand-muted">固定订阅也按正式刊期展开；可分年补入跨年需求。空值保留为待确认，明确不订记录为零。北京邮发数量请按现有本市／外埠及损失分摊口径核对。</p>
      <Table rowKey={lineKey} columns={lineColumns} dataSource={lines} pagination={lines.length > 20 ? { pageSize: 20 } : false} scroll={{ x: 640 }} locale={{ emptyText: <Empty description="请先选择机构，再从正式刊期展开需求" /> }} />
      </Card>
      <Card title="3 · 交付安排"><div className="channel-demand-fields"><Form.Item name="transport" label="实际运输方式"><Select disabled={!!readonly || busy || !!partner?.chengdu} options={[{ value: 'pending', label: '交付待配置' }, { value: 'zto', label: '中通寄送' }, { value: 'channel', label: '渠道交付' }]} /></Form.Item>{transport === 'zto' && <><Form.Item name="recipient_name" label="收件人"><Input maxLength={128} /></Form.Item><Form.Item name="recipient_phone" label="联系电话"><Input maxLength={64} /></Form.Item><Form.Item name="recipient_address" label="收件地址"><Input maxLength={500} /></Form.Item></>}</div><Alert type="info" title={partner?.chengdu ? '成都每期中通寄送，运费由报社承担，不计入成都货款。本阶段保存安排，尚不生成发货计划。' : '交付待配置也可归档需求；本阶段保存安排，尚不生成发货计划。'} /></Card>
      <Card title="4 · 原始凭证与人工核对">
        {!readonly && <Upload accept=".pdf,.png,.jpg,.jpeg" showUploadList={false} disabled={!doc || busy || dirty} beforeUpload={file => { setError(null); upload.mutate(file); return false; }}><Button loading={upload.isPending} disabled={!doc || busy || dirty}>上传并识别凭证</Button></Upload>}
        <p className="channel-demand-muted">先保存草稿再上传。原件和识别建议始终保留；请对照原件修改上方正式刊期明细，识别建议不会直接写入数量。</p>
        {doc?.attachments.map(a => <div key={a.id} className="channel-demand-attachment"><Space wrap><Button type="link" onClick={() => void download(a.id, a.filename)}>{a.filename}</Button><Tag>{a.reviewed_version === doc.version ? '已随当前版本核对' : '待人工核对'}</Tag></Space><details><summary>查看识别建议与原文</summary>{a.extraction?.warnings?.map((w, i) => <p key={i}>{w}</p>)}<pre>{JSON.stringify(a.extraction?.suggestions ?? [], null, 2)}</pre><p>{a.extraction?.raw_text || '未提取到文字，请下载原件核对。'}</p></details></div>)}
      </Card>
      <Card title="5 · 价格依据与备注">{type === 'order' ? <Form.Item name="pricing_mode" label="计价依据"><Select options={[{ value: 'unpriced', label: '暂未定价，后续核对' }, ...(partner?.chengdu ? [{ value: 'chengdu_annual', label: '成都年度折算：240 ÷ 正式年度期数 × 48%' }] : [])]} /></Form.Item> : <Alert type="info" title="渠道报数不填写销售金额。" />}<Form.Item name="notes" label="备注"><Input.TextArea rows={3} maxLength={2000} /></Form.Item></Card>
    </Form></main>
    <aside><Card title="本单摘要"><Descriptions column={1} items={[{ key: 'quantity', label: '已核对数量', children: `${summary.quantity.toLocaleString()} 份` }, { key: 'pending', label: '待确认', children: `${summary.pending} 项` }, { key: 'none', label: '明确不订', children: `${summary.none} 项` }, { key: 'type', label: '单据类型', children: kindLabel[type ?? 'order'] }]} />{doc?.pricing ? Object.values(doc.pricing).map(p => <p key={p.year}>已保存依据 · {p.year}年：240 ÷ {p.issue_count} × 48% = <strong>¥{p.unit_price}／份</strong>（单价先取分）</p>) : <p className="channel-demand-muted">{type === 'report' ? '不形成销售应收。' : '尚无已保存价格，金额待核对。'}</p>}{doc?.estimated_amount != null && type === 'order' && <p>已保存已核对部分预计货款：<strong>¥{doc.estimated_amount}</strong><small className="channel-demand-muted">不含报社自付运费，不作为已确认应收。</small></p>}{dirty && <Tag color="orange">有未保存修改</Tag>}</Card>
      <Card title="确认后的流向"><p><strong>印数</strong> · 对应期数中预览差异后采用，已锁定印数受保护。</p><p><strong>交付</strong> · 安排已留存；排发衔接将在下一阶段提供。</p><p><strong>财务</strong> · 价格仅供核对，当前不生成应收、收款或发票。</p></Card>
      {!readonly && <Space orientation="vertical" className="channel-demand-actions"><Button block loading={save.isPending} disabled={busy} onClick={() => { setError(null); save.mutate(); }}>保存草稿</Button><Button block type="primary" disabled={!doc || busy || dirty || !lines.some(l => l.review_status !== 'pending')} onClick={showPreview}>核对并确认需求</Button><small className="channel-demand-muted">保存后核对当前版本。待定条目会保留，并阻断对应刊期的印数采用。</small></Space>}
    </aside></div>
    {doc && <Card title="按期追溯"><Table<DemandTrace> rowKey="line_id" loading={trace.isLoading} dataSource={trace.data ?? []} scroll={{ x: 650 }} columns={[{ title: '刊期', render: (_, r) => r.issue_id ? <Link to={`/report/${r.issue_id}`}>第{r.issue_number}期</Link> : `第${r.issue_number}期（尚未创建印数）` }, { title: '分项', dataIndex: 'sub_category' }, { title: '印数采用数量', render: (_, r) => r.adopted_quantity === null ? '尚未采用' : <span>{r.adopted_quantity} 份 · 来源 <Link to={`/orders/channel-demands/${r.adopted_demand_id ?? doc.id}`}>#{r.adopted_demand_id ?? doc.id}</Link> · v{r.adopted_version}</span> }, { title: '印数状态', render: (_, r) => ({ draft: '草稿', confirmed: '已锁定', exported: '已导出', not_created: '尚未创建' })[r.print_status] ?? r.print_status }]} />{trace.isError && <Alert type="error" title="追溯记录加载失败" action={<Button onClick={() => void trace.refetch()}>重试</Button>} />}</Card>}
    <Modal title="核对当前需求版本" open={!!preview} onCancel={() => { if (!confirm.isPending) { setPreview(null); setReviewed(false); } }} onOk={() => confirm.mutate()} confirmLoading={confirm.isPending} okButtonProps={{ disabled: !reviewed }} cancelButtonProps={{ disabled: confirm.isPending }} okText="确认已核对需求" destroyOnHidden>
      <p>{preview?.display_name} · v{preview?.version} · 已核对 {summary.quantity} 份，{summary.pending} 项待确认。</p><Alert type={summary.pending ? 'warning' : 'info'} title={summary.pending ? '待定行继续保留，对应刊期暂不能采用印数。' : '确认后请在印数管理中预览并采用。'} /><p>本次不会生成发货计划或财务应收。</p><Checkbox checked={reviewed} onChange={e => setReviewed(e.target.checked)}>我已对照原件核对当前刊期、分项、数量及计价依据；待定项已明确保留。</Checkbox>{error && <Alert type="error" title={error} />}
    </Modal>
  </div>;
}
