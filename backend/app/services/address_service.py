"""Address normalization service using cpca (Chinese Province City Area)."""

import cpca
import re


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

    # Normalize: only fix the province/city prefix, keep the rest of the address intact
    normalized = _normalize_prefix(clean, province)

    return {
        "province": province,
        "city": _strip_suffix(city, "市") if city else None,
        "district": district,
        "address": normalized,
    }


def _normalize_prefix(address: str, province: str | None) -> str:
    """Ensure the address starts with the correct province prefix."""
    if not province:
        return address

    province_base = province.rstrip("省市")
    # Remove leading spaces in the province/city/district prefix area only
    # Match the structured prefix part (省 市 区 with optional spaces)
    addr = address

    # Handle duplicate municipality: "北京 北京市" or "上海市上海市"
    if province_base in ("北京", "上海", "天津", "重庆"):
        # "北京 北京市 朝阳区 ..." → "北京市朝阳区 ..."
        m = re.match(
            rf"^{re.escape(province_base)}\s+{re.escape(province_base)}市\s*",
            addr,
        )
        if m:
            rest = addr[m.end():]
            return province_base + "市" + rest

        # "上海市上海市闵行区..." → "上海市闵行区..."
        dup = province_base + "市" + province_base + "市"
        if addr.replace(" ", "").startswith(dup):
            addr_no_space = addr.replace(" ", "")
            return province_base + "市" + addr_no_space[len(dup):]

    # Remove spaces only in the structured prefix (省/市/区 part)
    # Match: optional_province optional_city optional_district
    m = re.match(
        r"^(\S{2,4}(?:省|市|自治区))?\s*(\S{2,5}(?:市|地区|州|盟))?\s*"
        r"(\S{2,5}(?:区|县|旗|市))?\s*(\S{2,5}(?:街道|镇|乡))?\s*",
        addr,
    )
    if m and m.group(0).strip():
        prefix = "".join(g for g in m.groups() if g)
        rest = addr[m.end():]
        addr = prefix + rest

    # Now check if province is present
    addr_check = addr.replace(" ", "")[:len(province) + 10]

    if addr_check.startswith(province):
        return addr
    elif addr_check.startswith(province_base) and not addr_check.startswith(province):
        # "湖北武汉市..." → "湖北省武汉市..."
        idx = addr.index(province_base) + len(province_base)
        return province + addr[idx:]
    elif province_base in ("北京", "上海", "天津", "重庆"):
        if addr_check.startswith(province_base):
            # "北京西城区..." → "北京市西城区..."
            idx = addr.index(province_base) + len(province_base)
            return province_base + "市" + addr[idx:]
        else:
            return province + addr
    else:
        return province + addr


def _strip_suffix(text: str, suffix: str) -> str:
    """Remove trailing suffix (e.g. '市') from text."""
    if text and text.endswith(suffix):
        return text[: -len(suffix)]
    return text
