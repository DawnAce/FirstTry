import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Descriptions, Modal, Select, Space, Spin, Typography } from 'antd';
import { appendProductAlias, listProducts, productQueryKeys } from '../api/products';
import { getApiErrorMessage } from '../api/errorMessage';
import { deliveryMethodLabel, fulfillmentTypeLabel, publicationLabel, subscriptionTermLabel } from './orderUtils';

interface Props {
  alias: string;
  orderCount: number;
  onClose: () => void;
  onLinked: () => void;
  onCreate: () => void;
}

export default function LinkProductAliasModal({ alias, orderCount, onClose, onLinked, onCreate }: Props) {
  const queryClient = useQueryClient();
  const [productId, setProductId] = useState<number>();
  const products = useQuery({
    queryKey: productQueryKeys.list({ active: true }),
    queryFn: async () => (await listProducts({ active: true })).data,
  });
  const selected = products.data?.find(product => product.id === productId);
  const save = useMutation({
    mutationFn: () => appendProductAlias(productId!, alias),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: productQueryKeys.all });
      onLinked();
    },
  });

  return <Modal open title="关联已有商品" width={660} onCancel={() => { if (!save.isPending) onClose(); }}
    mask={{ closable: !save.isPending }}
    footer={<Space wrap>
      <Button onClick={onCreate} disabled={save.isPending}>改为新增商品</Button>
      <Button onClick={onClose} disabled={save.isPending}>取消</Button>
      <Button type="primary" disabled={!selected || products.isError} loading={save.isPending} onClick={() => save.mutate()}>保存别名并重新识别</Button>
    </Space>}>
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <div><Typography.Text type="secondary">待识别名称 · 涉及 {orderCount} 单</Typography.Text><div><Typography.Text strong>{alias}</Typography.Text></div></div>
      <Alert type="info" showIcon title="同一商品的促销名称，可以作为别名关联"
        description="选择刊物、订阅期限和投递方式相符的商品。保存后本次及以后同名订单按它识别，导入金额仍取 Excel 实际成交价。" />
      {products.isError ? <Alert type="error" showIcon title={getApiErrorMessage(products.error, '读取商品失败')}
        action={<Button onClick={() => void products.refetch()}>重试</Button>} /> : <>
        <label htmlFor="alias-product">选择已有商品</label>
        <Select id="alias-product" aria-label="选择已有商品" placeholder="搜索商品名称或编码，如 CBJ-1Y-PROMO" style={{ width: '100%' }}
          showSearch={{ optionFilterProp: 'label' }} allowClear value={productId} disabled={save.isPending} loading={products.isFetching}
          onChange={value => { setProductId(value); save.reset(); }}
          notFoundContent={products.isLoading ? <Spin size="small" /> : '没有符合的启用商品'}
          options={(products.data ?? []).map(product => ({ value: product.id, label: `${product.display_name}（${product.code}）` }))} />
      </>}
      {selected && <Descriptions size="small" bordered column={1} items={[
        { key: 'product', label: '将关联到', children: `${selected.display_name}（${selected.code}）` },
        { key: 'publication', label: '刊物 / 类型', children: `${selected.is_bundle ? '多刊套餐' : publicationLabel(selected.publication ?? 'other')} / ${fulfillmentTypeLabel(selected.fulfillment_type)}` },
        { key: 'term', label: '期限 / 投递', children: `${selected.subscription_term ? subscriptionTermLabel(selected.subscription_term) : '未指定'} / ${selected.delivery_method ? deliveryMethodLabel(selected.delivery_method) : selected.is_bundle ? '按套餐组件' : '未指定'}` },
        { key: 'price', label: '商品参考价', children: `¥${selected.list_price}；订单保留实际成交金额` },
      ]} />}
      {selected?.is_bundle && <Alert type="warning" showIcon title="此商品为套餐，导入时会拆成多条明细" description={
        (selected.components ?? []).map(component => `${publicationLabel(component.publication)}：${component.remainder ? '分配剩余成交金额' : `分配 ¥${component.fixed_price ?? 0}`}`).join('；')
      } />}
      {save.isError && <Alert type="error" showIcon title={getApiErrorMessage(save.error, '保存关联失败')} />}
    </Space>
  </Modal>;
}
