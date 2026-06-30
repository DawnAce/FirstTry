import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Typography,
  message,
} from 'antd';
import { ReloadOutlined, ThunderboltOutlined } from '@ant-design/icons';
import type { TableColumnsType } from 'antd';
import {
  applyAllForIssue,
  getIssueGapReport,
  getIssueReconciliation,
  shipAllForIssue,
} from '../api/orders';
import type { IssueGapRow, ReconUnshippedRow } from '../api/orders';
import { shipShippingDetail } from '../api/shippingDetails';
import { getIssues } from '../api/issues';

const { Title } = Typography;

const gapColumns: TableColumnsType<IssueGapRow> = [
  {
    title: '订单',
    dataIndex: 'order_code',
    key: 'order_code',
    width: 170,
    render: (v: string | null, r) => v ?? `#${r.order_id}`,
  },
  {
    title: '收件人',
    dataIndex: 'recipient_name',
    key: 'recipient_name',
    width: 160,
    render: (v: string | null) => v ?? '-',
  },
  {
    title: '份数',
    dataIndex: 'quantity',
    key: 'quantity',
    width: 80,
    align: 'right',
    render: (v: number | null) => v ?? '-',
  },
  { title: '原因', dataIndex: 'reason', key: 'reason', render: (v: string | null) => v ?? '-' },
];

function GapSection({ title, rows }: { title: string; rows: IssueGapRow[] }) {
  return (
    <Card size="small" title={`${title}（${rows.length}）`} style={{ marginBottom: 16 }}>
      <Table<IssueGapRow>
        rowKey={(r, i) => `${r.order_id}-${r.fulfillment_target_id ?? 'x'}-${i ?? 0}`}
        size="small"
        columns={gapColumns}
        dataSource={rows}
        pagination={false}
        locale={{ emptyText: '无' }}
      />
    </Card>
  );
}

