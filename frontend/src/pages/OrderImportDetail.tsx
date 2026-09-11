import { Alert, Checkbox } from 'antd';
import type { ImportPreviewRow } from '../api/orderImport';
import { deliveryMethodLabel, fulfillmentTypeLabel, publicationLabel } from './orderUtils';
import { formatImportValue, importFieldLabel, importResultCopy, importStatusLabel, snapshotChanges, snapshotFields } from './orderImportDisplay';

type Field = { key: string; value: unknown; label?: string; full?: boolean };

function Fields({ fields }: { fields: Field[] }) {
  return <dl className="order-import-fields">
    {fields.map(field => <div key={field.key} className={`order-import-field${field.full ? ' is-full' : ''}`}>
      <dt className={(field.label?.length ?? 0) > 7 ? 'is-long-label' : undefined}>{field.label ?? importFieldLabel(field.key)}</dt>
      <dd>{formatImportValue(field.key, field.value)}</dd>
    </div>)}
  </dl>;
}

export default function OrderImportDetail({ row, confirmed, onConfirmChange, disabled }: {
  row: ImportPreviewRow;
  confirmed: boolean;
  onConfirmChange: (checked: boolean) => void;
  disabled: boolean;
}) {
  const source = row.source_snapshot;
  const snapshot: Record<string, unknown> = { status_raw: row.status_raw, paid_amount: row.paid_amount, recipient_name: row.recipient_name, ...source };
  const result = importResultCopy(row);
  const changes = row.previous_snapshot && source ? snapshotChanges(row.previous_snapshot, source) : [];
  const canReview = !!row.previous_snapshot && !!source && changes.length > 0;
  const products = Array.isArray(source?.product_lines) ? source.product_lines : [];
  const rawFields = source?.raw_cells ? snapshotFields({ raw_cells: source.raw_cells }) : [];
  const otherFields = source ? snapshotFields(Object.fromEntries(Object.entries(source).filter(([key]) =>
    !['external_order_no', 'status_raw', 'paid_amount', 'recipient_name', 'recipient_phone', 'recipient_address', 'order_date', 'payment_time', 'payment_method',
      'invoice', 'original_amount', 'recipient_postal_code', 'notes', 'product_lines', 'raw_cells', 'filename', 'source_sheet', 'source_row'].includes(key)))) : [];
  const field = (key: string, full = false): Field => ({ key, value: snapshot[key], full });

  return <div className="order-import-detail">
    <Alert showIcon type={row.decision === 'unresolved' || row.decision === 'source_update' ? 'warning' : 'info'}
      title={result.title} description={result.description} />
    {row.status_unknown && <Alert showIcon type="warning" title="平台状态需要人工核对" description="请根据原表确认订单是否付款、发货或退款，再决定如何处理。" />}
    {row.delivery_overridden_to_zto && <Alert showIcon type="warning" title="投递方式已识别为中通，请核对" />}
    {row.warnings.map((warning, index) => <Alert key={index} showIcon type="warning" title={warning} />)}

    {row.decision === 'source_update' && <section aria-label="来源变化核对" className="order-import-detail-section">
      <h3>需要核对的变化 · {changes.length} 项</h3>
      {canReview ? <div className="order-import-changes">
        <div className="order-import-change-heading" aria-hidden="true"><span>项目</span><span>上次保存</span><span>本次导入</span></div>
        {changes.map(change => <div key={change.id} className="order-import-change">
          <div className="order-import-change-label">{change.label}<small>{change.kind}</small></div>
          <div className="order-import-before"><span className="order-import-change-caption">上次保存：</span>{change.before}</div>
          <div className="order-import-after"><span className="order-import-change-caption">本次导入：</span>{change.after}</div>
        </div>)}
      </div> : <Alert type="error" showIcon title="暂时无法展示来源变化，请重新预览后核对" />}
    </section>}

    <section aria-label="交易信息" className="order-import-detail-section">
      <h3>交易信息</h3>
      <Fields fields={[field('status_raw'), field('paid_amount'), field('order_date'), field('payment_method'), field('payment_time', true)]} />
    </section>
    <section aria-label="收件信息" className="order-import-detail-section">
      <h3>收件信息</h3>
      <Fields fields={[field('recipient_name'), field('recipient_phone'), field('recipient_address', true)]} />
    </section>
    {(products.length > 0 || row.items.length > 0) && <section aria-label="商品信息" className="order-import-detail-section">
      <h3>商品信息</h3>
      {products.map((product: unknown, index: number) => {
        const item = product && typeof product === 'object' ? product as Record<string, unknown> : { raw: product };
        return <div key={index} className="order-import-product">
          <strong>{String(item.name || item.raw || `商品 ${index + 1}`)}</strong>
          <span>数量 {formatImportValue('quantity', item.quantity)} · {source?.platform === '淘宝' && Number(item.unit_price) === 0
            ? '原表未提供单价' : `单价 ${formatImportValue('unit_price', item.unit_price)}`}</span>
        </div>;
      })}
      {row.items.length > 0 && <div className="order-import-recognized">
        <h4>识别后的订阅与投递</h4>
        {row.items.map((item, index) => <div className="order-import-product" key={index}>
          <strong>{item.billing_type === 'free_gift' ? '赠品 · ' : ''}{publicationLabel((item.publication ?? 'other') as never)} · {fulfillmentTypeLabel(item.fulfillment_type as never)}
            {item.delivery_method ? ` · ${deliveryMethodLabel(item.delivery_method as never)}` : ''}</strong>
          <span>{item.issue_number ? `第 ${item.issue_number} 期 · ` : ''}{item.issue_label ? `${item.issue_label} · ` : ''}{item.total_quantity} 份 · {formatImportValue('paid_amount', item.subtotal)}</span>
          <span>订期：{!item.coverage_start_date && !item.coverage_end_date ? '未填写' : `${item.coverage_start_date || '未填写'} 至 ${item.coverage_end_date || '未填写'}`}</span>
        </div>)}
      </div>}
    </section>}

    {source ? <>
      <details className="order-import-extra">
        <summary>开票及其他信息</summary>
        <Fields fields={[field('invoice', true), field('original_amount'), field('recipient_postal_code'), field('notes', true)]} />
        <Fields fields={otherFields.map(item => ({ key: item.id, label: item.label, value: item.key === 'commercial_status'
          ? importStatusLabel(row.status_raw, row.commercial_status, row.status_unknown) : formatImportValue(item.key, item.value), full: true }))} />
      </details>
      {rawFields.length > 0 && <details className="order-import-extra">
        <summary>查看原表信息</summary>
        <Fields fields={rawFields.map(item => ({ key: item.id, label: item.label.replace(/^原表 · /, ''), value: formatImportValue(item.key, item.value), full: true }))} />
      </details>}
      <div className="order-import-source">
        <span>来源文件：{formatImportValue('filename', source.filename)}</span>
        <span>工作表：{formatImportValue('source_sheet', source.source_sheet)} · {source.source_row == null ? '行号未记录' : `第 ${source.source_row} 行`}</span>
      </div>
    </> : <Alert type="info" showIcon title="本次预览未提供原表详情" description="如需核对原始内容，请重新预览上传文件。" />}
    {row.decision === 'source_update' && <div className="order-import-confirm">
      <Checkbox checked={confirmed} disabled={disabled || !canReview} onChange={event => onConfirmChange(event.target.checked)}>
        我已核对以上变化，确认保存新版本
      </Checkbox>
      <p>确认整批导入后保存来源记录；主订单的财务、状态和投递仍需另行处理。</p>
    </div>}
  </div>;
}
