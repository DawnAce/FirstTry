import { Button, Card, Checkbox, Form, Input, InputNumber, Select, Space, Switch } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { CoverageRule, ProductCreatePayload } from '../api/products';

export const PUBLICATION_OPTIONS = [
  { label: '中国经营报', value: 'cbj' },
  { label: '商学院', value: 'business_school' },
  { label: '其他', value: 'other' },
];
export const FORMAT_OPTIONS = [
  { label: '纸质', value: 'paper' },
  { label: '电子', value: 'digital' },
];
export const FULFILLMENT_OPTIONS = [
  { label: '订阅', value: 'subscription' },
  { label: '单期', value: 'single_issue' },
  { label: '赠阅', value: 'gift' },
  { label: '补寄', value: 'makeup' },
  { label: '续订', value: 'extension' },
  { label: '换订', value: 'replacement' },
];
export const TERM_OPTIONS = [
  { label: '半年', value: 'half_year' },
  { label: '一年', value: 'one_year' },
  { label: '自定义', value: 'custom' },
];
export const DELIVERY_OPTIONS = [
  { label: '邮局投递', value: 'post_office' },
  { label: 'ZTO-MF 快递', value: 'zto_mf' },
];
export const BILLING_OPTIONS = [
  { label: '付费', value: 'paid' },
  { label: '免费赠阅', value: 'free_gift' },
  { label: '搭赠', value: 'bundle_gift' },
];
export const COVERAGE_RULE_OPTIONS: Array<{ label: string; value: CoverageRule }> = [
  { label: '按起投月算（订阅）', value: 'term_from_month' },
  { label: '最新一期（单期）', value: 'latest_issue' },
  { label: '固定日期', value: 'explicit' },
  { label: '自定义', value: 'custom' },
];

export const COVERAGE_RULE_LABELS: Record<CoverageRule, string> = {
  term_from_month: '按起投月算',
  latest_issue: '最新一期',
  explicit: '固定日期',
  custom: '自定义',
};

/** Auto-suggest a stable product code so operators don't have to invent one
 * (same scheme the import quick-add uses). Editable after it's filled in. */
export function suggestProductCode(): string {
  return 'CBJ-' + Date.now().toString(36).toUpperCase().slice(-6);
}

export interface ProductFormValues {
  code: string;
  display_name: string;
  aliases?: string[];
  is_bundle?: boolean;
  publication?: string | null;
  publication_format?: string;
  fulfillment_type: string;
  subscription_term?: string | null;
  delivery_method?: string | null;
  coverage_rule?: CoverageRule;
  list_price?: number;
  billing_type?: string;
  components?: Array<{ publication: string; delivery_method?: string | null; fixed_price?: number; remainder?: boolean }>;
  active?: boolean;
  notes?: string;
}

export function buildProductPayload(values: ProductFormValues): ProductCreatePayload {
  return {
    code: values.code,
    display_name: values.display_name,
    aliases: values.aliases?.length ? values.aliases : null,
    is_bundle: !!values.is_bundle,
    publication: (values.is_bundle ? null : (values.publication ?? null)) as ProductCreatePayload['publication'],
    publication_format: (values.publication_format ?? 'paper') as ProductCreatePayload['publication_format'],
    fulfillment_type: values.fulfillment_type as ProductCreatePayload['fulfillment_type'],
    subscription_term: (values.subscription_term as ProductCreatePayload['subscription_term']) ?? null,
    delivery_method: (values.is_bundle ? null : (values.delivery_method ?? null)) as ProductCreatePayload['delivery_method'],
    coverage_rule: values.coverage_rule ?? 'term_from_month',
    list_price: values.list_price ?? 0,
    billing_type: (values.billing_type as ProductCreatePayload['billing_type']) ?? 'paid',
    components: values.is_bundle
      ? (values.components ?? []).map((c) => ({
          publication: c.publication as never,
          delivery_method: (c.delivery_method ?? null) as never,
          fixed_price: c.remainder ? null : (c.fixed_price ?? null),
          remainder: !!c.remainder,
        }))
      : null,
    active: values.active ?? true,
    notes: values.notes || null,
  };
}