export default function IssueDispatch() {
  const queryClient = useQueryClient();
  const [issueNumber, setIssueNumber] = useState<number | null>(null);

  const issuesQuery = useQuery({
    queryKey: ['issues', 0, 100],
    queryFn: async () => (await getIssues(0, 100)).data,
  });

  const issueOptions = useMemo(
    () =>
      [...(issuesQuery.data ?? [])]
        .sort((a, b) => b.issue_number - a.issue_number)
        .map((issue) => ({
          value: issue.issue_number,
          label: `第 ${issue.issue_number} 期${
            issue.year_issue_label ? `（${issue.year_issue_label}）` : ''
          }`,
        })),
    [issuesQuery.data],
  );

  const gapQuery = useQuery({
    queryKey: ['issueGap', issueNumber],
    queryFn: async () => (await getIssueGapReport(issueNumber as number)).data,
    enabled: issueNumber != null,
  });

  const applyMutation = useMutation({
    mutationFn: async () => (await applyAllForIssue(issueNumber as number)).data,
    onSuccess: (data) => {
      if (data.suspended) {
        message.warning(data.message ?? '休刊期，未排发');
        return;
      }
      const parts = [
        `${data.orders_applied} 单已排（建 ${data.rows_created} 行 / 改 ${data.rows_updated} 行）`,
        `${data.orders_unchanged} 单无变化`,
      ];
      if (data.orders_conflict) parts.push(`${data.orders_conflict} 单冲突（人工改过，已跳过）`);
      if (data.orders_skipped) parts.push(`${data.orders_skipped} 单跳过`);
      message.success(parts.join('；'));
      queryClient.invalidateQueries({ queryKey: ['issueGap', issueNumber] });
      queryClient.invalidateQueries({ queryKey: ['issueRecon', issueNumber] });
      queryClient.invalidateQueries({ queryKey: ['shippingDetails'] });
    },
    onError: () => message.error('批量排发失败'),
  });

  const reconQuery = useQuery({
    queryKey: ['issueRecon', issueNumber],
    queryFn: async () => (await getIssueReconciliation(issueNumber as number)).data,
    enabled: issueNumber != null,
  });

  const shipAllMutation = useMutation({
    mutationFn: async () => (await shipAllForIssue(issueNumber as number)).data,
    onSuccess: (data) => {
      message.success(`已标记 ${data.shipped_rows} 行为已发`);
      queryClient.invalidateQueries({ queryKey: ['issueRecon', issueNumber] });
      queryClient.invalidateQueries({ queryKey: ['shippingDetails'] });
    },
    onError: () => message.error('标记已发失败'),
  });

  const shipOneMutation = useMutation({
    mutationFn: async (detailId: number) => (await shipShippingDetail(detailId)).data,
    onSuccess: () => {
      message.success('已标记该行已发');
      queryClient.invalidateQueries({ queryKey: ['issueRecon', issueNumber] });
      queryClient.invalidateQueries({ queryKey: ['shippingDetails'] });
    },
    onError: () => message.error('标记失败'),
  });

  const reconColumns: TableColumnsType<ReconUnshippedRow> = [
    {
      title: '订单',
      dataIndex: 'order_code',
      key: 'order_code',
      width: 170,
      render: (v: string | null, r) => v ?? `#${r.order_id}`,
    },
    {
      title: '收件人',
      dataIndex: 'recipient_name',
      key: 'recipient_name',
      width: 160,
      render: (v: string | null) => v ?? '-',
    },
    {
      title: '份数',
      dataIndex: 'quantity',
      key: 'quantity',
      width: 80,
      align: 'right',
      render: (v: number | null) => v ?? '-',
    },
    {
      title: '操作',
      key: 'actions',
      width: 100,
      render: (_: unknown, r) => (
        <Button
          type="link"
          size="small"
          loading={shipOneMutation.isPending}
          onClick={() => shipOneMutation.mutate(r.shipping_detail_id)}
        >
          标已发
        </Button>
      ),
    },
  ];

  const report = gapQuery.data;
  const recon = reconQuery.data;

  return (
    <div>
      <Title level={3}>按期排发</Title>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Select<number>
            style={{ width: 240 }}
            loading={issuesQuery.isLoading}
            options={issueOptions}
            placeholder="选择刊期"
            value={issueNumber}
            showSearch
            optionFilterProp="label"
            onChange={(v) => setIssueNumber(v)}
          />
          <Button
            icon={<ReloadOutlined />}
            disabled={issueNumber == null}
            loading={gapQuery.isFetching}
            onClick={() => gapQuery.refetch()}
          >
            查漏期
          </Button>
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            disabled={issueNumber == null}
            loading={applyMutation.isPending}
            onClick={() => applyMutation.mutate()}
          >
            一键排发本期
          </Button>
        </Space>
      </Card>

      {issueNumber == null && <Empty description="选择一个刊期，查看谁该排却没排" />}

      {report?.suspended && (
        <Alert type="warning" showIcon title="该期为休刊期，不生成发货明细" />
      )}

      {report && !report.suspended && (
        <>
          <Card size="small" style={{ marginBottom: 16 }}>
            <Row gutter={12}>
              <Col span={4}>
                <Statistic title="候选订单" value={report.total_orders} />
              </Col>
              <Col span={4}>
                <Statistic title="已同步(收件人)" value={report.synced_count} />
              </Col>
              <Col span={4}>
                <Statistic
                  title="待排"
                  value={report.missing.length}
                  valueStyle={report.missing.length ? { color: '#fa8c16' } : undefined}
                />
              </Col>
              <Col span={4}>
                <Statistic title="需更新" value={report.stale.length} />
              </Col>
              <Col span={4}>
                <Statistic
                  title="冲突"
                  value={report.conflict.length}
                  valueStyle={report.conflict.length ? { color: '#cf1322' } : undefined}
                />
              </Col>
              <Col span={4}>
                <Statistic title="跳过" value={report.skipped.length} />
              </Col>
            </Row>
          </Card>

          {recon && (
            <Card
              size="small"
              title="本期对账（应发 vs 实发）"
              style={{ marginBottom: 16 }}
              extra={
                <Button
                  type="primary"
                  loading={shipAllMutation.isPending}
                  disabled={recon.planned_rows === 0}
                  onClick={() => shipAllMutation.mutate()}
                >
                  一键标记本期已发
                </Button>
              }
            >
              <Row gutter={12}>
                <Col span={6}>
                  <Statistic title="应发份数" value={recon.planned_quantity} />
                </Col>
                <Col span={6}>
                  <Statistic title="已发份数" value={recon.shipped_quantity} />
                </Col>
                <Col span={6}>
                  <Statistic
                    title="缺口"
                    value={recon.shortfall_quantity}
                    valueStyle={
                      recon.shortfall_quantity
                        ? { color: '#cf1322' }
                        : { color: '#3f8600' }
                    }
                  />
                </Col>
                <Col span={6}>
                  <Statistic title="未发行数" value={recon.unshipped.length} />
                </Col>
              </Row>
              {recon.unshipped.length > 0 && (
                <Table<ReconUnshippedRow>
                  rowKey="shipping_detail_id"
                  size="small"
                  style={{ marginTop: 12 }}
                  columns={reconColumns}
                  dataSource={recon.unshipped}
                  pagination={false}
                  title={() => '未发清单（已排但未标已发）'}
                />
              )}
            </Card>
          )}

          <GapSection title="待排（缺发货明细）" rows={report.missing} />
          {report.stale.length > 0 && <GapSection title="需更新（已建但字段有变化）" rows={report.stale} />}
          {report.conflict.length > 0 && (
            <GapSection title="冲突（人工改过，批量会跳过，请人工核对）" rows={report.conflict} />
          )}
          {report.skipped.length > 0 && (
            <GapSection title="跳过（缺覆盖期 / 缺收件人 / 已退款等）" rows={report.skipped} />
          )}
        </>
      )}
    </div>
  );
}
