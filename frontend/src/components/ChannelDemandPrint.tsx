import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Modal, Space, Table, Tag, message } from 'antd';
import { applyDemandPrint, demandKeys, getDemandPrint } from '../api/channelDemands';
import type { DemandPrintPreview } from '../api/channelDemands';
import { demandError } from '../pages/channelDemandUtils';

interface Props {
  issueId: number;
  disabled: boolean;
  beforePreview: () => Promise<void>;
  onApplied: () => Promise<void>;
}
export default function ChannelDemandPrint({ issueId, disabled, beforePreview, onApplied }: Props) {
  const qc = useQueryClient();
  const [preview, setPreview] = useState<DemandPrintPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({ queryKey: demandKeys.print(issueId), queryFn: async () => (await getDemandPrint(issueId)).data });
  const apply = useMutation({
    mutationFn: async () => (await applyDemandPrint(issueId, preview!.token)).data,
    onSuccess: async result => {
      qc.setQueryData(demandKeys.print(issueId), result);
      setPreview(null);
      await onApplied();
      await Promise.all(['channelDemands', 'report', 'issue', 'issues', 'dashboard', 'logisticsOverview', 'logisticsIssues'].map(key => qc.invalidateQueries({ queryKey: [key] })));
      message.success('已采用机构需求，按分项替换印数并保留来源版本');
    },
    onError: err => setError(demandError(err)),
  });
  const showPreview = async () => {
    setLoading(true); setError(null);
    try {
      await beforePreview();
      const result = (await getDemandPrint(issueId)).data;
      qc.setQueryData(demandKeys.print(issueId), result);
      setPreview(result);
    } catch (err) { setError(demandError(err)); } finally { setLoading(false); }
  };
  return <Card title="机构／渠道需求" size="small">
    {query.isError ? <Alert type="error" title="需求加载失败" action={<Button onClick={() => void query.refetch()}>重试</Button>} /> : <p>{query.isPending ? '正在查询…' : query.data?.rows.length ? `${query.data.rows.length} 个分项可核对` : '本期暂无已确认的机构需求。'}</p>}
    <Space wrap><Button disabled={disabled || !query.data?.rows.length} loading={loading} onClick={() => void showPreview()}>预览差异并采用</Button><Link to="/orders/channel-demands">查看需求单</Link></Space>
    {error && <Alert type="error" title={error} />}
    <Modal title="核对机构需求与当前印数" open={!!preview} width={900} onCancel={() => { if (!apply.isPending) { setPreview(null); setError(null); } }} okText="按需求替换分项印数" onOk={() => apply.mutate()} confirmLoading={apply.isPending} okButtonProps={{ disabled: disabled || !preview?.can_apply }} cancelButtonProps={{ disabled: apply.isPending }} destroyOnHidden>
      <Alert type="info" showIcon title="采用会替换列出的渠道分项，不与原数字相加。其他项目保持当前值；已有旧来源、待确认或版本冲突时会阻断。" />
      <Table rowKey={row => `${row.category}/${row.sub_category}`} dataSource={preview?.rows ?? []} pagination={false} scroll={{ x: 650 }} columns={[
        { title: '分项', dataIndex: 'sub_category' }, { title: '当前印数', render: (_, row) => row.current_quantity ?? '缺少项目' }, { title: '需求数量', dataIndex: 'quantity' },
        { title: '差值', render: (_, row) => row.current_quantity === null ? '—' : row.quantity - row.current_quantity },
        { title: '来源与校验', render: (_, row) => <Space orientation="vertical">{row.sources.map(s => <Link key={s.demand_id} to={`/orders/channel-demands/${s.demand_id}`}>{s.display_name} #{s.demand_id} · v{s.version}</Link>)}{row.adopted && <Tag color="green">已采用此版本</Tag>}{row.errors.map(e => <span key={e}>{e}</span>)}</Space> },
      ]} />
      {error && <Alert type="error" title={error} />}
    </Modal>
  </Card>;
}
