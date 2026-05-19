import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Divider,
  Space,
  Typography,
  Upload,
  message,
} from 'antd';
import { InboxOutlined, DownloadOutlined } from '@ant-design/icons';
import type { HistoryImportPreview } from '../api/historyImport';
import {
  downloadReportTemplate,
  downloadShippingTemplate,
  previewHistoryImport,
  commitHistoryImport,
} from '../api/historyImport';

const { Text } = Typography;
const { Dragger } = Upload;

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function HistoryImport() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [reportFile, setReportFile] = useState<File | null>(null);
  const [shippingFile, setShippingFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<HistoryImportPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);

  const handleDownloadReport = async () => {
    try {
      const res = await downloadReportTemplate();
      saveBlob(res.data, '报数导入模板.xlsx');
    } catch {
      message.error('下载失败');
    }
  };

  const handleDownloadShipping = async () => {
    try {
      const res = await downloadShippingTemplate();
      saveBlob(res.data, '中通发货导入模板.xlsx');
    } catch {
      message.error('下载失败');
    }
  };

  const handlePreview = async () => {
    if (!reportFile || !shippingFile) {
      message.warning('请先上传报数文件和发货文件');
      return;
    }
    setPreviewing(true);
    setPreview(null);
    try {
      const res = await previewHistoryImport(reportFile, shippingFile);
      setPreview(res.data);
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } } };
      message.error(err.response?.data?.detail || '预览失败');
    } finally {
      setPreviewing(false);
    }
  };

  const handleCommit = async () => {
    if (!preview?.can_commit) return;
    setCommitting(true);
    try {
      const res = await commitHistoryImport(preview.import_session_id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['issues'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
      message.success(`第 ${res.data.issue_number} 期数据导入成功`);
      navigate(`/report/${res.data.issue_id}`);
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } } };
      message.error(err.response?.data?.detail || '提交失败');
    } finally {
      setCommitting(false);
    }
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
        历史数据导入
      </h1>

      {/* Step 1: Download templates */}
      <Card style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#1d1d1f', marginBottom: 14 }}>
          第一步：下载模板
        </div>
        <Space>
          <Button icon={<DownloadOutlined />} onClick={handleDownloadReport}>
            下载报数导入模板
          </Button>
          <Button icon={<DownloadOutlined />} onClick={handleDownloadShipping}>
            下载中通发货导入模板
          </Button>
        </Space>
      </Card>

      {/* Step 2: Upload files */}
      <Card style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#1d1d1f', marginBottom: 14 }}>
          第二步：上传填写好的文件
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>报数文件</Text>
            <Dragger
              accept=".xlsx,.xls"
              maxCount={1}
              beforeUpload={() => false}
              onChange={({ fileList }) => setReportFile(fileList[0]?.originFileObj ?? null)}
            >
              <p className="ant-upload-drag-icon"><InboxOutlined /></p>
              <p className="ant-upload-text">点击或拖拽上传报数文件</p>
              <p className="ant-upload-hint">.xlsx / .xls</p>
            </Dragger>
          </div>
          <div>
            <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>中通发货文件</Text>
            <Dragger
              accept=".xlsx,.xls"
              maxCount={1}
              beforeUpload={() => false}
              onChange={({ fileList }) => setShippingFile(fileList[0]?.originFileObj ?? null)}
            >
              <p className="ant-upload-drag-icon"><InboxOutlined /></p>
              <p className="ant-upload-text">点击或拖拽上传发货文件</p>
              <p className="ant-upload-hint">.xlsx / .xls</p>
            </Dragger>
          </div>
        </div>
        <div style={{ marginTop: 20 }}>
          <Button type="primary" onClick={handlePreview} loading={previewing}>
            预览导入
          </Button>
        </div>
      </Card>

      {/* Step 3: Preview & commit */}
      {preview && (
        <Card style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#1d1d1f', marginBottom: 14 }}>
            第三步：确认导入内容
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: 16,
            marginBottom: 20,
            padding: '16px 20px',
            background: '#f5f5f7',
            borderRadius: 10,
          }}>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>期号</Text>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#1d1d1f' }}>
                第 {preview.issue_number} 期
              </div>
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>出版日期</Text>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#1d1d1f' }}>
                {preview.publish_date}
              </div>
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>报数条目</Text>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#1d1d1f' }}>
                {preview.report_entry_count}
              </div>
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>临时加印</Text>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#1d1d1f' }}>
                {preview.temp_detail_count}
              </div>
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>发货明细</Text>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#1d1d1f' }}>
                {preview.shipping_detail_count}
              </div>
            </div>
          </div>

          {preview.errors.length > 0 ? (
            <Alert
              type="error"
              message={`发现 ${preview.errors.length} 个错误，请修正后重新上传`}
              description={
                <ul style={{ margin: '8px 0 0 0', paddingLeft: 20 }}>
                  {preview.errors.map((err, i) => <li key={i}>{err}</li>)}
                </ul>
              }
              style={{ marginBottom: 16 }}
            />
          ) : (
            <Alert
              type="success"
              message="数据验证通过，可以提交导入"
              style={{ marginBottom: 16 }}
            />
          )}

          <Divider />

          <Space>
            <Button
              type="primary"
              onClick={handleCommit}
              loading={committing}
              disabled={!preview.can_commit}
            >
              确认导入
            </Button>
            <Button onClick={() => setPreview(null)}>重新上传</Button>
          </Space>
        </Card>
      )}
    </div>
  );
}
