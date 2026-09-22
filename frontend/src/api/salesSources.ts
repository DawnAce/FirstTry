// salesSourceCatalog.json 由 scripts/generate_sales_sources.py 从后端生成。
import catalog from './salesSourceCatalog.json';

export const SOURCE_PLATFORM_OPTIONS = catalog.map(({ platform }) => ({ label: platform, value: platform }));
export const SOURCE_STORE_OPTIONS = catalog.map(({ platform, store }) => ({ label: store, value: store, platform }));

export function canonicalPlatform(platform?: string | null): string | null {
  const value = platform?.trim();
  if (!value) return null;
  return catalog.find(row => row.platform === value || row.aliases.includes(value))?.platform ?? value;
}

export function normalizeSource(platform?: string | null, store?: string | null) {
  const normalized = canonicalPlatform(platform);
  const rule = catalog.find(row => row.platform === normalized);
  return { platform: normalized, store: store?.trim() || rule?.store || null };
}

export function sourceOptions(values: string[], current?: string | null) {
  const options = Array.from(new Set(values.map(value => canonicalPlatform(value)!)))
    .map(value => ({ label: value, value }));
  if (current && !options.some(option => option.value === current)) {
    options.push({ label: `${canonicalPlatform(current)}（原值：${current}）`, value: current });
  }
  return options;
}
