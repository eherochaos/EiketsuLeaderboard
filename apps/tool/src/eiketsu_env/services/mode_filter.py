"""判断对局模式是否适合纳入指定统计 scope。"""

from __future__ import annotations


BATTLE_FESTIVAL_MODES = {"戦祭り", "戦祭", "戰祭", "战祭"}
EXCLUDED_DEFAULT_MODES = {"群雄伝", "鍛練場", *BATTLE_FESTIVAL_MODES}
MODE_SCOPE_TIER_LIST = "tier_list"
MODE_SCOPE_BATTLE_FESTIVAL = "battle_festival"
MODE_SCOPES = {MODE_SCOPE_TIER_LIST, MODE_SCOPE_BATTLE_FESTIVAL}


def normalize_mode_scope(value: str | None) -> str:
    cleaned = str(value or "").strip()
    return cleaned if cleaned in MODE_SCOPES else MODE_SCOPE_TIER_LIST


def is_battle_festival_mode(mode: str) -> bool:
    return str(mode or "").strip() in BATTLE_FESTIVAL_MODES


def is_environment_mode(mode: str, include_solo: bool = False, include_battle_festival: bool = False) -> bool:
    cleaned = str(mode or "").strip()
    if include_solo:
        return True
    if include_battle_festival and is_battle_festival_mode(cleaned):
        return True
    # 默认环境统计只看常规规则；群雄传/练习场不是 PvP，战祭规则特殊，都会污染胜率和卡组使用率。
    return cleaned not in EXCLUDED_DEFAULT_MODES


def is_mode_in_scope(
    mode: str,
    mode_scope: str | None = MODE_SCOPE_TIER_LIST,
    include_solo: bool = False,
    include_battle_festival: bool = False,
) -> bool:
    _ = include_battle_festival
    scope = normalize_mode_scope(mode_scope)
    if scope == MODE_SCOPE_BATTLE_FESTIVAL:
        return is_battle_festival_mode(mode)
    if is_battle_festival_mode(mode):
        return False
    return is_environment_mode(
        mode,
        include_solo=include_solo,
        include_battle_festival=False,
    )
