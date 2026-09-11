import { useState } from 'react';
import { Button, Select, Space, Tag, Typography } from 'antd';
import { CheckOutlined } from '@ant-design/icons';
import type { ImportIssueOption, ImportIssueReview } from '../api/orderImport';

export default function OrderImportIssueReview({ review, options, value, confirmed, disabled, index, onChange, onConfirm }: {
  review: ImportIssueReview;
  options: ImportIssueOption[];
  value: number | null;
  confirmed: boolean;
  disabled: boolean;
  index: number;
  onChange: (value: number | null) => void;
  onConfirm: (value: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const selected = options.find(option => option.issue_number === value);
  return <div className="order-import-issue-review" data-reviewed={confirmed}
    role="group" aria-label={`第 ${index + 1} 条明细期号核对`} onClick={event => event.stopPropagation()}>
    <div>
      <Tag color={confirmed ? 'green' : 'orange'}>{confirmed ? `已核对：第 ${value} 期` : '期号待核对'}</Tag>
      <Typography.Text type="secondary">{selected ? `${selected.publish_date} 出版` : '请选择实际购买的期号'}</Typography.Text>
    </div>
    <Typography.Text type={confirmed ? 'secondary' : 'warning'}>{confirmed
      ? review.suggested_issue_number == null ? '系统未能判定，已按人工核对结果确认'
        : `自动建议：第 ${review.suggested_issue_number} 期${review.suggested_publish_date ? ` · ${review.suggested_publish_date} 出版` : ''}`
      : review.reason}</Typography.Text>
    <Space wrap>
      {(editing || value == null) && <Select
        aria-label="选择核对期号" className="order-import-issue-select" size="small"
        showSearch={{ optionFilterProp: 'label' }} value={value} placeholder="选择实际期号"
        disabled={disabled || !options.length} onChange={onChange}
        options={options.map(option => ({ value: option.issue_number, label: `第 ${option.issue_number} 期 · ${option.publish_date} 出版` }))}
      />}
      {!confirmed && <Button size="small" type="primary" icon={<CheckOutlined aria-hidden />}
        disabled={disabled || !selected} onClick={() => { if (value != null) { onConfirm(value); setEditing(false); } }}>
        {value == null ? '确认期号' : `确认第 ${value} 期`}
      </Button>}
      {!editing && value != null && <Button size="small" disabled={disabled || !options.length}
        onClick={() => { onChange(value); setEditing(true); }}>修改期号</Button>}
    </Space>
    {!options.length && <Typography.Text type="warning">刊期表没有可选期号，请补齐刊期表后重新预览。</Typography.Text>}
  </div>;
}
