import { Alert, Checkbox, Radio, Select, Space } from 'antd';
import type { DeliveryArrangement, DeliveryOptions } from '../api/orderSources';

export default function DeliveryArrangementFields({ options, value, disabled, onChange }: {
  options?: DeliveryOptions | null; value?: DeliveryArrangement; disabled: boolean;
  onChange: (value: DeliveryArrangement) => void;
}) {
  if (!options?.issues.length || !value) return null;
  return <Space orientation="vertical" style={{ width: '100%' }}>
    <Radio.Group aria-label="中通投递范围" value={value.scope} disabled={disabled}
      options={[{ value: 'full_period', label: '整个订期走中通', disabled: !options.full_period_available },
        { value: 'from_issue', label: '中途改走中通' }]}
      onChange={event => onChange({ scope: event.target.value, postal_confirmed: false })} />
    {!options.full_period_available && <span>订期已经开始；已到出刊日的历史保留，请选择后续生效刊期。</span>}
    {value.scope === 'from_issue' ? <Select aria-label="中通起始期号" placeholder="选择从哪一期开始走中通" disabled={disabled}
      value={value.effective_from_issue ?? undefined} style={{ width: '100%' }}
      options={options.issues.map(issue => ({ value: issue.issue_number, label: `第 ${issue.issue_number} 期 · ${issue.publish_date}` }))}
      onChange={number => onChange({ ...value, effective_from_issue: number, expected_state: undefined, postal_confirmed: false })} />
      : <span>从第 {options.full_period_issue} 期起至订阅结束，全部走中通。</span>}
    {value.scope === 'from_issue' && value.effective_from_issue && <span>第 {value.effective_from_issue} 期之前保留邮局，从该期起走中通；原订期与份数保持原记录。</span>}
    <Checkbox disabled={disabled} checked={value.postal_confirmed}
      onChange={event => onChange({ ...value, postal_confirmed: event.target.checked })}>已核对投递范围及邮局实际安排</Checkbox>
    <Alert type="info" showIcon title="确认后同时保存运费关联和投递安排，中通仍通过按期排发生成发货明细。" />
  </Space>;
}
