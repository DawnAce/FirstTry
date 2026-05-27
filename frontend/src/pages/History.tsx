import { useState, useMemo } from 'react';
import { Table, Tag, Button, Space, Card, Input, Select, DatePicker } from 'antd';
import { EditOutlined, SendOutlined, DownloadOutlined, UploadOutlined, SearchOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getIssues } from '../api/issues';
import type { Issue } from '../api/issues';
import type { TableColumnsType } from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';

const { RangePicker } = DatePicker;

const statusColors: Record<string, string> = { draft: 'orange', confirmed: 'blue', exported: 'green' };
const statusLabels: Record<string, string> = { draft: '草稿', confirmed: '已确认', exported: '已导出' };

export default function History() {
  const navigate = useNavigate();
  const [searchNumber, setSearchNumber] = useState('');
  const [filterStatus, setFilterStatus] = useState<string | undefined>(undefined);
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);

  const { data: issues = [], isLoading: loading } = useQuery({
    queryKey: ['issues', 'history'],
    queryFn: async () => {
      const res = await getIssues(0, 100);
      return res.data;
    },
  });

  const filteredIssues = useMemo(() => {
    return issues.filter((issue) => {
      if (searchNumber && !String(issue.issue_number).includes(searchNumber)) {
        return false;
      }
      if (filterStatus && issue.status !== filterStatus) {
        return false;
      }
      if (dateRange && dateRange[0] && dateRange[1]) {
        const publishDate = dayjs(issue.publish_date);
        if (publishDate.isBefore(dateRange[0], 'day') || publishDate.isAfter(dateRange[1], 'day')) {
          return false;
        }
      }
      return true;
    });
  }, [issues, searchNumber, filterStatus, dateRange]);

  const columns: TableColumnsType<Issue> = [
    { title: '期号', dataIndex: 'issue_number', sorter: (a: Issue, b: Issue) => a.issue_number - b.issue_number },
    { title: '出版日期', dataIndex: 'publish_date', render: (_, record) => dayjs(record.publish_date).format('YYYY-MM-DD') },
    { title: '状态', dataIndex: 'status', render: (_, record) => <Tag color={statusColors[record.status]}>{statusLabels[record.status]}</Tag> },
    { title: '创建时间', dataIndex: 'created_at', render: (_, record) => record.created_at ? dayjs(record.created_at).format('MM-DD HH:mm') : '—' },
    { title: '操作', render: (_, record) => (
      <Space>
        <Button size="small" type="text" icon={<EditOutlined />} onClick={() => navigate(`/report/${record.id}`)}>报数</Button>
        <Button size="small" type="text" icon={<SendOutlined />} onClick={() => navigate(`/recipients?tab=shipping&issueId=${record.id}`)}>中通明细</Button>
        <Button size="small" type="text" icon={<DownloadOutlined />} onClick={() => window.open(`/api/issues/${record.id}/export/all`, '_blank')}>导出</Button>
      </Space>
    )},
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h2 style={{
          fontSize: 24,
          fontWeight: 700,
          color: '#1d1d1f',
          margin: 0,
          letterSpacing: '-0.02em',
        }}>
          历史印数期数
        </h2>
        <Button icon={<UploadOutlined />} onClick={() => navigate('/history-import')}>
          导入往期
        </Button>
      </div>
      <Card style={{ padding: 0 }}>
        <Space wrap style={{ marginBottom: 16 }}>
          <Input
            placeholder="搜索期号"
            prefix={<SearchOutlined />}
            allowClear
            value={searchNumber}
            onChange={(e) => setSearchNumber(e.target.value)}
            style={{ width: 160 }}
          />
          <RangePicker
            placeholder={['开始日期', '结束日期']}
            value={dateRange}
            onChange={(dates) => setDateRange(dates)}
            style={{ width: 240 }}
          />
          <Select
            placeholder="状态筛选"
            allowClear
            value={filterStatus}
            onChange={(value) => setFilterStatus(value)}
            style={{ width: 120 }}
            options={[
              { label: '草稿', value: 'draft' },
              { label: '已确认', value: 'confirmed' },
              { label: '已导出', value: 'exported' },
            ]}
          />
        </Space>
        <Table columns={columns} dataSource={filteredIssues} rowKey="id" loading={loading} />
      </Card>
    </div>
  );
}
