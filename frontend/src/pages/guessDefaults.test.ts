import { describe, expect, it } from 'vitest';
import { guessDefaults } from './OrderImport';

describe('guessDefaults — publication 刊物推断', () => {
  it('含「中国经营报」的商品仍判为 cbj', () => {
    for (const name of [
      '《中国经营报》全年订阅-618促销活动',
      '《中国经营报》全年订阅（邮局周投）',
      '《中国经营报》半年订阅（中通 周送）',
      '《中国经营报》最新一期订阅',
      '《中国经营报》单期 往期零售',
      '《中国经营报》和《商学院》全年订阅（8折优惠）', // 双刊套餐：名里含中国经营报 → cbj
    ]) {
      expect(guessDefaults(name).publication).toBe('cbj');
    }
  });

  it('独立《商学院》全年订阅判为 business_school', () => {
    expect(guessDefaults('《商学院》全年订阅').publication).toBe('business_school');
  });

  it('商学院月刊单期标题（名里不含「商学院」）按「N月刊 / N月合刊」判为 business_school 且单期', () => {
    for (const name of [
      '2026年1月刊《AI赋能，乡村新生》',
      '2026年4月刊《AI硬件：元年已至》',
      '2026年2~3月合刊《AI+知识产权，迎接新规则时代》',
    ]) {
      const d = guessDefaults(name);
      expect(d.publication).toBe('business_school');
      expect(d.fulfillment_type).toBe('single_issue');
    }
  });
});

describe('guessDefaults — 投递与期限', () => {
  it('投递从名字读：含「中通」→ zto_mf，否则邮局', () => {
    expect(guessDefaults('《中国经营报》全年订阅（中通 周送）').delivery_method).toBe('zto_mf');
    expect(guessDefaults('《中国经营报》全年订阅（邮局周投）').delivery_method).toBe('post_office');
  });

  it('期限从名字读：全年 → one_year，半年 → half_year', () => {
    expect(guessDefaults('《中国经营报》全年订阅（邮局周投）').subscription_term).toBe('one_year');
    expect(guessDefaults('《中国经营报》半年订阅（邮局周投）').subscription_term).toBe('half_year');
  });
});
