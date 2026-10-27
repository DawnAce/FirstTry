import { CalendarOutlined } from '@ant-design/icons';
import type { ImportItemPreview } from '../api/orderImport';
import { formatImportIssueLabel, isValidImportIssueLabel } from './orderImportDisplay';

export function ImportPeriodBadge({ label, publishDate, status, tone = 'info', ariaLabel = '单期发货期次' }: {
  label: string;
  publishDate?: string | null;
  status?: string;
  tone?: 'info' | 'success' | 'warning';
  ariaLabel?: string;
}) {
  return <div className="order-import-period-badge" data-tone={tone} role="group" aria-label={ariaLabel}>
    <CalendarOutlined aria-hidden />
    <strong>{label}</strong>
    {publishDate && <time dateTime={publishDate}>{publishDate} 出版</time>}
    {status && <span className="order-import-period-status">{status}</span>}
  </div>;
}

export default function OrderImportPeriod({ item, manualNumber, manualLabel }: {
  item: ImportItemPreview;
  manualNumber?: number;
  manualLabel?: string;
}) {
  if (item.fulfillment_type !== 'single_issue') {
    const start = item.coverage_start_date;
    const end = item.coverage_end_date;
    if (item.fulfillment_type !== 'subscription' && !start && !end) return null;
    return <ImportPeriodBadge ariaLabel="订阅起止日期"
      label={`订期：${!start && !end ? '未填写' : `${start || '未填写'} 至 ${end || '未填写'}`}`}
      status={start && end ? '已填写' : start ? '待补结束日期' : end ? '待补起始日期' : '待补订期'}
      tone={start && end ? 'info' : 'warning'} />;
  }
  // 带期号核对的明细由核对区域展示同款信息条，避免重复显示自动建议。
  if (item.issue_review) return null;
  if (manualLabel && !isValidImportIssueLabel(manualLabel)) {
    return <ImportPeriodBadge label="期次格式有误" status="请填写 YYYY-MM 或 YYYY-MM~MM" tone="warning" />;
  }
  const number = manualNumber ?? item.issue_number;
  const label = manualLabel || item.issue_label;
  const manual = manualNumber != null || !!manualLabel;
  if (!number && !label) {
    return <ImportPeriodBadge label={item.publication === 'business_school' ? '期次未填写' : '期号未填写'}
      status="待补充（选填）" tone="warning" />;
  }
  return <ImportPeriodBadge label={label ? formatImportIssueLabel(label) : `第 ${number} 期`}
    publishDate={manual ? null : item.issue_publish_date}
    status={manual ? '人工补录' : item.issue_publish_date || (label && isValidImportIssueLabel(label)) ? '自动识别' : undefined} />;
}
