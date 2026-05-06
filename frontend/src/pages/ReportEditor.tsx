import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Grid,
  Statistic,
  InputNumber,
  Button,
  Tag,
  Space,
  Spin,
  Divider,
  Popconfirm,
  Message,
} from '@arco-design/web-react';
import {
  IconSave,
  IconCheck,
  IconDownload,
  IconArrowLeft,
} from '@arco-design/web-react/icon';
import type { Issue } from '../api/issues';
import { getIssue } from '../api/issues';
import type { ReportData, ReportEntry } from '../api/reports';
import { getReport, updateReport, confirmReport } from '../api/reports';

const { Row, Col } = Grid;

const categoryLabels: Record<string, string> = {
  postal: '📮 北京邮发',
  retail: '🏪 北京报零',
  guangzhou: '🌆 广州日报',
  social_use: '🏢 社用报',
  temp: '📋 临时加印',
  other: '📦 其他',
};

export default function ReportEditor() {
  const { issueId } = useParams<{ issueId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [entries, setEntries] = useState<ReportEntry[]>([]);

  const { data: issue, isLoading: issueLoading } = useQuery({
    queryKey: ['issue', issueId],
    queryFn: async () => {
      const res = await getIssue(Number(issueId));
      return res.data;
    },
    enabled: !!issueId,
  });

  const { isLoading: reportLoading } = useQuery({
    queryKey: ['report', issueId],
    queryFn: async () => {
      const res = await getReport(Number(issueId));
      return res.data;
    },
    enabled: !!issueId,
    select: (data) => {
      if (entries.length === 0) {
        setEntries(data.entries);
      }
      return data;
    },
  });

  const loading = issueLoading || reportLoading;

  const handleValueChange = (entryId: number, value: number | undefined) => {
    setEntries(entries.map(entry => 
      entry.id === entryId ? { ...entry, value: value ?? 0 } : entry
    ));
  };

  const calculateTotal = () => {
    return entries.reduce((sum, entry) => sum + entry.value, 0);
  };

  const countVariableItems = () => {
    return entries.filter(entry => entry.is_variable).length;
  };

  const groupEntriesByCategory = () => {
    const grouped: Record<string, ReportEntry[]> = {};
    entries.forEach(entry => {
      if (!grouped[entry.category]) {
        grouped[entry.category] = [];
      }
      grouped[entry.category].push(entry);
    });
    return grouped;
  };

  const calculateCategoryTotal = (categoryEntries: ReportEntry[]) => {
    return categoryEntries.reduce((sum, entry) => sum + entry.value, 0);
  };

  const handleSave = async () => {
    if (!issueId) return;
    
    setSaving(true);
    try {
      const payload = entries.map(entry => ({
        category: entry.category,
        sub_category: entry.sub_category,
        value: entry.value,
      }));
      await updateReport(Number(issueId), payload);
      queryClient.invalidateQueries({ queryKey: ['report', issueId] });
      Message.success('保存成功');
    } catch (err) {
      Message.error('保存失败');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleConfirm = async () => {
    if (!issueId) return;
    
    setSaving(true);
    try {
      // First save the data
      const payload = entries.map(entry => ({
        category: entry.category,
        sub_category: entry.sub_category,
        value: entry.value,
      }));
      await updateReport(Number(issueId), payload);
      
      // Then confirm
      await confirmReport(Number(issueId));
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['issues'] });
      queryClient.invalidateQueries({ queryKey: ['issue', issueId] });
      Message.success('确认成功');
      navigate('/dashboard');
    } catch (err: any) {
      if (err.response?.data?.detail) {
        const details = err.response.data.detail;
        if (Array.isArray(details)) {
          details.forEach((error: any) => {
            Message.error(error.msg || JSON.stringify(error));
          });
        } else {
          Message.error(details);
        }
      } else {
        Message.error('确认失败');
      }
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleExport = () => {
    if (!issueId) return;
    window.open(`/api/issues/${issueId}/export/report`, '_blank');
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '100px 0' }}>
        <Spin size={40} />
      </div>
    );
  }

  if (!issue || entries.length === 0) {
    return <div style={{ padding: 24 }}>数据加载失败</div>;
  }

  const groupedEntries = groupEntriesByCategory();

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 28, display: 'flex', alignItems: 'center', gap: 16 }}>
        <Button
          icon={<IconArrowLeft />}
          onClick={() => navigate('/dashboard')}
          style={{ borderRadius: 8 }}
        />
        <div style={{ flex: 1 }}>
          <h2 style={{
            margin: 0,
            fontSize: 24,
            fontWeight: 700,
            color: '#1d1d1f',
            letterSpacing: '-0.02em',
          }}>
            第 {issue.issue_number} 期报数编辑
          </h2>
        </div>
        <Tag color="blue" style={{ fontSize: 13, padding: '4px 14px' }}>{issue.publish_date}</Tag>
      </div>

      {/* Stats & Actions */}
      <Row gutter={20} style={{ marginBottom: 28 }}>
        <Col span={8}>
          <Card style={{ padding: 4 }}>
            <Statistic title="总印数" value={calculateTotal()} suffix="份" precision={0} />
          </Card>
        </Col>
        <Col span={8}>
          <Card style={{ padding: 4 }}>
            <Statistic title="变动项数量" value={countVariableItems()} suffix="项" precision={0} />
          </Card>
        </Col>
        <Col span={8}>
          <Card style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 88 }}>
            <Space size="medium">
              <Button
                type="outline"
                icon={<IconSave />}
                onClick={handleSave}
                loading={saving}
              >
                保存草稿
              </Button>
              <Popconfirm
                title="确认报数"
                content="确认后将无法再修改，是否继续？"
                onOk={handleConfirm}
              >
                <Button type="primary" icon={<IconCheck />} loading={saving}>
                  确认报数
                </Button>
              </Popconfirm>
              <Button icon={<IconDownload />} onClick={handleExport}>
                导出
              </Button>
            </Space>
          </Card>
        </Col>
      </Row>

      {/* Report Entries by Category */}
      {Object.entries(groupedEntries).map(([category, categoryEntries]) => (
        <Card
          key={category}
          title={categoryLabels[category] || category}
          style={{ marginBottom: 20 }}
        >
          {categoryEntries.map((entry, index) => (
            <div key={entry.id}>
              {index > 0 && <Divider style={{ margin: '8px 0' }} />}
              <Row
                align="center"
                style={{
                  padding: '10px 16px',
                  borderLeft: entry.is_variable ? '3px solid #0071e3' : '3px solid transparent',
                  borderRadius: 6,
                  background: entry.is_variable ? 'rgba(0,113,227,0.03)' : 'transparent',
                  transition: 'background 0.2s ease',
                }}
              >
                <Col span={12}>
                  <Space>
                    <span style={{ fontWeight: 500 }}>{entry.sub_category}</span>
                    {entry.is_variable && (
                      <Tag color="arcoblue" size="small">变动</Tag>
                    )}
                  </Space>
                </Col>
                <Col span={12} style={{ textAlign: 'right' }}>
                  <InputNumber
                    value={entry.value}
                    onChange={(value) => handleValueChange(entry.id, value)}
                    min={0}
                    precision={0}
                    style={{ width: 150 }}
                    suffix="份"
                  />
                </Col>
              </Row>
            </div>
          ))}
          <Divider style={{ margin: '12px 0' }} />
          <Row style={{ padding: '0 16px' }}>
            <Col span={12}>
              <span style={{ fontWeight: 600, color: '#1d1d1f' }}>小计</span>
            </Col>
            <Col span={12} style={{ textAlign: 'right' }}>
              <span style={{ fontWeight: 600, color: '#1d1d1f', fontSize: 15 }}>
                {calculateCategoryTotal(categoryEntries)} 份
              </span>
            </Col>
          </Row>
        </Card>
      ))}
    </div>
  );
}
