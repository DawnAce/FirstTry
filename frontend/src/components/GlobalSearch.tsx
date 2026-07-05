import { useEffect, useMemo, useState } from 'react';
import { AutoComplete, Input, Tag, Typography } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { globalSearch } from '../api/search';
import type { SearchHit, SearchHitType } from '../api/search';

const { Text } = Typography;

const TYPE_META: Record<SearchHitType, { label: string; color: string }> = {
  order: { label: '订单', color: 'blue' },
  recipient: { label: '收报人', color: 'green' },
  product: { label: '商品', color: 'purple' },
  issue: { label: '期数', color: 'gold' },
};
const TYPE_ORDER: SearchHitType[] = ['order', 'recipient', 'product', 'issue'];

/** 一条命中 → 跳转目标；无详情路由的（收报人/商品）跳列表页并带上搜索词。 */
function hitTarget(hit: SearchHit): string {
  switch (hit.type) {
    case 'order':
      return `/orders/${hit.id}`;
    case 'issue':
      return `/report/${hit.id}`;
    case 'recipient':
      return `/recipients?tab=recipients&search=${encodeURIComponent(hit.ref ?? hit.title)}`;
    case 'product':
      return `/products?q=${encodeURIComponent(hit.ref ?? hit.title)}`;
    default:
      return '/';
  }
}

/** 顶栏全局搜索：输入即时出分组下拉，点一条直接跳转。 */
export default function GlobalSearch() {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [epoch, setEpoch] = useState(0); // 选中后 remount 清空输入框

  useEffect(() => {
    const t = setTimeout(() => setDebounced(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);

  const { data, isFetching } = useQuery({
    queryKey: ['globalSearch', debounced],
    queryFn: () => globalSearch(debounced).then((r) => r.data.items),
    enabled: debounced.length >= 1,
    staleTime: 15_000,
  });

  const { options, byValue } = useMemo(() => {
    const hits = data ?? [];
    const byValue = new Map<string, SearchHit>();
    const options = TYPE_ORDER.flatMap((type) => {
      const group = hits.filter((h) => h.type === type);
      if (!group.length) return [];
      return [
        {
          label: (
            <span style={{ fontSize: 12, color: '#999' }}>{TYPE_META[type].label}</span>
          ),
          options: group.map((h) => {
            const value = `${h.type}:${h.id}`;
            byValue.set(value, h);
            return {
              value,
              label: (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Tag color={TYPE_META[h.type].color} style={{ marginInlineEnd: 0 }}>
                    {TYPE_META[h.type].label}
                  </Tag>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {h.title}
                    </div>
                    {h.subtitle && (
                      <Text type="secondary" style={{ fontSize: 12 }} ellipsis>
                        {h.subtitle}
                      </Text>
                    )}
                  </div>
                </div>
              ),
            };
          }),
        },
      ];
    });
    return { options, byValue };
  }, [data]);

  return (
    <AutoComplete
      key={epoch}
      className="app-header-search"
      popupMatchSelectWidth={360}
      options={options}
      filterOption={false}
      onSearch={setText}
      onChange={(v) => {
        if (!v) {
          setText('');
          setDebounced('');
        }
      }}
      onSelect={(value) => {
        const hit = byValue.get(value as string);
        if (!hit) return;
        navigate(hitTarget(hit));
        setText('');
        setDebounced('');
        setEpoch((e) => e + 1);
      }}
      notFoundContent={debounced.length >= 1 ? (isFetching ? '搜索中…' : '无匹配') : null}
    >
      <Input allowClear prefix={<SearchOutlined style={{ color: '#bbb' }} />} placeholder="搜索 订单/收报人/商品/期数" />
    </AutoComplete>
  );
}
