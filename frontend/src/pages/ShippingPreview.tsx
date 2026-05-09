import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Table,
  Tabs,
  Button,
  Tag,
  Space,
  Spin,
  Card,
  message,
} from 'antd';
import {
  ArrowLeftOutlined,
  ReloadOutlined,
  DownloadOutlined,
} from '@ant-design/icons';
import type { TableColumnsType } from 'antd';
import { getIssue } from '../api/issues';
import type { Issue } from '../api/issues';
import { getShipping, regenerateShipping } from '../api/shipping';
import type { ShippingRecord } from '../api/shipping';

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
  const queryClient = useQueryClient();
  const [regenerating, setRegenerating] = useState(false);
  const [activeTab, setActiveTab] = useState('all');

  const issueId = Number(id);

  const { data: issue } = useQuery({
    queryKey: ['issue', id],
    queryFn: async () => {
      const res = await getIssue(issueId);
      return res.data;
    },
    enabled: !!id,
  });

  const { data: shippingRecords = [], isLoading: loading } = useQuery({
    queryKey: ['shipping', id],
    queryFn: async () => {
      const res = await getShipping(issueId);
      return res.data;
    },
    enabled: !!id,
  });

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      const res = await regenerateShipping(issueId);
      queryClient.setQueryData(['shipping', id], res.data);
      message.success('发货明细已重新生成');
    } catch (error) {
      message.error('重新生成失败');
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

  const columns: TableColumnsType<ShippingRecord> = [
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
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28 }}>
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/')}
          style={{ borderRadius: 8 }}
        />
        <h2 style={{
          margin: 0,
          fontSize: 24,
          fontWeight: 700,
          color: '#1d1d1f',
          letterSpacing: '-0.02em',
        }}>
          第 {issue?.issue_number} 期 — 发货明细
        </h2>
      </div>

      {/* Inline Stats + Actions */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 32,
        marginBottom: 24,
        padding: '16px 24px',
        background: '#fff',
        borderRadius: 12,
        boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06)',
      }}>
        <div>
          <div style={{ fontSize: 12, color: '#86868b', fontWeight: 500, marginBottom: 2 }}>收件人</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#1d1d1f' }}>{getTotalRecipients()}</div>
        </div>
        <div style={{ width: 1, height: 36, background: 'rgba(0,0,0,0.06)' }} />
        <div>
          <div style={{ fontSize: 12, color: '#86868b', fontWeight: 500, marginBottom: 2 }}>总份数</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#1d1d1f' }}>{getTotalCopies()}</div>
        </div>
        <div style={{ flex: 1 }} />
        <Space>
          <Button
            type="primary"
            icon={<ReloadOutlined />}
            onClick={handleRegenerate}
            loading={regenerating}
          >
            重新生成
          </Button>
          <Button icon={<DownloadOutlined />} onClick={handleExportFiltered}>
            导出当前
          </Button>
          <Button icon={<DownloadOutlined />} onClick={handleExportAll}>
            导出全部
          </Button>
        </Space>
      </div>

      {/* Tabs with Tables */}
      <Card>
        <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
          { key: 'all', label: '全部', children: (
            <Table
              columns={columns}
              dataSource={getFilteredRecords()}
              rowKey="id"
              pagination={{ pageSize: 20 }}
            />
          )},
          { key: 'corporate', label: '对公', children: (
            <Table
              columns={columns}
              dataSource={getFilteredRecords()}
              rowKey="id"
              pagination={{ pageSize: 20 }}
            />
          )},
          { key: 'reader', label: '读者', children: (
            <Table
              columns={columns}
              dataSource={getFilteredRecords()}
              rowKey="id"
              pagination={{ pageSize: 20 }}
            />
          )},
          { key: 'sample', label: '样报', children: (
            <Table
              columns={columns}
              dataSource={getFilteredRecords()}
              rowKey="id"
              pagination={{ pageSize: 20 }}
            />
          )},
        ]} />
      </Card>
    </div>
  );
}
