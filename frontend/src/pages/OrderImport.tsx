import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import OrderCoverageDrawer from './OrderCoverageDrawer';
import LinkProductAliasModal from './LinkProductAliasModal';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd';
import { CheckOutlined, InboxOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons';
import type { TableColumnsType, UploadFile } from 'antd';
import type { Dayjs } from 'dayjs';
import { commitOrderImport, previewOrderImport } from '../api/orderImport';
import { useAuth } from '../contexts/AuthContext';
import type { ImportDecision, ImportPreviewOut, ImportPreviewRow, PreviewSettings } from '../api/orderImport';
import { createProduct, productQueryKeys } from '../api/products';
import { ProductFormFields, PUBLICATION_OPTIONS, buildProductPayload } from './ProductForm';
import type { ProductFormValues } from './ProductForm';
import { deliveryMethodLabel, fulfillmentTypeLabel, publicationLabel } from './orderUtils';
import EcommerceRules from './ecommerceRules';
import { DrawerTitle, PageHeader, StatusPill } from '../components/UiPrimitives';

const { Text } = Typography;

type Mode = 'recent' | 'historical';
type PreviewFilter = 'all' | ImportDecision;

const PREVIEW_FILTERS = [
  { value: 'all', label: '全部', color: 'primary' },
  { value: 'unresolved', label: '待确认', color: 'danger' },
  { value: 'retain', label: '留存', color: 'cyan' },
  { value: 'source_update', label: '来源更新', color: 'orange' },
  { value: 'duplicate', label: '重复', color: 'blue' },
  { value: 'import', label: '导入', color: 'green' },
  { value: 'skip_status', label: '跳过', color: 'default' },
] as const;

const DECISION_META: Record<ImportDecision, { label: string; color: string }> = {
  import: { label: '✅ 导入', color: 'green' },
  skip_status: { label: '⏭ 跳过', color: 'default' },
  duplicate: { label: '♻ 重复', color: 'blue' },
  unresolved: { label: '⚠ 待确认', color: 'red' },
  retain: { label: '留存待处理', color: 'cyan' },
  source_update: { label: '来源更新待核对', color: 'orange' },
};

/** Smart defaults for a quick-add product from its name (fewer fields to fill). */
export function guessDefaults(name: string): Partial<ProductFormValues> {
  // 商学院月刊单期的标题形如 “2026年4月刊《…》”“2~3月合刊《…》”，名里并不含“商学院”
  // 三字，所以按 “N月刊 / N月合刊” 模式 + 不含“中国经营报” 兜底也判为商学院。
  const looksLikeBusinessSchoolMonthly = /月合?刊/.test(name);
  const d: Partial<ProductFormValues> = {
    publication_format: 'paper',
    billing_type: 'paid',
    active: true,
    is_bundle: false,
    publication:
      !name.includes('中国经营报') && (name.includes('商学院') || looksLikeBusinessSchoolMonthly)
        ? 'business_school'
        : 'cbj',
    delivery_method: name.includes('中通') ? 'zto_mf' : 'post_office',
  };
  if (name.includes('全年') || name.includes('一年')) {
    d.fulfillment_type = 'subscription';
    d.subscription_term = 'one_year';
    d.coverage_rule = 'term_from_month';
  } else if (name.includes('半年')) {
    d.fulfillment_type = 'subscription';
    d.subscription_term = 'half_year';
    d.coverage_rule = 'term_from_month';
  } else if (name.includes('往期') || name.includes('零售')) {
    // 往期零售：单期，具体期号由客服按单告知 → 自定义、导入后人工补期号
    d.fulfillment_type = 'single_issue';
    d.coverage_rule = 'custom';
  } else if (name.includes('最新一期') || name.includes('刊')) {
    d.fulfillment_type = 'single_issue';
    d.coverage_rule = 'latest_issue';
  } else {
    d.fulfillment_type = 'subscription';
    d.coverage_rule = 'term_from_month';
  }
  return d;
}

function suggestCode(): string {
  return 'CBJ-' + Date.now().toString(36).toUpperCase().slice(-6);
}

function formatSubscriptionPeriod(start: string | null, end: string | null): string {
  if (!start && !end) return '未填写';
  return `${start || '未填写'} 至 ${end || '未填写'}`;
}

export default function OrderImport() {
  const { isAdmin, canMutate } = useAuth();
  const queryClient = useQueryClient();
  const [modal, modalContext] = Modal.useModal();
  const [coverageOpen, setCoverageOpen] = useState(false);
  const [aliasName, setAliasName] = useState<string | null>(null);
  const [hasCoverageEdits, setHasCoverageEdits] = useState(false);
  const [importedOrderIds, setImportedOrderIds] = useState<number[] | null>(null);
  const [mode, setMode] = useState<Mode>('recent');
  const [file, setFile] = useState<File | null>(null);
  const [postOfficeStart, setPostOfficeStart] = useState<Dayjs | null>(null);
  const [ztoStart, setZtoStart] = useState<Dayjs | null>(null);
  const [cutoff, setCutoff] = useState<Dayjs | null>(null);
  const [campaign, setCampaign] = useState('');
  const [bonusMonths, setBonusMonths] = useState<number>(0);
  const [giftPublication, setGiftPublication] = useState<string | undefined>(undefined);
  const [giftNote, setGiftNote] = useState('');
  const [preview, setPreview] = useState<ImportPreviewOut | null>(null);
  const [confirmedSourceUpdates, setConfirmedSourceUpdates] = useState<string[]>([]);
  const [previewFilter, setPreviewFilter] = useState<PreviewFilter>('all');
  const [previewPage, setPreviewPage] = useState(1);
  const [previewPageSize, setPreviewPageSize] = useState(50);
  // 往期单选填补期号：{external_order_no: 期号}。留空=不补，照常导入。
  const [issueOverrides, setIssueOverrides] = useState<Record<string, number>>({});
  // 商学院单期选填补期次标签：{external_order_no: "YYYY-MM" / "YYYY-MM~MM"}。
  const [labelOverrides, setLabelOverrides] = useState<Record<string, string>>({});

  const [drawerMode, setDrawerMode] = useState<'quick' | 'detail' | null>(null);
  const [detailRow, setDetailRow] = useState<ImportPreviewRow | null>(null);
  const [quickForm] = Form.useForm<ProductFormValues>();

  const previewMutation = useMutation({
    mutationFn: () => {
      const settings: PreviewSettings = { mode };
      if (campaign.trim()) settings.campaign = campaign.trim();
      if (mode === 'recent') {
        if (postOfficeStart) settings.post_office_start_month = postOfficeStart.format('YYYY-MM');
        if (ztoStart) settings.zto_start_month = ztoStart.format('YYYY-MM');
        if (cutoff) settings.cutoff_date = cutoff.format('YYYY-MM-DD');
        if (bonusMonths > 0) settings.bonus_months = bonusMonths;
        if (giftPublication) {
          settings.gift_publication = giftPublication;
          if (giftNote.trim()) settings.gift_note = giftNote.trim();
        }
      }
      return previewOrderImport(file as File, settings);
    },
    onSuccess: (res) => {
      setPreview(res.data);
      setConfirmedSourceUpdates([]);
      setPreviewPage(1);
      setHasCoverageEdits(false);
      setCoverageOpen(false);
      setImportedOrderIds(null);
      setIssueOverrides({}); // 新预览：行可能重排，作废旧的补期号
      setLabelOverrides({});
    },
    onError: (err: { response?: { data?: { detail?: string } } }) =>
      message.error(err.response?.data?.detail ?? '预览失败'),
  });

  const commitMutation = useMutation({
    mutationFn: () => {
      // 只把格式合法的期次标签传给后端（非法值前端就丢弃，后端也会再兜一层）
      const validLabels: Record<string, string> = {};
      for (const [ext, label] of Object.entries(labelOverrides)) {
        if (isValidIssueLabel(label)) validLabels[ext] = label;
      }
      return commitOrderImport(preview!.session_id, issueOverrides, validLabels, confirmedSourceUpdates);
    },
    onSuccess: (res) => {
      message.success(`成功导入 ${res.data.created} 单，另留存 ${res.data.retained_sources ?? 0} 笔交易（跳过重复 ${res.data.skipped_duplicates}）`);
      setImportedOrderIds(res.data.order_ids);
      void queryClient.invalidateQueries();
      setPreview(null);
      setHasCoverageEdits(false);
      setFile(null);
      setIssueOverrides({});
      setLabelOverrides({});
    },
    onError: (err: { response?: { data?: { detail?: string } } }) =>
      message.error(err.response?.data?.detail ?? '导入失败'),
  });

  const quickAddMutation = useMutation({
    mutationFn: (values: ProductFormValues) => createProduct(buildProductPayload(values)),
    onSuccess: () => {
      message.success('商品已加入商品库');
      void queryClient.invalidateQueries({ queryKey: productQueryKeys.all });
      setDrawerMode(null);
      runPreview(); // re-resolve the whole batch against the updated catalog
    },
    onError: (err: { response?: { data?: { detail?: string } } }) =>
      message.error(err.response?.data?.detail ?? '保存失败'),
  });

  // Group the 待确认 rows by distinct product name → add once, clear many orders.
  const unresolvedSummary = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of preview?.rows ?? []) {
      if (r.decision === 'unresolved' && r.unresolved_product) {
        map.set(r.unresolved_product, (map.get(r.unresolved_product) ?? 0) + 1);
      }
    }
    return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }, [preview]);

  const openQuickAdd = (productName: string) => {
    quickForm.resetFields();
    quickForm.setFieldsValue({
      display_name: productName,
      code: suggestCode(),
      ...guessDefaults(productName),
    } as ProductFormValues);
    setDrawerMode('quick');
  };

  const handleRowClick = (row: ImportPreviewRow) => {
    if (canMutate && row.decision === 'unresolved' && row.unresolved_product) {
      setAliasName(row.unresolved_product);
    } else {
      setDetailRow(row);
      setDrawerMode('detail');
    }
  };

  const confirmPreviewReset = (action: () => void) => {
    if (hasCoverageEdits) {
      modal.confirm({
        title: '重新生成导入预览？',
        content: '本次已补录的订期尚未正式入库。重新识别、修改导入设置或更换文件会清除这些日期，之后需要重新补录。',
        okText: '清除并继续', cancelText: '保留当前预览', onOk: action,
      });
    } else action();
  };
  const runPreview = () => confirmPreviewReset(() => previewMutation.mutate());
  const updateImportSettings = (update: () => void) => confirmPreviewReset(() => {
    update();
    setPreview(null);
    setPreviewFilter('all');
    setPreviewPage(1);
    setHasCoverageEdits(false);
  });
  const handlePreview = () => {
    if (!file) {
      message.warning('请先选择电商订单 Excel');
      return;
    }
    runPreview();
  };

  // 期次标签校验（镜像后端 is_valid_issue_label）：YYYY-MM 或 YYYY-MM~MM（合刊月份递增）。
  const isValidIssueLabel = (label: string): boolean => {
    const m = /^(\d{4})-(0[1-9]|1[0-2])(?:~(0[1-9]|1[0-2]))?$/.exec(label.trim());
    if (!m) return false;
    return m[3] ? Number(m[2]) < Number(m[3]) : true;
  };

  const columns: TableColumnsType<ImportPreviewRow> = [
    { title: '结果', dataIndex: 'decision', key: 'decision', width: 100, render: (d: ImportDecision) => <Tag color={DECISION_META[d].color}>{DECISION_META[d].label}</Tag> },
    { title: '来源单号', dataIndex: 'external_order_no', key: 'ext', width: 160, ellipsis: true },
    { title: '收件人', dataIndex: 'recipient_name', key: 'name', width: 90 },
    { title: '付款', dataIndex: 'paid_amount', key: 'paid', width: 80, align: 'right', render: (v) => `¥${v}` },
    {
      title: '状态', key: 'status', width: 150,
      render: (_: unknown, r) => (
        <Space size={2} direction="vertical">
          <Text style={{ fontSize: 12 }}>{r.status_raw} → {r.commercial_status ?? '-'}</Text>
          {r.status_unknown && <Tag color="orange">状态未知</Tag>}
        </Space>
      ),
    },
    {
      title: '识别明细 / 原因', key: 'items',
      render: (_: unknown, r) => {
        if (r.decision !== 'import') {
          return (
            <Space>
              <Text type="secondary">{r.reason ?? '-'}</Text>
              {r.decision === 'unresolved' && r.unresolved_product && (
                <Button type="link" size="small" icon={<PlusOutlined />} onClick={(e) => { e.stopPropagation(); openQuickAdd(r.unresolved_product!); }}>
                  加入商品库
                </Button>
              )}
            </Space>
          );
        }
        return (
          <Space direction="vertical" size={2} style={{ width: '100%' }}>
            {r.delivery_overridden_to_zto && <Tag color="orange">投递→中通（请核对）</Tag>}
            {r.items.map((it, i) => {
              const key = `${r.external_order_no}#${i}`;
              const needNumber =
                it.fulfillment_type === 'single_issue' &&
                it.publication !== 'business_school' &&
                !it.issue_number;
              const needLabel =
                it.fulfillment_type === 'single_issue' &&
                it.publication === 'business_school' &&
                !it.issue_label;
              return (
                <div key={i}>
                  <Text style={{ fontSize: 12 }}>
                    {it.billing_type === 'free_gift' && <Tag color="gold" style={{ marginInlineEnd: 4 }}>🎁 赠品</Tag>}
                    {publicationLabel((it.publication ?? 'other') as never)}/{fulfillmentTypeLabel(it.fulfillment_type as never)}
                    {it.delivery_method ? `/${deliveryMethodLabel(it.delivery_method as never)}` : ''}{it.issue_number ? ` · 第${it.issue_number}期` : ''}{it.issue_label ? ` · 期${it.issue_label}` : ''} · ¥{it.subtotal} · 订期：{formatSubscriptionPeriod(it.coverage_start_date, it.coverage_end_date)}
                  </Text>
                  {needNumber && (
                    <Space size={4} style={{ marginLeft: 8 }} onClick={(e) => e.stopPropagation()}>
                      <Text type="warning" style={{ fontSize: 12 }}>补期号：</Text>
                      <InputNumber
                        size="small"
                        min={1}
                        placeholder="选填"
                        style={{ width: 100 }}
                        value={issueOverrides[key] ?? null}
                        onChange={(v) =>
                          setIssueOverrides((prev) => {
                            const next = { ...prev };
                            if (v == null) delete next[key];
                            else next[key] = v;
                            return next;
                          })
                        }
                      />
                    </Space>
                  )}
                  {needLabel && (
                    <Space size={4} style={{ marginLeft: 8 }} onClick={(e) => e.stopPropagation()}>
                      <Text type="warning" style={{ fontSize: 12 }}>补期次：</Text>
                      <Input
                        size="small"
                        placeholder="选填，如 2026-06"
                        style={{ width: 130 }}
                        status={labelOverrides[key] && !isValidIssueLabel(labelOverrides[key]) ? 'error' : undefined}
                        value={labelOverrides[key] ?? ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          setLabelOverrides((prev) => {
                            const next = { ...prev };
                            if (!v.trim()) delete next[key];
                            else next[key] = v.trim();
                            return next;
                          });
                        }}
                      />
                    </Space>
                  )}
                </div>
              );
            })}
            {r.warnings.map((w, i) => (<Text key={`w${i}`} type="warning" style={{ fontSize: 12 }}>⚠ {w}</Text>))}
          </Space>
        );
      },
    },
  ];

  const counts = preview?.counts ?? {};
  const visibleRows = useMemo(() => {
    const rows = preview?.rows ?? [];
    return previewFilter === 'all' ? rows : rows.filter(row => row.decision === previewFilter);
  }, [preview, previewFilter]);
  const previewFilterLabel = PREVIEW_FILTERS.find(filter => filter.value === previewFilter)!.label;

  return (
    <div>
      <PageHeader title="电商订单导入" description="预览、校验并导入各平台订单" actions={<Button href="/orders/sources">处理已留存的来源交易</Button>} />
      {modalContext}
      {aliasName && <LinkProductAliasModal alias={aliasName} orderCount={unresolvedSummary.find(row => row.name === aliasName)?.count ?? 0}
        onClose={() => setAliasName(null)} onCreate={() => { openQuickAdd(aliasName); setAliasName(null); }}
        onLinked={() => { setAliasName(null); message.success('已关联到现有商品，原别名和参考价保留'); runPreview(); }} />}

      <EcommerceRules />
      {importedOrderIds && importedOrderIds.length > 0 && <Alert type="success" showIcon title={`本次已导入 ${importedOrderIds.length} 单`} action={<Button onClick={() => setCoverageOpen(true)}>继续补本次订期</Button>} style={{ marginBottom: 16 }} />}
      {coverageOpen && (preview || importedOrderIds) && <OrderCoverageDrawer
        importSessionId={preview?.session_id} orderIds={preview ? undefined : importedOrderIds ?? undefined}
        onClose={() => setCoverageOpen(false)} onApplied={result => {
          if (preview) setHasCoverageEdits(true);
          const changed = new Map(result.changes.map(c => [c.key, c]));
          setPreview(previous => previous ? { ...previous, rows: previous.rows.map(row => ({ ...row,
            items: row.items.map((item, index) => {
              const dates = changed.get(`${row.external_order_no}#${index}`);
              return dates ? { ...item, coverage_start_date: dates.coverage_start_date, coverage_end_date: dates.coverage_end_date } : item;
            }),
          })) } : null);
        }} />}

      <Card size="small" title="① 导入模式与起投设置" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Segmented
            value={mode}
            onChange={(v) => updateImportSettings(() => setMode(v as Mode))}
            options={[
              { label: '近期订单（要安排投递）', value: 'recent' },
              { label: '历史归档（只补记录）', value: 'historical' },
            ]}
          />
          <Space wrap>
            <span>活动标签：<Input value={campaign} onChange={({ target: { value } }) => updateImportSettings(() => setCampaign(value))} placeholder="如 2026-618（可空）" style={{ width: 200 }} allowClear /></span>
            <Text type="secondary" style={{ fontSize: 12 }}>写到这批每张订单，便于追溯 + 按活动统计</Text>
          </Space>
          {mode === 'recent' ? (
            <>
              <Space wrap>
                <span>邮局起投月：<DatePicker picker="month" value={postOfficeStart} onChange={(v) => updateImportSettings(() => setPostOfficeStart(v))} placeholder="如 2026-07" /></span>
                <span>中通起投月：<DatePicker picker="month" value={ztoStart} onChange={(v) => updateImportSettings(() => setZtoStart(v))} placeholder="如 2026-07" /></span>
                <span>截止日：<DatePicker value={cutoff} onChange={(v) => updateImportSettings(() => setCutoff(v))} placeholder="此日后付款→下月" /></span>
              </Space>
              <Card size="small" type="inner" title="活动赠品（只给本批「含订阅」的订单，单期不送）">
                <Space wrap align="end">
                  <span>订期延长：<InputNumber min={0} max={12} value={bonusMonths} onChange={(v) => updateImportSettings(() => setBonusMonths(v ?? 0))} addonAfter="个月" style={{ width: 130 }} /></span>
                  <span>赠送刊物：
                    <Select
                      allowClear
                      placeholder="不送可空"
                      value={giftPublication}
                      onChange={(v) => updateImportSettings(() => setGiftPublication(v))}
                      options={PUBLICATION_OPTIONS}
                      style={{ width: 150 }}
                    />
                  </span>
                  <span>赠品说明：<Input value={giftNote} onChange={({ target: { value } }) => updateImportSettings(() => setGiftNote(value))} placeholder="如《商学院》2-3月合刊（2026-618）" style={{ width: 280 }} disabled={!giftPublication} allowClear /></span>
                </Space>
              </Card>
            </>
          ) : (
            <Alert type="info" title="历史归档：保留下单日期；订期可在预览中批量补录，也可导入后补填。补录后仍需按既有流程安排投递。赠品仅近期模式可设。" />
          )}
        </Space>
      </Card>

      <Card size="small" title="② 上传电商订单 Excel" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Upload.Dragger
            maxCount={1}
            accept=".xlsx"
            beforeUpload={(f) => { updateImportSettings(() => setFile(f)); return false; }}
            onRemove={() => { updateImportSettings(() => setFile(null)); return false; }}
            fileList={file ? [{ uid: '1', name: file.name } as UploadFile] : []}
          >
            <p className="ant-upload-drag-icon"><InboxOutlined /></p>
            <p className="ant-upload-text">点击或拖拽 CBJ 小程序 / 淘宝 导出的 .xlsx 到此处（自动识别平台）</p>
          </Upload.Dragger>
          <Button type="primary" icon={<UploadOutlined />} onClick={handlePreview} loading={previewMutation.isPending} disabled={!file}>预览导入</Button>
        </Space>
      </Card>

      {preview && (
        <>
          {unresolvedSummary.length > 0 && (
            <Card
              size="small"
              title={`⚠ 待确认商品（${unresolvedSummary.length} 种，涉及 ${unresolvedSummary.reduce((total, row) => total + row.count, 0)} 单）`}
              style={{ marginBottom: 16, borderColor: 'var(--color-danger)' }}
            >
              <Space direction="vertical" style={{ width: '100%' }}>
                {unresolvedSummary.map((u) => (
                  <Space key={u.name} wrap style={{ justifyContent: 'space-between', width: '100%' }}>
                    <Text>{u.name} <Text type="secondary">× {u.count} 单</Text></Text>
                    {canMutate ? <Space wrap>
                      <Button type="primary" size="small" disabled={previewMutation.isPending || commitMutation.isPending} onClick={() => setAliasName(u.name)}>关联已有商品</Button>
                      <Button size="small" icon={<PlusOutlined />} disabled={previewMutation.isPending || commitMutation.isPending} onClick={() => openQuickAdd(u.name)}>新增商品</Button>
                    </Space> : <Text type="secondary">只读账号不能修改商品关联</Text>}
                  </Space>
                ))}
                <Text type="secondary" style={{ fontSize: 12 }}>同款促销可关联已有商品的别名；刊物、期限或投递规则不同时再新增商品。保存后同名订单一起重新识别，保留实际成交金额。</Text>
              </Space>
            </Card>
          )}

          <Card
            size="small"
            title="③ 预览（商品关联、订期补录及原始交易留存）"
            extra={
              isAdmin ? (
                <Space><Button href="/orders/sources">来源交易</Button><Button onClick={() => setCoverageOpen(true)} disabled={commitMutation.isPending}>批量补订期</Button><Button type="primary" onClick={() => commitMutation.mutate()} loading={commitMutation.isPending} disabled={!preview.can_commit}>
                  确认导入 {counts.import ?? 0} 单{counts.retain ? `，留存 ${counts.retain} 笔` : ''}{counts.source_update ? `，更新 ${counts.source_update} 笔来源` : ''}
                </Button></Space>
              ) : (
                <Text type="secondary">确认导入需管理员权限</Text>
              )
            }
          >
            <Space style={{ marginBottom: 12 }} wrap role="group" aria-label="按识别结果筛选">
              {PREVIEW_FILTERS.map(filter => (
                <Button key={filter.value} size="small" shape="round" color={filter.color}
                  type={previewFilter === filter.value ? 'primary' : 'default'}
                  variant={previewFilter === filter.value ? 'solid' : 'filled'}
                  icon={previewFilter === filter.value ? <CheckOutlined aria-hidden /> : undefined}
                  aria-pressed={previewFilter === filter.value}
                  disabled={previewMutation.isPending || commitMutation.isPending}
                  onClick={() => { setPreviewFilter(filter.value); setPreviewPage(1); }}>
                  {filter.label} {filter.value === 'all' ? preview.rows.length : counts[filter.value] ?? 0}
                </Button>
              ))}
              <Text type="secondary" role="status">当前显示 {visibleRows.length} 单 / 全部 {preview.rows.length} 单</Text>
            </Space>
            <div style={{ marginBottom: 12 }}><Text type="secondary">点击分类可优先核对待确认或重复订单；确认导入仍处理本批全部 {counts.import ?? 0} 单可导入订单。</Text></div>
            {!!(counts.retain || counts.source_update) && <Alert type="info" showIcon style={{ marginBottom: 12 }}
              title="留存交易不会生成订阅或发货。来源更新需点开逐笔核对；保存后到“来源交易”继续处理。" />}
            <Table<ImportPreviewRow>
              rowKey="external_order_no"
              columns={columns}
              dataSource={visibleRows}
              loading={previewMutation.isPending}
              size="small"
              locale={{ emptyText: previewFilter === 'all' ? '没有可预览的订单' : `当前没有“${previewFilterLabel}”订单` }}
              pagination={{ current: previewPage, pageSize: previewPageSize, showTotal: (t) => `共 ${t} 单`,
                onChange: (page, pageSize) => { setPreviewPage(pageSize === previewPageSize ? page : 1); setPreviewPageSize(pageSize); } }}
              scroll={{ x: 1000 }}
              onRow={(row) => ({ onClick: () => handleRowClick(row), style: { cursor: 'pointer' } })}
            />
          </Card>
        </>
      )}

      <Drawer
        title={(
          <DrawerTitle
            icon={drawerMode === 'quick' ? '➕' : '📦'}
            title={drawerMode === 'quick' ? '新增商品' : '订单识别详情'}
            description={drawerMode === 'quick'
              ? '补齐商品后自动重新识别本次导入'
              : `来源单号 ${detailRow?.external_order_no || '未记录'} · ${detailRow?.recipient_name || '未记录收件人'}`}
            tone={drawerMode === 'quick' ? 'purple' : 'info'}
            status={(
              <StatusPill tone={drawerMode === 'quick' ? 'warning' : detailRow?.decision === 'import' ? 'success' : detailRow?.decision === 'unresolved' ? 'danger' : 'neutral'}>
                {drawerMode === 'quick' ? '待补商品' : detailRow ? DECISION_META[detailRow.decision].label : '查看中'}
              </StatusPill>
            )}
          />
        )}
        open={drawerMode !== null}
        onClose={() => setDrawerMode(null)}
        size={560}
        rootClassName="app-drawer-root"
        footer={(
          <div className="app-drawer-footer">
            <span className="app-drawer-footer-tip"><b>✓</b>{drawerMode === 'quick' ? '保存后自动刷新全部订单识别结果' : '这里只读展示本次导入判断'}</span>
            <Button onClick={() => setDrawerMode(null)}>{drawerMode === 'quick' ? '取消' : '关闭'}</Button>
            {drawerMode === 'quick' && <Button type="primary" onClick={() => quickForm.submit()} loading={quickAddMutation.isPending}>保存并重新识别</Button>}
          </div>
        )}
      >
        {drawerMode === 'quick' && (
          <div className="app-drawer-stack">
            <Alert type="info" style={{ marginBottom: 12 }} title="填好这一个商品并保存后，会自动重新预览——用到它的所有订单会一起变为「导入」。" />
            <div className="app-drawer-panel">
              <h3><span aria-hidden>📦</span>商品信息</h3>
              <Form<ProductFormValues> form={quickForm} layout="vertical" onFinish={(v) => quickAddMutation.mutate(v)}>
                <ProductFormFields editing={false} />
              </Form>
            </div>
          </div>
        )}
        {drawerMode === 'detail' && detailRow && (
          <div className="app-drawer-stack">
            <div className="app-drawer-hero">
              <span className="app-drawer-avatar">{detailRow.recipient_name.slice(0, 1)}</span>
              <div className="app-drawer-hero-copy">
                <strong>{detailRow.recipient_name}</strong>
                <span>实付 ¥{detailRow.paid_amount} · 平台状态 {detailRow.status_raw} → {detailRow.commercial_status ?? '-'}</span>
              </div>
            </div>
            <div className="app-drawer-panel">
              <h3><span aria-hidden>🔎</span>识别结果</h3>
            <Text><b>结果：</b>{DECISION_META[detailRow.decision].label}{detailRow.reason ? `（${detailRow.reason}）` : ''}</Text>
            {detailRow.delivery_overridden_to_zto && <Tag color="orange">投递已改中通，请核对</Tag>}
            {detailRow.items.length > 0 && (
              <Card size="small" title="识别明细">
                {detailRow.items.map((it, i) => (
                  <div key={i} style={{ fontSize: 13 }}>
                    {it.billing_type === 'free_gift' && <Tag color="gold" style={{ marginInlineEnd: 4 }}>🎁 赠品</Tag>}
                    {publicationLabel((it.publication ?? 'other') as never)}/{fulfillmentTypeLabel(it.fulfillment_type as never)}
                    {it.delivery_method ? `/${deliveryMethodLabel(it.delivery_method as never)}` : ''}{it.issue_number ? ` · 第${it.issue_number}期` : ''}{it.issue_label ? ` · 期${it.issue_label}` : ''} · 份{it.total_quantity} · ¥{it.subtotal} · 订期：{formatSubscriptionPeriod(it.coverage_start_date, it.coverage_end_date)}
                  </div>
                ))}
              </Card>
            )}
            {detailRow.decision === 'import' && <Text type="secondary" style={{ fontSize: 12 }}>导入后如需改起止日期/状态等，可到「订单管理 → 订单列表」对应订单详情页调整。</Text>}
            {detailRow.source_snapshot && <div style={{ marginTop: 16 }}>
              <Text strong>原始来源</Text>
              <p>{String(detailRow.source_snapshot.filename ?? '')} · {String(detailRow.source_snapshot.source_sheet ?? '')} 第 {String(detailRow.source_snapshot.source_row ?? '')} 行</p>
              <Table size="small" pagination={false} rowKey="field" columns={[
                { title: '字段', dataIndex: 'field' },
                ...(detailRow.previous_snapshot ? [{ title: '已留存', dataIndex: 'before' }] : []),
                { title: '本次原始值', dataIndex: 'after' },
              ]} dataSource={Object.entries({ status_raw: '状态', paid_amount: '付款金额', recipient_name: '姓名', recipient_phone: '电话', recipient_address: '地址', notes: '备注', order_date: '下单日期', product_lines: '商品原文', payment_time: '支付时间', original_amount: '原价', recipient_postal_code: '邮编', payment_method: '支付方式', invoice: '开票信息', raw_cells: '全部原始字段' }).map(([key, field]) => ({
                field, before: JSON.stringify(detailRow.previous_snapshot?.[key] ?? ''), after: JSON.stringify(detailRow.source_snapshot?.[key] ?? ''),
              }))} />
              {detailRow.decision === 'source_update' && <Checkbox checked={confirmedSourceUpdates.includes(detailRow.external_order_no)}
                onChange={e => setConfirmedSourceUpdates(prev => e.target.checked ? [...prev, detailRow.external_order_no] : prev.filter(no => no !== detailRow.external_order_no))}>
                我已核对原始变化，确认保存新版本（不自动改变主订阅的财务或投递）
              </Checkbox>}
            </div>}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
