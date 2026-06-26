"""Seed the 商学院月刊刊期日历 (bs_issues).

来自 CBJ 小程序在售商品截图（2024–2026）。规律：每年 1月刊 + 2~3月合刊 + 4–12 月刊
（共 11 期）。2026 年 7–12 月刊尚未出刊，标题先留空（结构已知，便于全年订阅展开）。
以后每年加几行；如某年另有合刊/停刊，改这里即可。
"""

from sqlalchemy.orm import Session

from app.models.bs_issue import BsIssue


def _year(year: int, titles: dict) -> list:
    """生成一年的标准刊历：1 / 2~3合刊 / 4..12。titles 按月号（合刊用 2）给标题。"""
    rows = [
        dict(issue_label=f"{year}-01", year=year, month_start=1, month_end=1, title=titles.get(1)),
        dict(issue_label=f"{year}-02~03", year=year, month_start=2, month_end=3, title=titles.get(2)),
    ]
    for m in range(4, 13):
        rows.append(
            dict(issue_label=f"{year}-{m:02d}", year=year, month_start=m, month_end=m, title=titles.get(m))
        )
    return rows


BS_ISSUES = (
    _year(2024, {
        1: '《“高购商”时代的竞争原力》',
        2: '《E-FIRST：韧性企业的“大模型”》',
        4: '《20年商业跃迁与创变》',
        5: '《新质生产力之未来产业》',
        6: '《2024出海新动能》',
        7: '《房市蝶变 从“卖房子”到“卖生活”》',
        8: '《体育商业：从赛场到市场》',
        9: '《新质生产力之数据“新”力量》',
        10: '《投资中国》',
        11: '《投资中国》',
        12: '《激活未来组织》',
    })
    + _year(2025, {
        1: '《低空经济 交通革命》',
        2: '《具身智能与人形机器人》',
        4: '《大模型之争：开源还是闭源？》',
        5: '《打造AI时代的数智链主》',
        6: '《ESG 引领新商业文明》',
        7: '《迎接汽车智能化时代》',
        8: '《AI创新:从黑松客到WAIC》',
        9: '《AI Agent共生未来》',
        10: '《那些创新企业的CXO们》',
        11: '《AI小镇与可持续发展城市》',
        12: '《寻找那些社会价值创新企业》',
    })
    + _year(2026, {
        1: '《AI赋能，乡村新生》',
        2: '《AI+知识产权，迎接新规则时代》',
        4: '《AI硬件：元年已至》',
        5: '《词元经济》',
        6: '《AI时代的组织》',
        # 7–12 月刊尚未出刊，标题留空
    })
)


def seed_bs_issues(db: Session) -> int:
    """Insert the 商学院 issue calendar if empty. Idempotent."""
    if db.query(BsIssue).count() > 0:
        return 0
    count = 0
    for row in BS_ISSUES:
        db.add(BsIssue(**row))
        count += 1
    db.commit()
    return count
