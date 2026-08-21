export interface SocialDistributionEntry {
  category: string;
  sub_category: string;
  value: number;
}

export const SOCIAL_DISTRIBUTION_ITEMS = [
  { subCategory: '营报传媒_收发室', label: '营报传媒（收发室）' },
  { subCategory: '中经传媒智库', label: '中经传媒智库' },
  { subCategory: '新闻中心', label: '新闻中心' },
  { subCategory: '行政', label: '行政' },
  { subCategory: '财经中心', label: '财经中心' },
  { subCategory: '产经中心', label: '产经中心' },
  { subCategory: '出版中心', label: '出版中心' },
  { subCategory: '品牌中心', label: '品牌中心' },
  { subCategory: '经营网', label: '经营网' },
  { subCategory: '法务', label: '法务' },
  { subCategory: '社科院、工经所', label: '社科院、工经所' },
  { subCategory: '财务', label: '财务' },
  { subCategory: '库房', label: '库房' },
] as const;

const socialDistributionSubCategories = new Set<string>(
  SOCIAL_DISTRIBUTION_ITEMS.map(item => item.subCategory),
);

export function calculateSocialDistributionTotal(
  entries: SocialDistributionEntry[],
  tempSelfValue: number,
): number {
  return entries.reduce((total, entry) => (
    entry.category === 'social_use' && socialDistributionSubCategories.has(entry.sub_category)
      ? total + entry.value
      : total
  ), tempSelfValue);
}
