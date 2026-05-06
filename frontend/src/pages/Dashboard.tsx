import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  Grid,
  Statistic,
  Button,
  Tag,
  List,
  Space,
  Message,
  Select,
} from '@arco-design/web-react';
import { IconPlus, IconEdit, IconSend } from '@arco-design/web-react/icon';
import dayjs from 'dayjs';
import { getIssues, getNextIssue, getAvailableIssues, createIssue } from '../api/issues';
import type { Issue, NextIssueInfo } from '../api/issues';

const { Row, Col } = Grid;

export default function Dashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [nextIssue, setNextIssue] = useState<NextIssueInfo | null>(null);
  const [availableIssues, setAvailableIssues] = useState<NextIssueInfo[]>([]);
  const [selectedIssue, setSelectedIssue] = useState<string | undefined>(undefined);
  const [recentIssues, setRecentIssues] = useState<Issue[]>([]);
  const [stats, setStats] = useState({ total: 0, draft: 0 });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [nextRes, issuesRes, availRes] = await Promise.all([
        getNextIssue().catch(() => ({ data: null })),
        getIssues(0, 10),
        getAvailableIssues(),
      ]);
      setNextIssue(nextRes.data);
      setAvailableIssues(availRes.data);
      setRecentIssues(issuesRes.data);

      // Default selection: next upcoming issue, or first available
      if (nextRes.data) {
        setSelectedIssue(String(nextRes.data.issue_number));
      } else if (availRes.data.length > 0) {
        setSelectedIssue(String(availRes.data[0].issue_number));
      }
      
      // Calculate stats
      const total = issuesRes.data.length;
      const draft = issuesRes.data.filter(i => i.status === 'draft').length;
      setStats({ total, draft });
    } catch (error: any) {
      Message.error(error.response?.data?.detail || '加载数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateIssue = async () => {
    if (!selectedIssue) return;
    const chosen = availableIssues.find(i => i.issue_number === Number(selectedIssue));
    if (!chosen) return;

    setCreating(true);
    try {
      const res = await createIssue({
        issue_number: chosen.issue_number,
        publish_date: chosen.publish_date,
      });
      Message.success(`报数第 ${res.data.issue_number} 期创建成功`);
      navigate(`/issues/${res.data.id}/edit`);
    } catch (error: any) {
      Message.error(error.response?.data?.detail || '创建失败');
    } finally {
      setCreating(false);
    }
  };

  const getStatusTag = (status: Issue['status']) => {
    const statusMap = {
      draft: { color: 'orange', text: '草稿' },
      confirmed: { color: 'blue', text: '已确认' },
      exported: { color: 'green', text: '已导出' },
    };
    const { color, text } = statusMap[status];
    return <Tag color={color}>{text}</Tag>;
  };

  return (
    <div style={{ padding: '24px' }}>
      <h1 style={{ marginBottom: '24px' }}>报数管理系统</h1>
      
      <Row gutter={16} style={{ marginBottom: '24px' }}>
        <Col span={8}>
          <Card loading={loading}>
            <Statistic
              title="创建报数"
              value={selectedIssue ? `第 ${selectedIssue} 期` : '-'}
            />
            <Select
              style={{ width: '100%', marginTop: '12px' }}
              placeholder="选择期数"
              value={selectedIssue}
              onChange={(val) => setSelectedIssue(val)}
              showSearch
            >
              {availableIssues.map((item) => (
                <Select.Option key={item.issue_number} value={String(item.issue_number)}>
                  第 {item.issue_number} 期 ({dayjs(item.publish_date).format('MM-DD')})
                  {nextIssue && item.issue_number === nextIssue.issue_number ? ' ← 推荐' : ''}
                </Select.Option>
              ))}
            </Select>
            <Button
              type="primary"
              icon={<IconPlus />}
              onClick={handleCreateIssue}
              loading={creating}
              disabled={!selectedIssue}
              style={{ marginTop: '8px', width: '100%' }}
            >
              创建本期报数
            </Button>
          </Card>
        </Col>
        
        <Col span={8}>
          <Card loading={loading}>
            <Statistic
              title="已创建报数"
              value={stats.total}
              suffix="期"
            />
          </Card>
        </Col>
        
        <Col span={8}>
          <Card loading={loading}>
            <Statistic
              title="待确认报数"
              value={stats.draft}
              suffix="期"
            />
          </Card>
        </Col>
      </Row>

      <Card title="最近报数" loading={loading}>
        <List
          dataSource={recentIssues}
          render={(item) => (
            <List.Item
              key={item.id}
              actions={[
                <Button
                  key="edit"
                  type="text"
                  icon={<IconEdit />}
                  onClick={() => navigate(`/issues/${item.id}/edit`)}
                >
                  编辑报数
                </Button>,
                <Button
                  key="deliveries"
                  type="text"
                  icon={<IconSend />}
                  onClick={() => navigate(`/issues/${item.id}/deliveries`)}
                >
                  发货明细
                </Button>,
              ]}
            >
              <List.Item.Meta
                title={
                  <Space>
                    <span>第 {item.issue_number} 期</span>
                    {getStatusTag(item.status)}
                  </Space>
                }
                description={
                  <Space>
                    <span>发布日期: {dayjs(item.publish_date).format('YYYY-MM-DD')}</span>
                    <span>创建时间: {dayjs(item.created_at).format('YYYY-MM-DD HH:mm')}</span>
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      </Card>
    </div>
  );
}
