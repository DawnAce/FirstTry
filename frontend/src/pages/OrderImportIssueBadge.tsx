import { CalendarOutlined } from '@ant-design/icons';
import type { ImportItemPreview } from '../api/orderImport';

export default function OrderImportIssueBadge({ item }: { item: ImportItemPreview }) {
  if (item.fulfillment_type !== 'single_issue' || !item.issue_number || item.issue_review) return null;

  return <div className="order-import-issue-badge" role="group" aria-label="单期发货期次">
    <CalendarOutlined aria-hidden />
    <strong>第 {item.issue_number} 期</strong>
    {item.issue_publish_date && <>
      <time dateTime={item.issue_publish_date}>{item.issue_publish_date} 出版</time>
      <span className="order-import-issue-badge-source">自动识别</span>
    </>}
  </div>;
}
