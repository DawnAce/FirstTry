import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Space, Spin, Typography } from 'antd';
import { getSourceFinanceSummary } from '../api/orderSources';

export default function SourceFinancialSummary({ orderId }: { orderId?: number }) {
  const query = useQuery({ queryKey: ['order-sources', 'financial-summary', orderId], queryFn: async () => (await getSourceFinanceSummary(orderId)).data });
  if (query.isLoading) return <Spin size="small" />;
  if (query.isError) return <Alert type="warning" title="运费汇总加载失败" action={<Button onClick={() => query.refetch()}>重试</Button>} />;
  const value = query.data;
  if (!value || (orderId && !value.fee_count)) return null;
  return <Card size="small" title={orderId ? '订阅与补运费汇总' : '全部独立运费台账汇总'}>
    <Space wrap>
      {orderId && <span>订阅实付 ¥{value.subscription_paid_amount} · 订阅已退 ¥{value.subscription_refunded_amount}</span>}
      <span>运费原付 ¥{value.fee_paid_amount}</span><span>运费已核实退款 ¥{value.fee_refunded_amount}</span>
      <Typography.Text strong>{orderId ? '合计净收' : '运费净额'} {value.unresolved_count ? '待核对' : `¥${orderId ? value.combined_net_amount : value.fee_net_amount}`}</Typography.Text>
    </Space>
    {!!value.unresolved_count && <Alert type="warning" title={`${value.unresolved_count} 笔来源待核对金额或退款分配，尚不能确定完整净额。`} />}
    <div><Typography.Text type="secondary">运费单独计款，不增加订阅份数。原订阅来源不重复加款；此处核对不自动生成收款流水或发票。</Typography.Text></div>
  </Card>;
}
