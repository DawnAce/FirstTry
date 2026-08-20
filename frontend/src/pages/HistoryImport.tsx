import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Divider,
  Input,
  InputNumber,
  Select,
  Space,
  Typography,
  Upload,
  message,
} from 'antd';
import { DownloadOutlined, FileExcelOutlined, InboxOutlined } from '@ant-design/icons';
import type {
  HistoryImportPreview,
  ManualReportMappingDraft,
  TempPrintDetailDraft,
} from '../api/historyImport';
import {
  downloadReportTemplate,
  downloadShippingTemplate,
  previewHistoryImport,
  commitHistoryImport,
} from '../api/historyImport';
import { PageHeader } from '../components/UiPrimitives';
import { categoryLabel } from './reportCategories';

const { Text } = Typography;
const { Dragger } = Upload;

const DEPARTMENT_OPTIONS = [
  { label: '营报传媒', value: '营报传媒' },
  { label: '财经中心', value: '财经中心' },
  { label: '中经未来', value: '中经未来' },
  { label: '产经中心', value: '产经中心' },
  { label: '其他', value: '其他' },
];

const reportMappingKey = (category: string, subCategory: string) =>
  JSON.stringify([category, subCategory]);

const parseReportMappingKey = (value: string): [string, string] =>
  JSON.parse(value) as [string, string];

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
  const [reportPassword, setReportPassword] = useState('');
  const [preview, setPreview] = useState<HistoryImportPreview | null>(null);
  const [manualTempRows, setManualTempRows] = useState<TempPrintDetailDraft[]>([]);
  const [manualReportMappings, setManualReportMappings] = useState<Record<string, string>>({});
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);

  const handleDownloadReport = async () => {
    try {
      const res = await downloadReportTemplate();
      saveBlob(res.data, '印数导入模板.xlsx');
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
      message.warning('请先上传印数文件和发货文件');
      return;
    }
    setPreviewing(true);
    setPreview(null);
    setManualTempRows([]);
    setManualReportMappings({});
    try {
      const res = await previewHistoryImport(reportFile, shippingFile, reportPassword);
      setPreview(res.data);
      setManualTempRows(
        res.data.manual_temp_print_required_quantity > 0
          ? (
              res.data.manual_temp_rows.length > 0
                ? res.data.manual_temp_rows
                : [{
                    department: '营报传媒',
                    custom_name: null,
                    quantity: res.data.manual_temp_print_required_quantity,
                    self_quantity: res.data.manual_temp_print_self_quantity,
                  }]
            )
          : [],
      );
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } } };
      message.error(err.response?.data?.detail || '预览失败');
    } finally {
      setPreviewing(false);
    }
  };

  const manualTempTotal = manualTempRows.reduce((sum, row) => sum + row.quantity, 0);
  const manualTempSelfTotal = manualTempRows.reduce((sum, row) => sum + row.self_quantity, 0);
  const manualTempRequired = preview?.manual_temp_print_required_quantity ?? 0;
  const manualTempValid = manualTempRequired === 0 || manualTempTotal === manualTempRequired;
  const unmappedReportItems = preview?.unmapped_report_items ?? [];
  const manualReportMappingsValid = unmappedReportItems.every(
    (item) => Boolean(manualReportMappings[item.item_id]),
  );
  const manuallyMappedTotal = unmappedReportItems.reduce(
    (sum, item) => sum + (manualReportMappings[item.item_id] ? item.value : 0),
    0,
  );
  const projectedReportTotal = (preview?.mapped_total ?? 0) + manuallyMappedTotal;
  const reportTotalValid = !preview || preview.source_total === 0 || projectedReportTotal === preview.source_total;

  const handleAddManualTempRow = () => {
    setManualTempRows([
      ...manualTempRows,
      { department: '营报传媒', custom_name: null, quantity: 0, self_quantity: 0 },
    ]);
  };

  const handleManualTempChange = (
    index: number,
    field: keyof TempPrintDetailDraft,
    value: string | number | null,
  ) => {
    setManualTempRows((rows) => rows.map((row, rowIndex) => {
      if (rowIndex !== index) return row;
      const next = { ...row, [field]: value };
      if (field === 'department' && value !== '其他') {
        next.custom_name = null;
      }
      if (field === 'quantity' && next.self_quantity > Number(value ?? 0)) {
        next.self_quantity = Number(value ?? 0);
      }
      return next;
    }));
  };

  const handleRemoveManualTempRow = (index: number) => {
    setManualTempRows(manualTempRows.filter((_, rowIndex) => rowIndex !== index));
  };

  const buildManualReportMappings = (): ManualReportMappingDraft[] =>
    unmappedReportItems.map((item) => {
      const [category, subCategory] = parseReportMappingKey(manualReportMappings[item.item_id]);
      return {
        item_id: item.item_id,
        category,
        sub_category: subCategory,
      };
    });

  const handleCommit = async () => {
    if (
      !preview
      || !preview.readiness.can_commit
      || !manualTempValid
      || !manualReportMappingsValid
      || !reportTotalValid
    ) return;
    setCommitting(true);
    try {
      const res = await commitHistoryImport(
        preview.import_session_id,
        preview.manual_temp_print_required_quantity > 0 ? manualTempRows : undefined,
        unmappedReportItems.length > 0 ? buildManualReportMappings() : undefined,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['issues'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['publication-schedule'] }),
        queryClient.invalidateQueries({ queryKey: ['publication-schedules'] }),
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
      <PageHeader title="往期印数导入" description="使用统一模板补录历史印数与中通发货数据" />

      {/* Step 1: Download templates */}
      <Card style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 14 }}>
          第一步：下载模板
        </div>
        <Space>
          <Button icon={<DownloadOutlined />} onClick={handleDownloadReport}>
            下载印数导入模板
          </Button>
          <Button icon={<DownloadOutlined />} onClick={handleDownloadShipping}>
            下载中通发货导入模板
          </Button>
        </Space>
      </Card>

      {/* Step 2: Upload files */}
      <Card style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 14 }}>
          第二步：上传填写好的文件
        </div>
        <div className="history-import-upload-grid">
          <div>
            <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>印数文件</Text>
            <Dragger
              className="history-import-dragger"
              accept=".xlsx"
              maxCount={1}
              showUploadList={false}
              beforeUpload={() => false}
              onChange={({ fileList }) => {
                setReportFile(fileList[0]?.originFileObj ?? null);
                setPreview(null);
              }}
            >
              {reportFile ? (
                <div className="history-import-selected-file">
                  <FileExcelOutlined className="history-import-selected-file-icon" />
                  <div className="history-import-selected-file-name" title={reportFile.name}>
                    {reportFile.name}
                  </div>
                  <div className="history-import-selected-file-action">点击或拖拽文件可重新选择</div>
                </div>
              ) : (
                <>
                  <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                  <p className="ant-upload-text">点击或拖拽上传印数文件</p>
                  <p className="ant-upload-hint">.xlsx</p>
                </>
              )}
            </Dragger>
            <Input.Password
              allowClear
              placeholder="如印数文件有密码，请在这里输入"
              name="history_import_workbook_decryption_key"
              autoComplete="new-password"
              value={reportPassword}
              onChange={(event) => {
                setReportPassword(event.target.value);
                setPreview(null);
              }}
              style={{ marginTop: 12 }}
            />
            <Text type="secondary" style={{ display: 'block', marginTop: 6, fontSize: 12 }}>
              密码只用于本次上传解密，不会保存。
            </Text>
          </div>
          <div>
            <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>中通发货文件</Text>
            <Dragger
              className="history-import-dragger"
              accept=".xlsx"
              maxCount={1}
              showUploadList={false}
              beforeUpload={() => false}
              onChange={({ fileList }) => {
                setShippingFile(fileList[0]?.originFileObj ?? null);
                setPreview(null);
              }}
            >
              {shippingFile ? (
                <div className="history-import-selected-file">
                  <FileExcelOutlined className="history-import-selected-file-icon" />
                  <div className="history-import-selected-file-name" title={shippingFile.name}>
                    {shippingFile.name}
                  </div>
                  <div className="history-import-selected-file-action">点击或拖拽文件可重新选择</div>
                </div>
              ) : (
                <>
                  <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                  <p className="ant-upload-text">点击或拖拽上传发货文件</p>
                  <p className="ant-upload-hint">.xlsx</p>
                </>
              )}
            </Dragger>
          </div>
        </div>
        <div className="history-import-preview-action">
          <Button type="primary" onClick={handlePreview} loading={previewing}>
            预览导入
          </Button>
        </div>
      </Card>

      {/* Step 3: Preview & commit */}
      {preview && (
        <Card style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 14 }}>
            第三步：确认导入内容
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(6, 1fr)',
            gap: 16,
            marginBottom: 20,
            padding: '16px 20px',
            background: 'var(--color-bg)',
            borderRadius: 'var(--radius-card)',
          }}>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>期号</Text>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                第 {preview.issue_number} 期
              </div>
              {preview.shipping_issue_source && (
                <Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 12 }}>
                  发货期号来源：{preview.shipping_issue_source}
                </Text>
              )}
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>出版日期</Text>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                {preview.publish_date}
              </div>
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>版数</Text>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                {preview.page_count} 版
              </div>
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>报数条目</Text>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                {preview.report_entry_count}
              </div>
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>临时加印</Text>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                {preview.temp_detail_count}
              </div>
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>发货明细</Text>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                {preview.shipping_detail_count}
              </div>
            </div>
          </div>

          {preview.report_rows.length > 0 && (
            <div className="history-import-data-section">
              <div className="history-import-data-section-header">
                <div>
                  <div className="history-import-data-section-title">已识别的报数数据</div>
                  <Text type="secondary">以下为系统从印数文件中实际读取并完成归类的数据</Text>
                </div>
                <Text strong>已识别合计：{preview.mapped_total} 份</Text>
              </div>
              <div className="history-import-data-table-wrap">
                <table className="history-import-data-table">
                  <thead>
                    <tr>
                      <th>系统报数项</th>
                      <th>分类</th>
                      <th>去向</th>
                      <th className="history-import-number-cell">份数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.report_rows.map((row) => (
                      <tr key={`${row.category}:${row.sub_category}`}>
                        <td>{row.display_name || row.sub_category}</td>
                        <td>{categoryLabel(row.category)}</td>
                        <td>{row.destination || '-'}</td>
                        <td className="history-import-number-cell">{row.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {unmappedReportItems.length > 0 && (
            <Alert
              type={manualReportMappingsValid && reportTotalValid ? 'warning' : 'error'}
              showIcon
              title={`有 ${unmappedReportItems.length} 个项目需要手动归类`}
              description={
                <div>
                  <div style={{ marginBottom: 12 }}>
                    系统保留了原始位置和数量。请选择对应的系统报数项，全部归类且总数对平后即可导入。
                  </div>
                  <div className="history-import-data-table-wrap history-import-mapping-table-wrap">
                    <table className="history-import-data-table">
                      <thead>
                        <tr>
                          <th>来源</th>
                          <th>原始项目</th>
                          <th className="history-import-number-cell">份数</th>
                          <th>归类到</th>
                        </tr>
                      </thead>
                      <tbody>
                        {unmappedReportItems.map((item) => (
                          <tr key={item.item_id}>
                            <td>{item.sheet_name} · {item.cell_reference}</td>
                            <td>{item.source_label}</td>
                            <td className="history-import-number-cell">{item.value}</td>
                            <td>
                              <Select
                                showSearch
                                optionFilterProp="label"
                                placeholder="选择系统报数项"
                                value={manualReportMappings[item.item_id]}
                                options={preview.report_mapping_options.map((option) => ({
                                  label: option.display_name || option.sub_category,
                                  value: reportMappingKey(option.category, option.sub_category),
                                }))}
                                onChange={(value) => setManualReportMappings((current) => ({
                                  ...current,
                                  [item.item_id]: value,
                                }))}
                                style={{ width: '100%', minWidth: 220 }}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className={reportTotalValid ? 'history-import-total-ok' : 'history-import-total-error'}>
                    原表总印数 {preview.source_total} 份；当前归类后合计 {projectedReportTotal} 份
                  </div>
                </div>
              }
              style={{ marginBottom: 16 }}
            />
          )}

          {preview.warnings && preview.warnings.length > 0 && (
            <Alert
              type="warning"
              showIcon
              title="导入注意事项"
              description={
                <ul style={{ margin: '4px 0 0 0', paddingLeft: 20 }}>
                  {preview.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              }
              style={{ marginBottom: 16 }}
            />
          )}

          {manualTempRequired > 0 && (
            <Alert
              type={manualTempValid ? 'warning' : 'error'}
              title={`临时加印需要手动分配：共 ${manualTempRequired} 份`}
              description={
                <div>
                  <div style={{ marginBottom: 12 }}>
                    已分配 {manualTempTotal} 份，自留 {manualTempSelfTotal} 份，快递 {manualTempTotal - manualTempSelfTotal} 份。
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', padding: 6 }}>部门</th>
                        <th style={{ textAlign: 'right', padding: 6 }}>份数</th>
                        <th style={{ textAlign: 'right', padding: 6 }}>自留</th>
                        <th style={{ textAlign: 'right', padding: 6 }}>快递</th>
                        <th style={{ textAlign: 'center', padding: 6 }}>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {manualTempRows.map((row, index) => (
                        <tr key={index}>
                          <td style={{ padding: 6 }}>
                            <Space size="small">
                              <Select
                                size="small"
                                value={row.department}
                                options={DEPARTMENT_OPTIONS}
                                onChange={(value) => handleManualTempChange(index, 'department', value)}
                                style={{ width: 110 }}
                              />
                              {row.department === '其他' && (
                                <Input
                                  size="small"
                                  placeholder="名称"
                                  value={row.custom_name ?? ''}
                                  onChange={(event) => handleManualTempChange(index, 'custom_name', event.target.value)}
                                  style={{ width: 120 }}
                                />
                              )}
                            </Space>
                          </td>
                          <td style={{ padding: 6, textAlign: 'right' }}>
                            <InputNumber
                              size="small"
                              value={row.quantity}
                              min={0}
                              precision={0}
                              onChange={(value) => handleManualTempChange(index, 'quantity', value ?? 0)}
                              style={{ width: 90 }}
                            />
                          </td>
                          <td style={{ padding: 6, textAlign: 'right' }}>
                            <InputNumber
                              size="small"
                              value={row.self_quantity}
                              min={0}
                              max={row.quantity}
                              precision={0}
                              onChange={(value) => handleManualTempChange(index, 'self_quantity', value ?? 0)}
                              style={{ width: 90 }}
                            />
                          </td>
                          <td style={{ padding: 6, textAlign: 'right' }}>{row.quantity - row.self_quantity}</td>
                          <td style={{ padding: 6, textAlign: 'center' }}>
                            <Button size="small" danger onClick={() => handleRemoveManualTempRow(index)}>删除</Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <Button size="small" style={{ marginTop: 8 }} onClick={handleAddManualTempRow}>添加一行</Button>
                </div>
              }
              style={{ marginBottom: 16 }}
            />
          )}

          {preview.errors.length > 0 ? (
            <Alert
              type="error"
              title={`发现 ${preview.errors.length} 个错误，请修正后重新上传`}
              description={
                <ul style={{ margin: '8px 0 0 0', paddingLeft: 20 }}>
                  {preview.errors.map((err, i) => <li key={i}>{err}</li>)}
                </ul>
              }
              style={{ marginBottom: 16 }}
            />
          ) : manualTempRequired === 0 && unmappedReportItems.length === 0 ? (
            <Alert
              type="success"
              title="数据验证通过，可以提交导入"
              style={{ marginBottom: 16 }}
            />
          ) : null}

          <Divider />

          <Space>
            <Button
              type="primary"
              onClick={handleCommit}
              loading={committing}
              disabled={
                !preview.readiness.can_commit
                || !manualTempValid
                || !manualReportMappingsValid
                || !reportTotalValid
              }
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