/** The shared product form fields. Render inside a <Form form={...}>. */
export function ProductFormFields({ editing }: { editing: boolean }) {
  const form = Form.useFormInstance<ProductFormValues>();
  const isBundle = Form.useWatch('is_bundle', form);

  return (
    <>
      <Form.Item name="display_name" label="商品名称（电商原文）" rules={[{ required: true, message: '请填写商品名称' }]}>
        <Input placeholder="如：《中国经营报》全年订阅-618促销活动" />
      </Form.Item>
      <Form.Item name="code" label="商品编码（唯一）" rules={[{ required: true, message: '请填写编码' }]}>
        <Input placeholder="如：CBJ-SUB-1Y-PROMO" disabled={editing} />
      </Form.Item>
      <Form.Item name="aliases" label="别名（活动后缀归一）" tooltip="如「618促销活动」「双十一订阅优惠」">
        <Select mode="tags" placeholder="回车添加" />
      </Form.Item>

      <Form.Item name="is_bundle" label="是否套餐（多刊合售）" valuePropName="checked">
        <Switch />
      </Form.Item>

      <Space style={{ display: 'flex' }} align="start">
        {!isBundle && (
          <Form.Item name="publication" label="刊物" rules={[{ required: true, message: '非套餐必须选刊物' }]} style={{ width: 180 }}>
            <Select options={PUBLICATION_OPTIONS} />
          </Form.Item>
        )}
        <Form.Item name="publication_format" label="版式" style={{ width: 140 }}>
          <Select options={FORMAT_OPTIONS} />
        </Form.Item>
      </Space>

      <Space style={{ display: 'flex' }} align="start">
        <Form.Item name="fulfillment_type" label="履约类型" rules={[{ required: true }]} style={{ width: 180 }}>
          <Select options={FULFILLMENT_OPTIONS} />
        </Form.Item>
        <Form.Item name="subscription_term" label="订阅期限" style={{ width: 140 }}>
          <Select allowClear options={TERM_OPTIONS} />
        </Form.Item>
        {!isBundle && (
          <Form.Item name="delivery_method" label="投递方式（默认）" style={{ width: 180 }}>
            <Select allowClear options={DELIVERY_OPTIONS} />
          </Form.Item>
        )}
      </Space>

      <Space style={{ display: 'flex' }} align="start">
        <Form.Item name="coverage_rule" label="覆盖期算法" style={{ width: 200 }}>
          <Select options={COVERAGE_RULE_OPTIONS} />
        </Form.Item>
        <Form.Item name="list_price" label="参考价（仅对账提示）" style={{ width: 160 }}>
          <InputNumber min={0} style={{ width: '100%' }} prefix="¥" />
        </Form.Item>
        <Form.Item name="billing_type" label="计费" style={{ width: 140 }}>
          <Select options={BILLING_OPTIONS} />
        </Form.Item>
      </Space>

      {isBundle && (
        <Card size="small" title="套餐组件（每刊：投递 + 固定价/拿余额）" style={{ marginBottom: 12 }}>
          <Form.List name="components">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Space key={field.key} align="baseline" style={{ display: 'flex', marginBottom: 4 }} wrap>
                    <Form.Item {...field} name={[field.name, 'publication']} rules={[{ required: true, message: '选刊物' }]}>
                      <Select options={PUBLICATION_OPTIONS} placeholder="刊物" style={{ width: 130 }} />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'delivery_method']} rules={[{ required: true, message: '选投递' }]}>
                      <Select options={DELIVERY_OPTIONS} placeholder="投递方式" style={{ width: 150 }} />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'fixed_price']}>
                      <InputNumber min={0} placeholder="固定价" prefix="¥" style={{ width: 120 }} />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'remainder']} valuePropName="checked">
                      <Checkbox>拿余额</Checkbox>
                    </Form.Item>
                    <Button danger type="link" onClick={() => remove(field.name)}>删</Button>
                  </Space>
                ))}
                <Button type="dashed" onClick={() => add({})} block icon={<PlusOutlined />}>加一个刊物</Button>
              </>
            )}
          </Form.List>
        </Card>
      )}

      <Form.Item name="active" label="状态" valuePropName="checked">
        <Switch checkedChildren="启用" unCheckedChildren="停用" />
      </Form.Item>
      <Form.Item name="notes" label="备注">
        <Input.TextArea rows={2} />
      </Form.Item>
    </>
  );
}
