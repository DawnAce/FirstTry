import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, DatePicker, Select, Space, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import type { Dayjs } from 'dayjs';
import {
  getCampaignSummary,
  getIssueSummary,
  getBsCirculation,
  getOutstandingSummary,
} from '../api/analytics';
import type { CampaignSummaryRow, IssueSummaryRow, BsCirculationRow } from '../api/analytics';
import { publicationLabel } from './orderUtils';

const { Title, Text } = Typography;

export default function Analytics() {
  const [from, setFrom] = useState<Dayjs | null>(null);
  const [to, setTo] = useState<Dayjs | null>(null);

  const params: { date_from?: string; date_to?: string } = {};
  if (from) params.date_from = from.format('YYYY-MM-DD');
  if (to) params.date_to = to.format('YYYY-MM-DD');

  const campaignQuery = useQuery({
    queryKey: ['analytics', 'campaigns', params],
    queryFn: () => getCampaignSummary(params).then((r) => r.data),
  });
  const issueQuery = useQuery({
    queryKey: ['analytics', 'issues', params],
    queryFn: () => getIssueSummary(params).then((r) => r.data),
  });
  const outstandingQuery = useQuery({
    queryKey: ['analytics', 'outstanding'],
    queryFn: () => getOutstandingSummary().then((r) => r.data),
  });

  // 0 = 全部年份
  const [bsYear, setBsYear] = useState<number>(2026);
  const bsQuery = useQuery({
    queryKey: ['analytics', 'bs-circulation', bsYear],
    queryFn: () => getBsCirculation(bsYear ? { year: bsYear } : {}).then((r) => r.data),
  });

  const campaignCols: TableColumnsType<CampaignSummaryRow> = [
    { title: '活动', dataIndex: 'campaign', key: 'campaign', render: (v) => <Tag color="geekblue">{v}</Tag> },
    { title: '订单数', dataIndex: 'order_count', key: 'order_count', align: 'right', sorter: (a, b) => a.order_count - b.order_count },
    { title: '原价合计', dataIndex: 'total_listed', key: 'total_listed', align: 'right', render: (v) => `¥${v}` },
    { title: '实收金额', dataIndex: 'total_paid', key: 'total_paid', align: 'right', render: (v) => `¥${v}`, sorter: (a, b) => Number(a.total_paid) - Number(b.total_paid) },
    {
      title: '折扣',
      key: 'discount',
      align: 'right',
      sorter: (a, b) => Number(a.total_discount) - Number(b.total_discount),
      render: (_v, r) => {
        const listed = Number(r.total_listed);
        const disc = Number(r.total_discount);
        if (!disc) return <Text type="secondary">—</Text>;
        const pct = listed > 0 ? Math.round((disc / listed) * 1000) / 10 : 0;
        return <Text type="success">省¥{r.total_discount}（{pct}%）</Text>;
      },
    },
  ];

  const issueCols: TableColumnsType<IssueSummaryRow> = [
    { title: '刊物', dataIndex: 'publication', key: 'publication', render: (v) => publicationLabel(v as never) },
    { title: '期次', dataIndex: 'issue_label', key: 'issue_label', render: (v) => <Tag>{v}</Tag> },
    { title: '销量(份)', dataIndex: 'total_quantity', key: 'total_quantity', align: 'right', sorter: (a, b) => a.total_quantity - b.total_quantity },
    { title: '销售额', dataIndex: 'total_paid', key: 'total_paid', align: 'right', render: (v) => `¥${v}`, sorter: (a, b) => Number(a.total_paid) - Number(b.total_paid) },
    { title: '行数', dataIndex: 'line_count', key: 'line_count', align: 'right' },
  ];

  const bsCols: TableColumnsType<BsCirculationRow> = [
    {
      title: '期次', dataIndex: 'issue_label', key: 'issue_label',
      render: (v, r) => (
        <Space size={4}><Tag>{v}</Tag>{!r.in_calendar && <Tag color="orange">不在刊历</Tag>}</Space>
      ),
    },
    { title: '标题', dataIndex: 'title', key: 'title', render: (v) => v ?? <Text type="secondary">—</Text> },
    { title: '单期销量', dataIndex: 'single_issue_qty', key: 'single', align: 'right' },
    { title: '订阅覆盖', dataIndex: 'subscription_qty', key: 'sub', align: 'right' },
    { title: '合计发行', dataIndex: 'total_qty', key: 'total', align: 'right', render: (v) => <Text strong>{v}</Text>, sorter: (a, b) => a.total_qty - b.total_qty },
  ];

  return (
    <div>
      <Title level={3}>活动订单统计</Title>
      <Space style={{ marginBottom: 16 }} wrap>
        <Text>下单日期：</Text>
        <DatePicker value={from} onChange={setFrom} placeholder="起（可空）" allowClear />
        <Text>—</Text>
        <DatePicker value={to} onChange={setTo} placeholder="止（可空）" allowClear />
      </Space>

      <Card size="small" title="欠款汇总（应收 / 实付 / 未付清）" style={{ marginBottom: 16 }}>
        {outstandingQuery.data ? (
          <Space size="large" wrap>
            <Text>
              应收合计：<Text strong>¥{outstandingQuery.data.total_receivable}</Text>
            </Text>
            <Text>
              实付合计：<Text strong>¥{outstandingQuery.data.total_paid}</Text>
            </Text>
            <Text>
              欠款合计：
              <Text
                strong
                type={Number(outstandingQuery.data.total_outstanding) > 0 ? 'danger' : 'success'}
              >
                ¥{outstandingQuery.data.total_outstanding}
              </Text>
            </Text>
            <Text>
              未付清订单：<Text strong>{outstandingQuery.data.unpaid_orders}</Text> 单
            </Text>
          </Space>
        ) : (
          <Text type="secondary">加载中…</Text>
        )}
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
          只计生效且非退款/取消单；欠款按逐单 max(0, 应收 − 实付) 求和。电商单下单全款、欠款为 0；欠款主要在对公/手工单。
        </Text>
      </Card>

      <Card
        size="small"
        title="按活动统计（order.campaign）"
        style={{ marginBottom: 16 }}
        extra={
          campaignQuery.data && (
            <Text type="secondary">
              {campaignQuery.data.total_campaigns} 个活动 · 共 {campaignQuery.data.grand_total_orders} 单 · 实收 ¥{campaignQuery.data.grand_total_paid} · 省 ¥{campaignQuery.data.grand_total_discount}
            </Text>
          )
        }
      >
        <Table<CampaignSummaryRow>
          rowKey="campaign"
          size="small"
          loading={campaignQuery.isLoading}
          columns={campaignCols}
          dataSource={campaignQuery.data?.rows ?? []}
          pagination={false}
          locale={{ emptyText: '暂无带活动标签的订单——导入时在「活动标签」填写如 2026-618 即可按活动统计' }}
        />
        <Text type="secondary" style={{ fontSize: 12 }}>
          活动区分（618 / 双十一 / 各年份）来自带年份的 campaign 标签，与商品名无关。
        </Text>
      </Card>

      <Card
        size="small"
        title="按期统计（商学院月刊等单期，issue_label）"
        extra={
          issueQuery.data && (
            <Text type="secondary">
              {issueQuery.data.total_issues} 期 · 共 {issueQuery.data.grand_total_quantity} 份 · ¥{issueQuery.data.grand_total_paid}
            </Text>
          )
        }
      >
        <Table<IssueSummaryRow>
          rowKey={(r) => `${r.publication}-${r.issue_label}`}
          size="small"
          loading={issueQuery.isLoading}
          columns={issueCols}
          dataSource={issueQuery.data?.rows ?? []}
          pagination={false}
          locale={{ emptyText: '暂无带期次标签的单期销售（商学院月刊导入后自动出现）' }}
        />
        <Text type="secondary" style={{ fontSize: 12 }}>
          期次（2026-01 等）落在订单行 issue_label，年/月在期次层，不在商品名里。
        </Text>
      </Card>

      <Card
        size="small"
        title="按期发行量（商学院 · 单期 + 订阅）"
        style={{ marginTop: 16 }}
        extra={
          <Space>
            <Select
              size="small"
              value={bsYear}
              style={{ width: 110 }}
              onChange={setBsYear}
              options={[
                { label: '2026 年', value: 2026 },
                { label: '2025 年', value: 2025 },
                { label: '2024 年', value: 2024 },
                { label: '全部', value: 0 },
              ]}
            />
            {bsQuery.data && (
              <Text type="secondary">
                单期 {bsQuery.data.grand_total_single} + 订阅 {bsQuery.data.grand_total_subscription} = 共 {bsQuery.data.grand_total} 份
              </Text>
            )}
          </Space>
        }
      >
        <Table<BsCirculationRow>
          rowKey="issue_label"
          size="small"
          loading={bsQuery.isLoading}
          columns={bsCols}
          dataSource={bsQuery.data?.rows ?? []}
          pagination={false}
          locale={{ emptyText: '该年暂无商学院发行数据（需先 seed 刊历 + 导入订单）' }}
        />
        {!!bsQuery.data?.unexpanded_subscriptions && (
          <Text type="warning" style={{ fontSize: 12, display: 'block' }}>
            ⚠ 另有 {bsQuery.data.unexpanded_subscriptions} 张商学院订阅缺覆盖期（历史/未配起投月），未计入任何一期——补齐覆盖期后即可计入。
          </Text>
        )}
        <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
          发行量 = 单期销量 + 覆盖该期的订阅（合刊只计一次）。订阅按覆盖期落到商学院刊历展开。
        </Text>
      </Card>
    </div>
  );
}
