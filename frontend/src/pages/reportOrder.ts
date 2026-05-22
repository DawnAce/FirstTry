const SOCIAL_USE_REFERENCE_ORDER = [
  '中经传媒智库',
  '新闻中心',
  '行政',
  '财经中心',
  '产经中心',
  '出版中心',
  '品牌中心',
  '经营网',
  '法务',
  '社科院、工经所',
  '财务',
  '库房',
  '上海站用',
  '广东站用',
  '成都站用',
  '西安站用',
];

export function sortVisibleSocialUseEntries<T extends { sub_category: string }>(entries: T[]): T[] {
  const orderMap = new Map(SOCIAL_USE_REFERENCE_ORDER.map((subCategory, index) => [subCategory, index]));
  return [...entries].sort((a, b) => {
    const aOrder = orderMap.get(a.sub_category) ?? Number.MAX_SAFE_INTEGER;
    const bOrder = orderMap.get(b.sub_category) ?? Number.MAX_SAFE_INTEGER;
    return aOrder - bOrder;
  });
}
