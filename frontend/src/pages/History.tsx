import { Table, Tag, Button, Space, Card } from 'antd';
import { EditOutlined, SendOutlined, DownloadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getIssues } from '../api/issues';
import type { Issue } from '../api/issues';
import type { TableColumnsType } from 'antd';
import dayjs from 'dayjs';

const statusColors: Record<string, string> = { draft: 'orange', confirmed: 'blue', exported: 'green' };
const statusLabels: Record<string, string> = { draft: '草稿', confirmed: '已确认', exported: '已导出' };

export default function History() {
  const navigate = useNavigate();

  const { data: issues = [], isLoading: loading } = useQuery({
    queryKey: ['issues', 'history'],
    queryFn: async () => {
      const res = await getIssues(0, 100);
      return res.data;
    },
  });

  const columns: TableColumnsType<Issue> = [
    { title: '期号', dataIndex: 'issue_number', sorter: (a: Issue, b: Issue) => a.issue_number - b.issue_number },
    { title: '出版日期', dataIndex: 'publish_date', render: (_, record) => dayjs(record.publish_date).format('YYYY-MM-DD') },
    { title: '状态', dataIndex: 'status', render: (_, record) => <Tag color={statusColors[record.status]}>{statusLabels[record.status]}</Tag> },
    { title: '创建时间', dataIndex: 'created_at', render: (_, record) => record.created_at ? dayjs(record.created_at).format('MM-DD HH:mm') : '—' },
    { title: '操作', render: (_, record) => (
      <Space>
        <Button size="small" type="text" icon={<EditOutlined />} onClick={() => navigate(`/report/${record.id}`)}>报数</Button>
        <Button size="small" type="text" icon={<SendOutlined />} onClick={() => navigate(`/shipping/${record.id}`)}>发货</Button>
        <Button size="small" type="text" icon={<DownloadOutlined />} onClick={() => window.open(`/api/issues/${record.id}/export/all`, '_blank')}>导出</Button>
      </Space>
    )},
  ];

  return (
    <div>
      <h2 style={{
        fontSize: 24,
        fontWeight: 700,
        color: '#1d1d1f',
        margin: '0 0 24px 0',
        letterSpacing: '-0.02em',
      }}>
        历史期数
      </h2>
      <Card style={{ padding: 0 }}>
        <Table columns={columns} dataSource={issues} rowKey="id" loading={loading} />
      </Card>
    </div>
  );
}
