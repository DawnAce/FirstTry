"""Address normalization service using cpca (Chinese Province City Area)."""

import cpca
import re


def _build_district_lookup() -> dict:
    """Build a lookup from district short name to (province, city, district) using cpca's internal data."""
    all_items = {}
    for _code, info in cpca.ad_2_addr_dict.items():
        all_items[info.adcode] = info

    lookup = {}
    for code, info in all_items.items():
        if info.rank != 2:  # only districts/counties
            continue
        city_code = code[:4] + "00"
        province_code = code[:2] + "0000"
        city_info = all_items.get(city_code)
        province_info = all_items.get(province_code)
        if not city_info or not province_info:
            continue

        # Store by short name (without 区/县/市 suffix) for fuzzy matching
        district_name = info.name
        for suffix in ("区", "县", "市", "旗"):
            short = district_name.rstrip(suffix)
            if short != district_name and len(short) >= 2:
                lookup[short] = (province_info.name, city_info.name, district_name)
                break
        # Also store full name
        lookup[district_name] = (province_info.name, city_info.name, district_name)

    return lookup


# Pre-build lookup at module load time
_DISTRICT_LOOKUP = _build_district_lookup()


def normalize_address(address: str) -> dict:
    """Parse a Chinese address and return normalized components.

    Returns dict with keys: province, city, district, address (full normalized).
    Only normalizes the province/city/district prefix; preserves the rest as-is.
    """
    if not address or not address.strip():
        return {"province": None, "city": None, "district": None, "address": address}

    clean = re.sub(r"\s+", " ", address).strip()
    result = cpca.transform([clean])

    province = result.iloc[0]["省"] if result.iloc[0]["省"] else None
    city = result.iloc[0]["市"] if result.iloc[0]["市"] else None
    district = result.iloc[0]["区"] if result.iloc[0]["区"] else None

    # Fix municipality "市辖区" → use province as city
    if city == "市辖区" and province:
        city = province

    # Fallback: if cpca missed city/district, try district lookup
    if not city or not district:
        fb_province, fb_city, fb_district = _fallback_lookup(clean, province)
        if not province and fb_province:
            province = fb_province
        if not city and fb_city:
            city = fb_city
        if not district and fb_district:
            district = fb_district

    # Normalize: rebuild address with full province/city/district prefix
    normalized = _rebuild_address(clean, province, city, district)

    return {
        "province": province,
        "city": _strip_suffix(city, "市") if city else None,
        "district": district,
        "address": normalized,
    }


def _fallback_lookup(
    address: str, known_province: str | None
) -> tuple[str | None, str | None, str | None]:
    """Try to find city/district by matching district names in the address."""
    clean = re.sub(r"\s+", "", address)

    # Strip known province prefix for matching
    if known_province:
        base = known_province.rstrip("省市")
        if clean.startswith(known_province):
            clean = clean[len(known_province):]
        elif clean.startswith(base):
            clean = clean[len(base):]

    # Try matching district names (longer names first to avoid false matches)
    sorted_names = sorted(_DISTRICT_LOOKUP.keys(), key=len, reverse=True)
    for name in sorted_names:
        if clean.startswith(name):
            prov, city, dist = _DISTRICT_LOOKUP[name]
            # Verify province consistency if known
            if known_province and prov != known_province:
                prov_base = known_province.rstrip("省市")
                if not prov.startswith(prov_base):
                    continue
            return prov, city, dist

    return None, None, None


def _rebuild_address(
    address: str,
    province: str | None,
    city: str | None,
    district: str | None,
) -> str:
    """Rebuild address with correct province/city/district prefix.

    Preserves the detail portion of the address (after district) as-is.
    """
    if not province:
        return address

    province_base = province.rstrip("省市")

    # Find where the "detail" part starts by stripping known prefix components
    # Work on the original address to preserve spacing in the detail portion
    rest = address.lstrip()
    prefix_ended = False

    # Strip province
    stripped = _try_strip_prefix(rest, [province, province_base])
    if stripped is not None:
        rest = stripped

    # Handle duplicate municipality
    if province_base in ("北京", "上海", "天津", "重庆"):
        stripped = _try_strip_prefix(rest, [province_base + "市", province_base])
        if stripped is not None:
            rest = stripped

    # Strip city — but be careful with districts starting with "市" (e.g. 青岛市北区 = 青岛 + 市北区)
    if city:
        city_base = city.rstrip("市")
        # If district starts with "市" and city ends with "市", try city_base first
        # to avoid eating the "市" that belongs to the district
        if district and district.startswith("市"):
            stripped = _try_strip_prefix(rest, [city_base])
        else:
            stripped = _try_strip_prefix(rest, [city, city_base + "市", city_base])
        if stripped is not None:
            rest = stripped

    # Strip district
    if district:
        dist_base = district.rstrip("区县市旗")
        stripped = _try_strip_prefix(rest, [district, dist_base + "区", dist_base + "县", dist_base])
        if stripped is not None:
            rest = stripped

    # Rebuild: province + city + district + rest (preserving original spacing)
    parts = [province]
    if city and city != province:
        parts.append(city)
    if district:
        parts.append(district)
    parts.append(rest)

    return "".join(parts)


def _try_strip_prefix(text: str, candidates: list[str]) -> str | None:
    """Try stripping any of the candidate prefixes (with optional leading spaces). Returns remaining text or None."""
    stripped = text.lstrip()
    for prefix in candidates:
        if stripped.startswith(prefix):
            return stripped[len(prefix):].lstrip() if stripped[len(prefix):].startswith(" ") else stripped[len(prefix):]
    return None


def _strip_suffix(text: str, suffix: str) -> str:
    """Remove trailing suffix (e.g. '市') from text."""
    if text and text.endswith(suffix):
        return text[: -len(suffix)]
    return text
