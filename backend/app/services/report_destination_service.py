DESTINATION_POSTAL = "北京市报刊发行局"
DESTINATION_RETAIL = "北京市报刊零售公司"
DESTINATION_PRINT_FACTORY = "印厂"
DESTINATION_ZTO = "中通物流公司"

_CATEGORY_DESTINATIONS = {
    "postal": DESTINATION_POSTAL,
    "retail": DESTINATION_RETAIL,
    "binding": DESTINATION_PRINT_FACTORY,
}


def resolve_report_destination(
    category: str,
    sub_category: str | None = None,
    destination: str | None = None,
) -> str:
    if destination:
        return destination
    if sub_category and "合订本" in sub_category:
        return DESTINATION_PRINT_FACTORY
    return _CATEGORY_DESTINATIONS.get(category, DESTINATION_ZTO)
