import { describe, expect, it } from 'vitest';
import { sortVisibleSocialUseEntries } from './reportOrder';
import { formatIssueReportTitle } from './reportTitle';

describe('formatIssueReportTitle', () => {
  it('includes the annual sequence label when the issue has one', () => {
    expect(
      formatIssueReportTitle({
        issue_number: 2648,
        publish_date: '2026-04-20',
        year_issue_label: '十四',
      }),
    ).toBe('2026年《中国经营报》第2648期 第十四期 报数表');
  });

  describe('sortVisibleSocialUseEntries', () => {
    it('orders only visible social use entries by the reference sheet order', () => {
      const entries = [
        { sub_category: '上海站用' },
        { sub_category: '中经传媒智库' },
        { sub_category: '产经中心' },
        { sub_category: '出版中心' },
        { sub_category: '品牌中心' },
        { sub_category: '广东站用' },
        { sub_category: '库房' },
        { sub_category: '成都站用' },
        { sub_category: '新闻中心' },
        { sub_category: '法务' },
        { sub_category: '社科院、工经所' },
        { sub_category: '经营网' },
        { sub_category: '行政' },
        { sub_category: '西安站用' },
        { sub_category: '财务' },
        { sub_category: '财经中心' },
      ];

      expect(sortVisibleSocialUseEntries(entries).map(entry => entry.sub_category)).toEqual([
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
      ]);
    });
  });

  it('uses the publication year instead of a hardcoded year', () => {
    expect(
      formatIssueReportTitle({
        issue_number: 2700,
        publish_date: '2027-01-04',
        year_issue_label: '一',
      }),
    ).toBe('2027年《中国经营报》第2700期 第一期 报数表');
  });

  it('omits the annual sequence text when the label is unavailable', () => {
    expect(
      formatIssueReportTitle({
        issue_number: 2700,
        publish_date: '2027-01-04',
        year_issue_label: null,
      }),
    ).toBe('2027年《中国经营报》第2700期 报数表');
  });
});
