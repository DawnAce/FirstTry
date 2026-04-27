import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Table,
  Tabs,
  Button,
  Tag,
  Space,
  Spin,
  Card,
  Grid,
  Statistic,
  Message,
} from '@arco-design/web-react';
import {
  IconArrowLeft,
  IconRefresh,
  IconDownload,
} from '@arco-design/web-react/icon';
import type { ColumnProps } from '@arco-design/web-react/es/Table';
import { getIssue } from '../api/issues';
import type { Issue } from '../api/issues';
import { getShipping, regenerateShipping } from '../api/shipping';
import type { ShippingRecord } from '../api/shipping';

const { Row, Col } = Grid;
const TabPane = Tabs.TabPane;

const TYPE_LABELS: Record<string, string> = {
  corporate: '对公',
  reader: '读者',
  sample: '样报',
};

const TYPE_COLORS: Record<string, string> = {
  corporate: 'blue',
  reader: 'green',
  sample: 'orange',
};

export default function ShippingPreview() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [issue, setIssue] = useState<Issue | null>(null);
  const [shippingRecords, setShippingRecords] = useState<ShippingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [activeTab, setActiveTab] = useState('all');

  const issueId = Number(id);

  useEffect(() => {
    loadData();
  }, [issueId]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [issueRes, shippingRes] = await Promise.all([
        getIssue(issueId),
        getShipping(issueId),
      ]);
      setIssue(issueRes.data);
      setShippingRecords(shippingRes.data);
    } catch (error) {
      Message.error('加载发货数据失败');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      const res = await regenerateShipping(issueId);
      setShippingRecords(res.data);
      Message.success('发货明细已重新生成');
    } catch (error) {
      Message.error('重新生成失败');
      console.error(error);
    } finally {
      setRegenerating(false);
    }
  };

  const handleExportFiltered = () => {
    const filtered = getFilteredRecords();
    exportToCSV(filtered, `发货明细_${activeTab}`);
  };

  const handleExportAll = () => {
    exportToCSV(shippingRecords, '发货明细_全部');
  };

  const exportToCSV = (records: ShippingRecord[], filename: string) => {
    const headers = ['序号', '收件人', '电话', '地址', '份数', '类型'];
    const rows = records.map((record, index) => [
      index + 1,
      record.recipient_name,
      record.recipient_phone || '',
      record.recipient_address || '',
      record.quantity,
      TYPE_LABELS[record.recipient_type] || record.recipient_type,
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
    ].join('\n');

    const blob = new Blob(['\ufeff' + csvContent], {
      type: 'text/csv;charset=utf-8;',
    });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${filename}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getFilteredRecords = () => {
    if (activeTab === 'all') {
      return shippingRecords;
    }
    return shippingRecords.filter(
      (record) => record.recipient_type === activeTab
    );
  };

  const getTotalRecipients = () => {
    return shippingRecords.length;
  };

  const getTotalCopies = () => {
    return shippingRecords.reduce((sum, record) => sum + record.quantity, 0);
  };

  const columns: ColumnProps<ShippingRecord>[] = [
    {
      title: '序号',
      render: (_col: unknown, _record: ShippingRecord, index: number) => index + 1,
      width: 80,
    },
    {
      title: '收件人',
      dataIndex: 'recipient_name',
      width: 150,
    },
    {
      title: '电话',
      dataIndex: 'recipient_phone',
      width: 150,
      render: (phone: string | null) => phone || '-',
    },
    {
      title: '地址',
      dataIndex: 'recipient_address',
      render: (address: string | null) => address || '-',
    },
    {
      title: '份数',
      dataIndex: 'quantity',
      width: 100,
    },
    {
      title: '类型',
      dataIndex: 'recipient_type',
      width: 100,
      render: (type: string) => (
        <Tag color={TYPE_COLORS[type] || 'gray'}>
          {TYPE_LABELS[type] || type}
        </Tag>
      ),
    },
  ];

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '100px 0' }}>
        <Spin size={40} />
      </div>
    );
  }

  return (
    <div style={{ padding: '20px' }}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <Button
            icon={<IconArrowLeft />}
            onClick={() => navigate('/dashboard')}
          />
          <h2 style={{ margin: 0 }}>
            第 {issue?.issue_number} 期 — 发货明细
          </h2>
        </div>

        {/* Stats Row */}
        <Card>
          <Row gutter={16}>
            <Col span={6}>
              <Statistic
                title="总收件人数"
                value={getTotalRecipients()}
                suffix="人"
              />
            </Col>
            <Col span={6}>
              <Statistic
                title="总份数"
                value={getTotalCopies()}
                suffix="份"
              />
            </Col>
            <Col span={12} style={{ textAlign: 'right', alignSelf: 'center' }}>
              <Space>
                <Button
                  type="primary"
                  icon={<IconRefresh />}
                  onClick={handleRegenerate}
                  loading={regenerating}
                >
                  重新生成
                </Button>
                <Button
                  icon={<IconDownload />}
                  onClick={handleExportFiltered}
                >
                  导出发货明细
                </Button>
                <Button
                  icon={<IconDownload />}
                  onClick={handleExportAll}
                >
                  导出全部
                </Button>
              </Space>
            </Col>
          </Row>
        </Card>

        {/* Tabs with Tables */}
        <Card>
          <Tabs activeTab={activeTab} onChange={setActiveTab}>
            <TabPane key="all" title="全部">
              <Table
                columns={columns}
                data={getFilteredRecords()}
                rowKey="id"
                pagination={{ pageSize: 20 }}
                border
              />
            </TabPane>
            <TabPane key="corporate" title="对公">
              <Table
                columns={columns}
                data={getFilteredRecords()}
                rowKey="id"
                pagination={{ pageSize: 20 }}
                border
              />
            </TabPane>
            <TabPane key="reader" title="读者">
              <Table
                columns={columns}
                data={getFilteredRecords()}
                rowKey="id"
                pagination={{ pageSize: 20 }}
                border
              />
            </TabPane>
            <TabPane key="sample" title="样报">
              <Table
                columns={columns}
                data={getFilteredRecords()}
                rowKey="id"
                pagination={{ pageSize: 20 }}
                border
              />
            </TabPane>
          </Tabs>
        </Card>
      </Space>
    </div>
  );
}
