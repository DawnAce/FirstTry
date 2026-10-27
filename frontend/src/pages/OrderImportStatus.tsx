import { Tag } from 'antd';
import type { ImportPreviewRow } from '../api/orderImport';
import { importStatusLabel } from './orderImportDisplay';

export default function OrderImportStatus({ row }: {
  row: Pick<ImportPreviewRow, 'status_raw' | 'commercial_status' | 'status_unknown'>;
}) {
  const color = row.status_unknown ? 'orange' : row.commercial_status === 'refunded' ? 'red'
    : row.commercial_status === 'partial_refund' ? 'orange' : undefined;
  const label = importStatusLabel(row.status_raw, row.commercial_status, row.status_unknown);
  return <span aria-label="交易状态" className="order-import-status">{color ? <Tag color={color}>{label}</Tag> : label}</span>;
}
