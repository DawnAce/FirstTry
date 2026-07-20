import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Drawer,
  Form,
  Input,
  InputNumber,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd';
import { InboxOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons';
import type { TableColumnsType, UploadFile } from 'antd';
import type { Dayjs } from 'dayjs';
import { commitOrderImport, previewOrderImport } from '../api/orderImport';
import { useAuth } from '../contexts/AuthContext';
import type { ImportDecision, ImportPreviewOut, ImportPreviewRow, PreviewSettings } from '../api/orderImport';
import { createProduct } from '../api/products';
import { ProductFormFields, PUBLICATION_OPTIONS, buildProductPayload } from './ProductForm';
import type { ProductFormValues } from './ProductForm';
import { deliveryMethodLabel, formatCoverage, fulfillmentTypeLabel, publicationLabel } from './orderUtils';
import EcommerceRules from './ecommerceRules';

const { Title, Text } = Typography;

type Mode = 'recent' | 'historical';

const DECISION_META: Record<ImportDecision, { label: string; color: string }> = {
  import: { label: '✅ 导入', color: 'green' },
  skip_status: { label: '⏭ 跳过', color: 'default' },
  duplicate: { label: '♻ 重复', color: 'blue' },
  unresolved: { label: '⚠ 待确认', color: 'red' },
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

export default function OrderImport() {
  const { isAdmin } = useAuth();
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
      return commitOrderImport(preview!.session_id, issueOverrides, validLabels);
    },
    onSuccess: (res) => {
      message.success(`成功导入 ${res.data.created} 单（跳过重复 ${res.data.skipped_duplicates}）`);
      setPreview(null);
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
      message.success('商品已加入商品库，正在重新识别…');
      setDrawerMode(null);
      previewMutation.mutate(); // re-resolve the whole batch against the updated catalog
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
    if (row.decision === 'unresolved' && row.unresolved_product) {
      openQuickAdd(row.unresolved_product);
    } else {
      setDetailRow(row);
      setDrawerMode('detail');
    }
  };

  const handlePreview = () => {
    if (!file) {
      message.warning('请先选择电商订单 Excel');
      return;
    }
    previewMutation.mutate();
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
                    {it.delivery_method ? `/${deliveryMethodLabel(it.delivery_method as never)}` : ''}{it.issue_number ? ` · 第${it.issue_number}期` : ''}{it.issue_label ? ` · 期${it.issue_label}` : ''} · ¥{it.subtotal} · 覆盖{formatCoverage(it.coverage_start_date, it.coverage_end_date)}
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

  return (
    <div>
      <Title level={3}>电商订单导入</Title>

      <EcommerceRules />

      <Card size="small" title="① 导入模式与起投设置" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Segmented
            value={mode}
            onChange={(v) => { setMode(v as Mode); setPreview(null); }}
            options={[
              { label: '近期订单（要安排投递）', value: 'recent' },
              { label: '历史归档（只补记录）', value: 'historical' },
            ]}
          />
          <Space wrap>
            <span>活动标签：<Input value={campaign} onChange={(e) => { setCampaign(e.target.value); setPreview(null); }} placeholder="如 2026-618（可空）" style={{ width: 200 }} allowClear /></span>
            <Text type="secondary" style={{ fontSize: 12 }}>写到这批每张订单，便于追溯 + 按活动统计</Text>
          </Space>
          {mode === 'recent' ? (
            <>
              <Space wrap>
                <span>邮局起投月：<DatePicker picker="month" value={postOfficeStart} onChange={(v) => { setPostOfficeStart(v); setPreview(null); }} placeholder="如 2026-07" /></span>
                <span>中通起投月：<DatePicker picker="month" value={ztoStart} onChange={(v) => { setZtoStart(v); setPreview(null); }} placeholder="如 2026-07" /></span>
                <span>截止日：<DatePicker value={cutoff} onChange={(v) => { setCutoff(v); setPreview(null); }} placeholder="此日后付款→下月" /></span>
              </Space>
              <Card size="small" type="inner" title="活动赠品（只给本批「含订阅」的订单，单期不送）">
                <Space wrap align="end">
                  <span>订期延长：<InputNumber min={0} max={12} value={bonusMonths} onChange={(v) => { setBonusMonths(v ?? 0); setPreview(null); }} addonAfter="个月" style={{ width: 130 }} /></span>
                  <span>赠送刊物：
                    <Select
                      allowClear
                      placeholder="不送可空"
                      value={giftPublication}
                      onChange={(v) => { setGiftPublication(v); setPreview(null); }}
                      options={PUBLICATION_OPTIONS}
                      style={{ width: 150 }}
                    />
                  </span>
                  <span>赠品说明：<Input value={giftNote} onChange={(e) => { setGiftNote(e.target.value); setPreview(null); }} placeholder="如《商学院》2-3月合刊（2026-618）" style={{ width: 280 }} disabled={!giftPublication} allowClear /></span>
                </Space>
              </Card>
            </>
          ) : (
            <Alert type="info" title="历史归档：保留下单日期、只补记录；订期留空（可在订单页补填），不进发货同步。赠品仅近期模式可设。" />
          )}
        </Space>
      </Card>

      <Card size="small" title="② 上传电商订单 Excel" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Upload.Dragger
            maxCount={1}
            accept=".xlsx"
            beforeUpload={(f) => { setFile(f); setPreview(null); return false; }}
            onRemove={() => { setFile(null); setPreview(null); }}
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
              title={`⚠ 待确认商品（${unresolvedSummary.length} 种，共 ${counts.unresolved ?? 0} 单）— 加入商品库后自动重新识别`}
              style={{ marginBottom: 16, borderColor: '#ffccc7' }}
            >
              <Space direction="vertical" style={{ width: '100%' }}>
                {unresolvedSummary.map((u) => (
                  <Space key={u.name} style={{ justifyContent: 'space-between', width: '100%' }}>
                    <Text>{u.name} <Text type="secondary">× {u.count} 单</Text></Text>
                    <Button type="primary" ghost size="small" icon={<PlusOutlined />} onClick={() => openQuickAdd(u.name)}>加入商品库</Button>
                  </Space>
                ))}
                <Text type="secondary" style={{ fontSize: 12 }}>提示：加一个商品，用它的所有订单会一起变为「导入」。逐个加完即可全部识别。</Text>
              </Space>
            </Card>
          )}

          <Card
            size="small"
            title="③ 预览（点任意行看详情；待确认行可直接加商品；每个缺期的单期 SKU 可各自行内补期号 / 期次，选填、留空也能导入）"
            extra={
              isAdmin ? (
                <Button type="primary" onClick={() => commitMutation.mutate()} loading={commitMutation.isPending} disabled={!preview.can_commit}>
                  确认导入 {counts.import ?? 0} 单
                </Button>
              ) : (
                <Text type="secondary">确认导入需管理员权限</Text>
              )
            }
          >
            <Space style={{ marginBottom: 12 }} wrap>
              <Tag color="green">导入 {counts.import ?? 0}</Tag>
              <Tag color="default">跳过 {counts.skip_status ?? 0}</Tag>
              <Tag color="blue">重复 {counts.duplicate ?? 0}</Tag>
              <Tag color="red">待确认 {counts.unresolved ?? 0}</Tag>
              <Text type="secondary">共 {counts.total ?? 0} 单</Text>
            </Space>
            <Table<ImportPreviewRow>
              rowKey="external_order_no"
              columns={columns}
              dataSource={preview.rows}
              size="small"
              pagination={{ pageSize: 50, showTotal: (t) => `共 ${t} 单` }}
              scroll={{ x: 1000 }}
              onRow={(row) => ({ onClick: () => handleRowClick(row), style: { cursor: 'pointer' } })}
            />
          </Card>
        </>
      )}

      <Drawer
        title={drawerMode === 'quick' ? '加入商品库（已预填名称）' : `订单详情 · ${detailRow?.external_order_no ?? ''}`}
        open={drawerMode !== null}
        onClose={() => setDrawerMode(null)}
        width={560}
        extra={
          drawerMode === 'quick' ? (
            <Button type="primary" onClick={() => quickForm.submit()} loading={quickAddMutation.isPending}>保存并重新识别</Button>
          ) : null
        }
      >
        {drawerMode === 'quick' && (
          <>
            <Alert type="info" style={{ marginBottom: 12 }} title="填好这一个商品并保存后，会自动重新预览——用到它的所有订单会一起变为「导入」。" />
            <Form<ProductFormValues> form={quickForm} layout="vertical" onFinish={(v) => quickAddMutation.mutate(v)}>
              <ProductFormFields editing={false} />
            </Form>
          </>
        )}
        {drawerMode === 'detail' && detailRow && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Text><b>收件人：</b>{detailRow.recipient_name}　<b>付款：</b>¥{detailRow.paid_amount}</Text>
            <Text><b>平台状态：</b>{detailRow.status_raw} → {detailRow.commercial_status ?? '-'}</Text>
            <Text><b>结果：</b>{DECISION_META[detailRow.decision].label}{detailRow.reason ? `（${detailRow.reason}）` : ''}</Text>
            {detailRow.delivery_overridden_to_zto && <Tag color="orange">投递已改中通，请核对</Tag>}
            {detailRow.items.length > 0 && (
              <Card size="small" title="识别明细">
                {detailRow.items.map((it, i) => (
                  <div key={i} style={{ fontSize: 13 }}>
                    {it.billing_type === 'free_gift' && <Tag color="gold" style={{ marginInlineEnd: 4 }}>🎁 赠品</Tag>}
                    {publicationLabel((it.publication ?? 'other') as never)}/{fulfillmentTypeLabel(it.fulfillment_type as never)}
                    {it.delivery_method ? `/${deliveryMethodLabel(it.delivery_method as never)}` : ''}{it.issue_number ? ` · 第${it.issue_number}期` : ''}{it.issue_label ? ` · 期${it.issue_label}` : ''} · 份{it.total_quantity} · ¥{it.subtotal} · 覆盖{formatCoverage(it.coverage_start_date, it.coverage_end_date)}
                  </div>
                ))}
              </Card>
            )}
            <Text type="secondary" style={{ fontSize: 12 }}>导入后如需改起止日期/状态等，可到「订单管理 → 订单列表」对应订单详情页调整。</Text>
          </Space>
        )}
      </Drawer>
    </div>
  );
}
