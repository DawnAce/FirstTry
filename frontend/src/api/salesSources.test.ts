import { describe, expect, it } from 'vitest';
import { canonicalPlatform, normalizeSource, sourceOptions, SOURCE_PLATFORM_OPTIONS } from './salesSources';

describe('销售来源统一口径', () => {
  it('标准平台只有三个，CBJ 导入旧值能回填必填店铺', () => {
    expect(SOURCE_PLATFORM_OPTIONS.map(option => option.value)).toEqual(['微信小程序', '淘宝', '有赞']);
    expect(normalizeSource('CBJ小程序', null)).toEqual({ platform: '微信小程序', store: 'CBJ+' });
    expect(normalizeSource('淘宝', null)).toEqual({ platform: '淘宝', store: '中国经营报发行部' });
  });
  it('已知别名归并，历史业务渠道与未知店铺保留', () => {
    expect(sourceOptions(['CBJ+', 'CBJ+小程序', '微信小程序'])).toEqual([{ label: '微信小程序', value: '微信小程序' }]);
    expect(canonicalPlatform('商学院有赞')).toBe('商学院有赞');
    expect(canonicalPlatform('对公转账')).toBe('对公转账');
    expect(normalizeSource('微信小程序', '历史专属店铺').store).toBe('历史专属店铺');
    expect(sourceOptions(['微信小程序'], 'CBJ+小程序')[1].value).toBe('CBJ+小程序');
  });
});
