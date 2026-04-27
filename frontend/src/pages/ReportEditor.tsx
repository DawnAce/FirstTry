import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [issue, setIssue] = useState<Issue | null>(null);
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [entries, setEntries] = useState<ReportEntry[]>([]);

  useEffect(() => {
    if (!issueId) return;
    
    const fetchData = async () => {
      setLoading(true);
      try {
        const [issueRes, reportRes] = await Promise.all([
          getIssue(Number(issueId)),
          getReport(Number(issueId)),
        ]);
        setIssue(issueRes.data);
        setReportData(reportRes.data);
        setEntries(reportRes.data.entries);
      } catch (err) {
        Message.error('加载数据失败');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [issueId]);

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

  if (!issue || !reportData) {
    return <div style={{ padding: 24 }}>数据加载失败</div>;
  }

  const groupedEntries = groupEntriesByCategory();

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 16 }}>
        <Button
          icon={<IconArrowLeft />}
          onClick={() => navigate('/dashboard')}
        >
          返回
        </Button>
        <h2 style={{ margin: 0, flex: 1 }}>第 {issue.issue_number} 期报数编辑</h2>
        <Tag color="blue">{issue.publish_date}</Tag>
      </div>

      {/* Stats Row */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={8}>
          <Card>
            <Statistic
              title="总印数"
              value={calculateTotal()}
              suffix="份"
              precision={0}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title="变动项数量"
              value={countVariableItems()}
              suffix="项"
              precision={0}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Space size="medium" style={{ width: '100%', justifyContent: 'center' }}>
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
                <Button
                  type="primary"
                  icon={<IconCheck />}
                  loading={saving}
                >
                  确认报数
                </Button>
              </Popconfirm>
              <Button
                icon={<IconDownload />}
                onClick={handleExport}
              >
                导出Excel
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
          style={{ marginBottom: 16 }}
        >
          {categoryEntries.map((entry, index) => (
            <div key={entry.id}>
              {index > 0 && <Divider style={{ margin: '12px 0' }} />}
              <Row 
                align="center" 
                style={{
                  padding: '8px 12px',
                  backgroundColor: entry.is_variable ? '#fff7e6' : 'transparent',
                  borderRadius: 4,
                }}
              >
                <Col span={12}>
                  <Space>
                    <span>{entry.sub_category}</span>
                    {entry.is_variable && (
                      <Tag color="orange" size="small">变动</Tag>
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
          <Divider style={{ margin: '16px 0' }} />
          <Row>
            <Col span={12}>
              <strong>小计</strong>
            </Col>
            <Col span={12} style={{ textAlign: 'right' }}>
              <strong>{calculateCategoryTotal(categoryEntries)} 份</strong>
            </Col>
          </Row>
        </Card>
      ))}
    </div>
  );
}
