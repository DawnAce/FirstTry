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
} from '@arco-design/web-react';
import { IconPlus, IconEdit, IconSend } from '@arco-design/web-react/icon';
import dayjs from 'dayjs';
import { getIssues, getNextIssue, createIssue } from '../api/issues';
import type { Issue, NextIssueInfo } from '../api/issues';

const { Row, Col } = Grid;

export default function Dashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [nextIssue, setNextIssue] = useState<NextIssueInfo | null>(null);
  const [recentIssues, setRecentIssues] = useState<Issue[]>([]);
  const [stats, setStats] = useState({ total: 0, draft: 0 });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [nextRes, issuesRes] = await Promise.all([
        getNextIssue(),
        getIssues(0, 10),
      ]);
      setNextIssue(nextRes.data);
      setRecentIssues(issuesRes.data);
      
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
    if (!nextIssue) return;
    
    setCreating(true);
    try {
      const res = await createIssue({
        issue_number: nextIssue.issue_number,
        publish_date: nextIssue.publish_date,
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
              title="下一期报数"
              value={nextIssue ? `第 ${nextIssue.issue_number} 期` : '-'}
              extra={
                <div style={{ fontSize: '14px', color: '#86909c', marginTop: '8px' }}>
                  {nextIssue ? dayjs(nextIssue.publish_date).format('YYYY-MM-DD') : ''}
                </div>
              }
            />
            <Button
              type="primary"
              icon={<IconPlus />}
              onClick={handleCreateIssue}
              loading={creating}
              disabled={!nextIssue}
              style={{ marginTop: '16px', width: '100%' }}
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
