// Shared 报数 category metadata, used by 报数模板 (Templates) and the report editor.
// Keeping it in one place avoids the category maps drifting between pages.

export const categoryLabels: Record<string, string> = {
  postal: '北京邮发',
  retail: '北京报零',
  guangzhou: '广州日报',
  chengdu: '成都杂志铺',
  guotumao: '国图贸',
  social_use: '社用报',
  binding: '合订本',
  other: '其他',
  temp: '临时加印',
};

// Display order for category groups; unknown categories fall after these.
export const categoryOrder = [
  'postal',
  'retail',
  'guangzhou',
  'chengdu',
  'guotumao',
  'social_use',
  'binding',
  'other',
  'temp',
];

// How often each channel reports (shown as a badge on the group header).
// Only defined for the channels with a fixed cadence.
export const categoryFrequency: Record<string, string> = {
  postal: '每周',
  retail: '每周',
  guangzhou: '每周',
  chengdu: '每月',
  guotumao: '每年',
};

export function categoryLabel(category: string): string {
  return categoryLabels[category] || category;
}
