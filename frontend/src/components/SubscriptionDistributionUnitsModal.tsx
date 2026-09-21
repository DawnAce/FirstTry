import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Empty, Flex, Modal, Radio, Select, Space, Spin, Table, Tag, Typography, message } from 'antd';
import type { TableColumnsType } from 'antd';
import { getBatchDeliveryUnits, updateBatchDeliveryUnits } from '../api/subscription';
import type { BatchDeliveryUnit, BatchDeliveryUnits, BatchDeliveryUnitsUpdate } from '../api/subscription';
import { distributionChanges, distributionRequestId } from './subscriptionDistribution';
import type { UnitEdit } from './subscriptionDistribution';

const { Text } = Typography;
const errorText = (error: unknown) => {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === 'string' ? detail : '投递单位处理失败，请重试';
};

interface Props { batchId: number; batchLabel: string; onClose: () => void }

export default function SubscriptionDistributionUnitsModal(props: Props) {
  const q = useQuery({
    queryKey: ['subDistributionUnits', props.batchId, 'initial'],
    queryFn: () => getBatchDeliveryUnits(props.batchId).then((res) => res.data),
    staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
  if (q.data && !q.isFetching && !q.isError) {
    return <DistributionEditor key={q.data.snapshot} {...props} initial={q.data} onReload={() => q.refetch()} />;
  }
  return <Modal open title={`核对投递单位 · ${props.batchLabel}`} onCancel={props.onClose}
    footer={<Button onClick={props.onClose}>关闭</Button>} width={1040}>
    {q.isError ? <Alert type="error" showIcon title={errorText(q.error)}
      action={<Button onClick={() => q.refetch()}>重试</Button>} /> : <Flex justify="center"><Spin description="正在读取本批次投递记录"><div style={{ minHeight: 120 }} /></Spin></Flex>}
  </Modal>;
}

function DistributionEditor({ batchId, batchLabel, onClose, initial, onReload }: Props & {
  initial: BatchDeliveryUnits; onReload: () => void;
}) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Record<number, BatchDeliveryUnit>>({});
  const [scope, setScope] = useState<'selected' | 'all'>('selected');
  const [targetUnit, setTargetUnit] = useState<number>();
  const [allUnit, setAllUnit] = useState<number | null>(null);
  const [edits, setEdits] = useState<Record<number, UnitEdit>>({});
  const [confirmPayload, setConfirmPayload] = useState<BatchDeliveryUnitsUpdate | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const q = useQuery({
    queryKey: ['subDistributionUnits', batchId, initial.snapshot, page],
    queryFn: () => getBatchDeliveryUnits(batchId, page).then((res) => res.data),
    initialData: page === 1 ? initial : undefined,
    staleTime: Infinity, refetchOnWindowFocus: false,
  });
  const stale = conflict || (!!q.data && q.data.snapshot !== initial.snapshot);
  const changes = distributionChanges(initial, allUnit, edits);
  const changedCount = changes.reduce((total, row) => total + row.count, 0);
  const options = [
    ...initial.units.map((unit) => ({ value: unit.id, label: unit.name, disabled: false })),
    ...initial.unit_counts.filter((unit) => unit.id != null && !initial.units.some((active) => active.id === unit.id))
      .map((unit) => ({ value: unit.id as number, label: `${unit.name}（已停用）`, disabled: true })),
  ];
  const save = useMutation({
    mutationFn: (payload: BatchDeliveryUnitsUpdate) => updateBatchDeliveryUnits(batchId, payload),
    onSuccess: async (res) => {
      message.success(`已调整 ${res.data.changed} 条投递记录的投递单位`);
      onClose();
      await Promise.all(['subDistributionUnits', 'postalDeliveries', 'postalDelivery', 'postalReaderLookup',
        'postalRenewals', 'operationLogs', 'dashboard', 'logistics-overview'].map((key) => qc.invalidateQueries({ queryKey: [key] })));
    },
    onError: (error) => {
      setSaveError(errorText(error));
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 409 || status === 422) {
        setConflict(true);
        setConfirmPayload(null);
      }
    },
  });
  const disabled = stale || save.isPending || !!confirmPayload;
  const setUnit = (row: BatchDeliveryUnit, unitId: number | undefined) => {
    setEdits((prev) => {
      const next = { ...prev };
      if (unitId == null || unitId === (allUnit ?? row.distribution_unit_id)) delete next[row.id];
      else next[row.id] = { row, unitId };
      return next;
    });
    setSaveError(null);
  };
  const applyBatch = () => {
    if (targetUnit == null) return;
    if (scope === 'all') {
      setAllUnit(targetUnit);
      setEdits({});
    } else {
      setEdits((prev) => {
        const next = { ...prev };
        Object.values(selected).forEach((row) => {
          if (targetUnit === (allUnit ?? row.distribution_unit_id)) delete next[row.id];
          else next[row.id] = { row, unitId: targetUnit };
        });
        return next;
      });
    }
    setSaveError(null);
  };
  const close = () => { if (changedCount) setDiscardOpen(true); else onClose(); };
  const columns: TableColumnsType<BatchDeliveryUnit> = [
    { title: '编号 / 收报人', key: 'reader', width: 155, render: (_, row) => <Space orientation="vertical" size={0}>
      <Text type="secondary">{row.year}-{row.delivery_no.padStart(4, '0')}</Text><Text>{row.recipient_name}</Text>
    </Space> },
    { title: '地区', key: 'region', render: (_, row) => [row.recipient_province, row.recipient_city, row.recipient_district].filter(Boolean).join(' · ') || '未记录地区' },
    { title: '份数', dataIndex: 'copies', width: 60, align: 'right' },
    { title: '当前投递单位', dataIndex: 'distribution_unit_name', width: 145, render: (name) => name || <Tag color="orange">待补投递单位</Tag> },
    { title: '调整为', key: 'target', width: 205, render: (_, row) => {
      const value = edits[row.id]?.unitId ?? allUnit ?? row.distribution_unit_id;
      return <Select aria-label={`${row.recipient_name}的投递单位`} style={{ width: '100%' }} showSearch
        optionFilterProp="label" options={options} value={value} placeholder="选择投递单位" disabled={disabled}
        onChange={(unitId) => setUnit(row, unitId)} />;
    } },
  ];
  return <>
    <Modal open title={`核对投递单位 · ${batchLabel}`} width={1040} onCancel={close}
      closable={!save.isPending} mask={{ closable: false }} keyboard={!save.isPending}
      footer={<Flex justify="space-between" align="center" wrap gap={8}>
        <Text>待调整 <Text strong>{changedCount}</Text> 条</Text>
        <Space><Button onClick={close} disabled={save.isPending}>保留当前分配</Button>
          <Button type="primary" disabled={disabled || !changedCount || q.isFetching || q.isError} onClick={() => {
            setSaveError(null);
            setConfirmPayload({ request_id: distributionRequestId(), active_version_id: initial.active_version_id,
              snapshot: initial.snapshot, all_distribution_unit_id: allUnit,
              updates: Object.values(edits).map(({ row, unitId }) => ({ delivery_id: row.id, distribution_unit_id: unitId })) });
          }}>保存调整</Button></Space>
      </Flex>}>
      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        <Alert type="info" showIcon title="批次已生效，可以在这里核对和调整投递单位。"
          description="保留当前分配即可结束；以后重新设为有效时，仍按原规则自动分配，并再次打开此窗口。" />
        {stale && <Alert type="warning" showIcon title={saveError || '批次或投递记录已变化，请重新读取后核对。'}
          action={<Button onClick={onReload}>重新读取</Button>} />}
        {!stale && saveError && <Alert type="error" showIcon title={saveError} />}
        <Flex wrap gap={8} align="center"><Text strong>本批次 {initial.total} 条</Text>
          {initial.unit_counts.map((unit) => <Tag key={unit.id ?? 'empty'}>{unit.name} {unit.count} 条</Tag>)}
        </Flex>
        <Flex wrap gap={8} align="center">
          <Radio.Group aria-label="批量调整范围" value={scope} onChange={(e) => setScope(e.target.value)} disabled={disabled}>
            <Radio.Button value="selected">已勾选 {Object.keys(selected).length} 条</Radio.Button>
            <Radio.Button value="all">本批次全部 {initial.total} 条（跨页）</Radio.Button>
          </Radio.Group>
          <Select aria-label="批量投递单位" placeholder="选择投递单位" style={{ width: 190 }} showSearch optionFilterProp="label"
            options={options} value={targetUnit} onChange={setTargetUnit} disabled={disabled} />
          <Button disabled={disabled || targetUnit == null || !initial.total || (scope === 'selected' && !Object.keys(selected).length)} onClick={applyBatch}>应用到待调整列表</Button>
          <Button disabled={disabled || !changedCount} onClick={() => { setAllUnit(null); setEdits({}); }}>撤销调整</Button>
        </Flex>
        {q.isError ? <Alert type="error" showIcon title={errorText(q.error)} action={<Button onClick={() => q.refetch()}>重试本页</Button>} /> :
          <Table<BatchDeliveryUnit> size="small" rowKey="id" columns={columns} dataSource={q.data?.rows ?? []}
            loading={q.isFetching} scroll={{ x: 800, y: 360 }} locale={{ emptyText: <Empty description="本批次暂无有效投递记录" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
            rowSelection={{ selectedRowKeys: Object.keys(selected).map(Number), preserveSelectedRowKeys: true,
              getCheckboxProps: () => ({ disabled }),
              onChange: (keys, rows) => setSelected((prev) => Object.fromEntries(keys.map((key) => [Number(key), rows.find((row) => row?.id === Number(key)) ?? prev[Number(key)]]))),
            }}
            pagination={{ current: page, pageSize: 50, total: initial.total, onChange: setPage, showSizeChanger: false, disabled,
              showTotal: (total) => `共 ${total} 条` }} />}
        {!!changedCount && <Text type="secondary">修改尚未保存。共 {changedCount} 条将变更，点击“保存调整”核对明细后确认。</Text>}
      </Space>
    </Modal>
    <Modal open={!!confirmPayload} title="确认投递单位调整" onCancel={() => { if (!save.isPending) setConfirmPayload(null); }}
      onOk={() => confirmPayload && save.mutate(confirmPayload)} okText={`确认保存 ${changedCount} 条`} confirmLoading={save.isPending}
      cancelButtonProps={{ disabled: save.isPending }} closable={!save.isPending} mask={{ closable: false }} keyboard={!save.isPending}>
      <Space orientation="vertical" style={{ width: '100%' }}>
        <Text>{batchLabel} · 共修改 {changedCount} 条投递记录</Text>
        {saveError && <Alert type="error" showIcon title={saveError} />}
        <Table size="small" rowKey="key" pagination={false} dataSource={changes} columns={[
          { title: '当前单位', dataIndex: 'from' }, { title: '调整为', dataIndex: 'to' },
          { title: '记录数', dataIndex: 'count', align: 'right' },
        ]} />
      </Space>
    </Modal>
    <Modal open={discardOpen} title="放弃尚未保存的调整？" okText="保留当前分配" cancelText="继续调整"
      onOk={onClose} onCancel={() => setDiscardOpen(false)}>
      批次仍然有效，已保存的投递单位保持不变。
    </Modal>
  </>;
}
