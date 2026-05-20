import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Row,
  Col,
  Statistic,
  Button,
  Tag,
  Space,
  message,
  Select,
  Popconfirm,
} from 'antd';
import { PlusOutlined, EditOutlined, SendOutlined, DeleteOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { getDashboard, createIssue, deleteIssue } from '../api/issues';
import type { Issue } from '../api/issues';

export default function Dashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<string | undefined>(undefined);

  const { data, isLoading: loading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const res = await getDashboard();
      return res.data;
    },
    select: (data) => {
      // Set default selection on first load
      if (!selectedIssue) {
        if (data.next_issue) {
          setSelectedIssue(String(data.next_issue.issue_number));
        } else if (data.available_issues.length > 0) {
          setSelectedIssue(String(data.available_issues[0].issue_number));
        }
      }
      return data;
    },
  });

  const nextIssue = data?.next_issue ?? null;
  const availableIssues = data?.available_issues ?? [];
  const recentIssues = data?.recent_issues ?? [];
  const visibleRecentIssues = recentIssues.slice(0, 3);
  const stats = data?.stats ?? { total: 0, draft: 0 };

  const handleCreateIssue = async (issueNum?: number) => {
    const num = issueNum ?? (selectedIssue ? Number(selectedIssue) : null);
    if (!num) return;
    const chosen = availableIssues.find(i => i.issue_number === num);
    if (!chosen) return;

    setCreating(true);
    try {
      const res = await createIssue({
        issue_number: chosen.issue_number,
        publish_date: chosen.publish_date,
      });
      message.success(`报数第 ${res.data.issue_number} 期创建成功`);
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['issues'] });
      navigate(`/report/${res.data.id}`);
    } catch (error: any) {
      message.error(error.response?.data?.detail || '创建失败');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteIssue = async (issue: Issue) => {
    try {
      await deleteIssue(issue.id);
      message.success(`第 ${issue.issue_number} 期已删除`);
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['issues'] });
    } catch (error: any) {
      message.error(error.response?.data?.detail || '删除失败');
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
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <h1 style={{
        fontSize: 28,
        fontWeight: 700,
        color: '#1d1d1f',
        margin: '0 0 32px 0',
        letterSpacing: '-0.02em',
      }}>
        报数管理
      </h1>

      {/* Stats Row */}
      <Row gutter={20} style={{ marginBottom: 28 }}>
        <Col span={12}>
          <Card loading={loading} style={{ padding: 4 }}>
            <Statistic title="已创建报数" value={stats.total} suffix="期" />
          </Card>
        </Col>
        <Col span={12}>
          <Card loading={loading} style={{ padding: 4 }}>
            <Statistic title="待确认报数" value={stats.draft} suffix="期" />
          </Card>
        </Col>
      </Row>

      {/* Create Issue */}
      <Card loading={loading} style={{ marginBottom: 28 }}>
        <div style={{ padding: '4px 0' }}>
          {nextIssue && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => handleCreateIssue(nextIssue.issue_number)}
              loading={creating && selectedIssue === String(nextIssue?.issue_number)}
              size="large"
              style={{ width: '100%', height: 48, fontSize: 15, marginBottom: 20 }}
            >
              一键创建第 {nextIssue.issue_number} 期（{dayjs(nextIssue.publish_date).format('MM-DD')}）
            </Button>
          )}
          <div style={{
            padding: '16px 20px',
            background: '#f5f5f7',
            borderRadius: 10,
          }}>
            <div style={{ color: '#86868b', fontSize: 13, marginBottom: 10 }}>
              或选择其他期数补录
            </div>
            <Space style={{ width: '100%' }}>
              <Select
                style={{ width: 280 }}
                placeholder="选择期数"
                value={selectedIssue}
                onChange={(val) => setSelectedIssue(val)}
                showSearch
              >
                {availableIssues.map((item) => (
                  <Select.Option key={item.issue_number} value={String(item.issue_number)}>
                    第 {item.issue_number} 期 ({dayjs(item.publish_date).format('MM-DD')})
                  </Select.Option>
                ))}
              </Select>
              <Button
                icon={<PlusOutlined />}
                onClick={() => handleCreateIssue()}
                loading={creating}
                disabled={!selectedIssue}
              >
                创建
              </Button>
            </Space>
          </div>
        </div>
      </Card>

      {/* Recent Issues */}
      <div style={{ marginBottom: 12 }}>
        <h2 style={{
          fontSize: 20,
          fontWeight: 600,
          color: '#1d1d1f',
          margin: '0 0 16px 0',
        }}>
          最近报数
        </h2>
      </div>
      <Card loading={loading}>
        {visibleRecentIssues.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#86868b' }}>暂无数据</div>
        ) : (
          visibleRecentIssues.map((item, index) => (
            <div
              key={item.id}
              className="dashboard-issue-row"
              onClick={() => navigate(`/report/${item.id}`)}
              style={{
                padding: '16px 4px',
                borderBottom: index < visibleRecentIssues.length - 1 ? '1px solid rgba(0,0,0,0.04)' : 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
              }}
            >
              <div className="dashboard-issue-row-meta">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: '#1d1d1f' }}>
                    第 {item.issue_number} 期
                  </span>
                  {getStatusTag(item.status)}
                </div>
                <div style={{ fontSize: 13, color: '#86868b' }}>
                  {dayjs(item.publish_date).format('YYYY-MM-DD')} · 创建于 {dayjs(item.created_at).format('MM-DD HH:mm')}
                </div>
              </div>
              <Space>
                <Button
                  type="text"
                  icon={<EditOutlined />}
                  onClick={(event) => {
                    event.stopPropagation();
                    navigate(`/report/${item.id}`);
                  }}
                  style={{ color: '#86868b' }}
                >
                  编辑
                </Button>
                <Button
                  type="text"
                  icon={<SendOutlined />}
                  onClick={(event) => {
                    event.stopPropagation();
                    navigate(`/recipients?tab=shipping&issueId=${item.id}`);
                  }}
                  style={{ color: '#86868b' }}
                >
                  中通明细
                </Button>
                <Popconfirm
                  title={`确认删除第 ${item.issue_number} 期？`}
                  description="会同时删除该期报数、发货记录、临时加印和中通发货明细。此操作不可恢复。"
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => handleDeleteIssue(item)}
                  onPopupClick={(event) => event.stopPropagation()}
                >
                  <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={(event) => event.stopPropagation()}
                  >
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
