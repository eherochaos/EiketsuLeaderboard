"""普通用户侧的一键绑定、采集和上传流程。"""

from __future__ import annotations

import json
import os
import shutil
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from eiketsu_env.config import Settings, version_start_date
from eiketsu_env import __version__
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from eiketsu_env.db.base import Base
from eiketsu_env.db.models import RawSnapshot
from eiketsu_env.db.session import make_engine
from eiketsu_env.services.battle_festival import (
    BattleFestivalPeriod,
    detect_battle_festival_period,
    is_battle_festival_active,
    probe_battle_festival_period,
    today_jst,
)
from eiketsu_env.services.collector import CollectResult, collect_follow
from eiketsu_env.services.mode_filter import MODE_SCOPE_BATTLE_FESTIVAL, MODE_SCOPE_TIER_LIST
from eiketsu_env.services.progress import ProgressReporter
from eiketsu_env.services.share import ShareConfig, assert_safe_contribution_payload, export_contribution
from eiketsu_env.utils import sha256_text


CLIENT_CONFIG_FILE = "client_config.json"


class JsonTransport(Protocol):
    def request_json(
        self,
        method: str,
        url: str,
        payload: dict[str, Any] | None = None,
        token: str = "",
    ) -> dict[str, Any]:
        ...


@dataclass(slots=True)
class ClientConfig:
    server_url: str
    api_token: str
    contributor: str
    user_public_id: str = ""


@dataclass(slots=True)
class ClientBindResult:
    server_url: str
    user_public_id: str
    token_prefix: str
    config_path: Path


@dataclass(slots=True)
class ClientSyncResult:
    collect_result: CollectResult
    package_path: Path
    upload: dict[str, Any]
    viewer_url: str
    battle_festival_collect_result: CollectResult | None = None
    battle_festival_package_path: Path | None = None
    battle_festival_upload: dict[str, Any] | None = None


@dataclass(slots=True)
class ClientShareConfigResult:
    config: ShareConfig
    current_target_version: str
    available_target_versions: list[str]


@dataclass(slots=True)
class ClientCleanupResult:
    raw_dir: Path
    files_removed: int
    bytes_removed: int
    rows_removed: int


@dataclass(slots=True)
class ContributionPackageSummary:
    package_id: str
    mode_scope: str
    match_count: int
    body_hash: str
    content_hash: str
    player_merit_sample_count: int
    player_missing_merit_count: int


@dataclass(slots=True)
class ClientUpdateCheck:
    configured: bool
    current_version: str
    latest_version: str
    update_available: bool
    download_url: str = ""
    download_name: str = ""
    size_bytes: int = 0
    sha256: str = ""
    notes: str = ""
    published_at: str = ""
    message: str = ""


@dataclass(slots=True)
class BattleFestivalCollectPlan:
    config: ShareConfig | None
    source: str
    upload_when_empty: bool
    reason: str


class UrllibJsonTransport:
    def __init__(self, timeout_seconds: int = 900) -> None:
        self.timeout_seconds = timeout_seconds

    def request_json(
        self,
        method: str,
        url: str,
        payload: dict[str, Any] | None = None,
        token: str = "",
    ) -> dict[str, Any]:
        data = json.dumps(payload or {}, ensure_ascii=False).encode("utf-8") if payload is not None else None
        headers = {"Accept": "application/json"}
        if payload is not None:
            headers["Content-Type"] = "application/json; charset=utf-8"
        if token:
            headers["Authorization"] = f"Bearer {token}"
        request = urllib.request.Request(url, data=data, method=method.upper(), headers=headers)
        try:
            # 真实贡献包可能有数千场，首版先让客户端等待服务端同步导入完成。
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:  # noqa: S310 - 用户显式配置的私有 VPS 地址。
                raw = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            raw_error = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"HTTP {exc.code}: {raw_error}") from exc
        return json.loads(raw) if raw else {}


def bind_client(
    settings: Settings,
    server_url: str,
    invite: str,
    contributor: str,
    transport: JsonTransport | None = None,
) -> ClientBindResult:
    transport = transport or UrllibJsonTransport()
    normalized_url = _normalize_server_url(server_url)
    payload = transport.request_json(
        "POST",
        f"{normalized_url}/api/v1/auth/bind-invite",
        {"invite_code": invite, "contributor_name": contributor},
    )
    config = ClientConfig(
        server_url=normalized_url,
        api_token=str(payload["api_token"]),
        contributor=contributor,
        user_public_id=str(payload.get("user_public_id") or ""),
    )
    path = save_client_config(settings, config)
    return ClientBindResult(
        server_url=normalized_url,
        user_public_id=config.user_public_id,
        token_prefix=str(payload.get("token_prefix") or config.api_token[:8]),
        config_path=path,
    )


def sync_client(
    settings: Settings,
    auth_source: str = "",
    interactive_auth: bool = True,
    transport: JsonTransport | None = None,
    progress: ProgressReporter | None = None,
    date_from: str = "",
    date_to: str = "",
    target_version: str = "",
) -> ClientSyncResult:
    config = load_client_config(settings)
    transport = transport or UrllibJsonTransport()
    share_config = _request_share_config(config, transport, target_version=target_version)
    share_config = apply_client_date_override(share_config, date_from=date_from, date_to=date_to)
    tier_config = tier_list_share_config(share_config)

    _ensure_client_database(settings)
    if progress:
        progress.message("快速同步模式：并发采集详情，自动跳过已完整采集的旧详情")
        progress.message("战祭检测需要会员登录态：请保持“打开登录页”弹出的 Chrome/Edge/Brave 窗口打开直到同步完成")
    battle_collect = None
    battle_upload = None
    battle_package_path = None
    battle_probe = probe_battle_festival_period(settings, auth_source=auth_source, interactive_auth=interactive_auth)
    if progress:
        progress.message(f"战祭页探测状态：{battle_probe.status}")
        if battle_probe.message:
            progress.message(battle_probe.message)
    battle_plan = battle_festival_collect_plan(share_config, battle_probe)
    battle_config = battle_plan.config
    if battle_config is not None:
        if progress:
            progress.message(
                f"battle_festival 采集启动：{battle_config.date_from} 至 {battle_config.date_to}，来源 {battle_plan.source}"
            )
        try:
            battle_collect = collect_follow(
                settings,
                battle_config.date_from,
                battle_config.date_to,
                include_solo=False,
                include_battle_festival=True,
                mode_scope=battle_config.mode_scope,
                auth_source=auth_source,
                interactive_auth=False,
                skip_existing=True,
                skip_inactive=True,
                concurrency_profile="aggressive",
                progress=progress,
                save_raw_snapshots=False,
            )
            if progress:
                progress.message(_battle_festival_collect_summary(battle_collect.counts))
            if battle_plan.upload_when_empty or _battle_festival_collect_has_evidence(battle_collect.counts):
                battle_upload, battle_package_path, battle_uploaded_matches = _upload_contribution(
                    settings,
                    config,
                    transport,
                    battle_config,
                    progress,
                )
                if progress:
                    progress.message(f"battle_festival 上传场数：{battle_uploaded_matches}")
            elif progress:
                progress.message("battle_festival 未上传：旧 history 接口未发现 戦祭り seeds/details")
        except Exception as exc:  # noqa: BLE001 - 战祭补采失败不能阻断普通 TierList 上传。
            if progress:
                progress.message(f"battle_festival 采集失败：{exc}")
    elif progress:
        progress.message(f"battle_festival 采集未启动：{battle_plan.reason}")

    collect_result = collect_follow(
        settings,
        tier_config.date_from,
        tier_config.date_to,
        include_solo=tier_config.include_solo,
        include_battle_festival=False,
        mode_scope=tier_config.mode_scope,
        auth_source=auth_source,
        interactive_auth=interactive_auth,
        skip_existing=True,
        skip_inactive=True,
        concurrency_profile="aggressive",
        progress=progress,
        save_raw_snapshots=False,
    )
    upload, package_path, _upload_match_count = _upload_contribution(settings, config, transport, tier_config, progress)

    return ClientSyncResult(
        collect_result=collect_result,
        package_path=package_path,
        upload=upload,
        viewer_url=f"{config.server_url}/me?token={urllib.parse.quote(config.api_token)}",
        battle_festival_collect_result=battle_collect,
        battle_festival_package_path=battle_package_path,
        battle_festival_upload=battle_upload,
    )


def fetch_client_share_config(settings: Settings, transport: JsonTransport | None = None, target_version: str = "") -> ShareConfig:
    config = load_client_config(settings)
    return _request_share_config(config, transport or UrllibJsonTransport(), target_version=target_version)


def fetch_client_share_config_state(
    settings: Settings,
    transport: JsonTransport | None = None,
    target_version: str = "",
) -> ClientShareConfigResult:
    config = load_client_config(settings)
    payload = _request_share_config_payload(config, transport or UrllibJsonTransport(), target_version=target_version)
    share_config = ShareConfig.from_payload(payload)
    share_config.validate()
    available_versions = [
        version
        for version in dict.fromkeys(str(item or "").strip() for item in payload.get("available_target_versions") or [])
        if version
    ]
    if share_config.target_version and share_config.target_version not in available_versions:
        available_versions.insert(0, share_config.target_version)
    return ClientShareConfigResult(
        config=share_config,
        current_target_version=str(payload.get("current_target_version") or share_config.target_version),
        available_target_versions=available_versions,
    )


def check_client_update(
    settings: Settings,
    server_url: str = "",
    current_version: str = __version__,
    transport: JsonTransport | None = None,
) -> ClientUpdateCheck:
    server = _normalize_server_url(server_url or _configured_server_url(settings))
    transport = transport or UrllibJsonTransport(timeout_seconds=20)
    query = urllib.parse.urlencode({"current_version": current_version})
    payload = transport.request_json("GET", f"{server}/api/v1/client/update?{query}")
    return ClientUpdateCheck(
        configured=bool(payload.get("configured")),
        current_version=str(payload.get("current_version") or current_version),
        latest_version=str(payload.get("latest_version") or ""),
        update_available=bool(payload.get("update_available")),
        download_url=str(payload.get("download_url") or ""),
        download_name=str(payload.get("download_name") or ""),
        size_bytes=int(payload.get("size_bytes") or 0),
        sha256=str(payload.get("sha256") or ""),
        notes=str(payload.get("notes") or ""),
        published_at=str(payload.get("published_at") or ""),
        message=str(payload.get("message") or ""),
    )


def apply_client_date_override(config: ShareConfig, date_from: str = "", date_to: str = "") -> ShareConfig:
    # 用户可以缩小采集日期，但不能早于服务端配置的版本开始日，避免混入旧版本样本。
    effective_from = (date_from or config.date_from).strip()
    effective_to = (date_to or config.date_to).strip()
    floor = minimum_client_date_from(config)
    if effective_from < floor:
        effective_from = floor
    if effective_to > config.date_to:
        effective_to = config.date_to
    if effective_to < effective_from:
        raise ValueError(f"结束日期不能早于起始日期 {effective_from}")
    overridden = ShareConfig(
        schema_version=config.schema_version,
        target_version=config.target_version,
        date_from=effective_from,
        date_to=effective_to,
        mode_scope=config.mode_scope,
        festival_date_from=config.festival_date_from,
        festival_date_to=config.festival_date_to,
        include_solo=config.include_solo,
        include_battle_festival=config.include_battle_festival,
        high_ranker_rank=config.high_ranker_rank,
        report_formats=list(config.report_formats),
        reports=list(config.reports),
    )
    overridden.validate()
    return overridden


def minimum_client_date_from(config: ShareConfig) -> str:
    known_start = version_start_date(config.target_version)
    if config.date_from:
        return config.date_from
    return known_start


def tier_list_share_config(config: ShareConfig) -> ShareConfig:
    tier_config = ShareConfig(
        schema_version=config.schema_version,
        target_version=config.target_version,
        date_from=config.date_from,
        date_to=config.date_to,
        mode_scope=MODE_SCOPE_TIER_LIST,
        include_solo=config.include_solo,
        include_battle_festival=False,
        high_ranker_rank=config.high_ranker_rank,
        report_formats=list(config.report_formats),
        reports=list(config.reports),
    )
    tier_config.validate()
    return tier_config


def active_battle_festival_share_config(
    settings: Settings,
    base_config: ShareConfig,
    auth_source: str = "",
    period: BattleFestivalPeriod | None = None,
) -> ShareConfig | None:
    detected = period or detect_battle_festival_period(settings, auth_source=auth_source, interactive_auth=False)
    return battle_festival_share_config_from_period(base_config, detected)


def battle_festival_share_config_from_period(
    base_config: ShareConfig,
    period: BattleFestivalPeriod | None,
    current_day: date | None = None,
) -> ShareConfig | None:
    current_day = current_day or today_jst()
    if not is_battle_festival_active(period, today=current_day):
        return None
    assert period is not None
    collect_to = min(period.date_to, current_day.isoformat())
    return _battle_festival_share_config_for_window(
        base_config,
        date_from=period.date_from,
        date_to=collect_to,
        festival_date_from=period.date_from,
        festival_date_to=period.date_to,
    )


def _battle_festival_share_config_for_window(
    base_config: ShareConfig,
    date_from: str,
    date_to: str,
    festival_date_from: str,
    festival_date_to: str,
) -> ShareConfig:
    battle_config = ShareConfig(
        schema_version=base_config.schema_version,
        target_version=base_config.target_version,
        date_from=date_from,
        date_to=date_to,
        mode_scope=MODE_SCOPE_BATTLE_FESTIVAL,
        festival_date_from=festival_date_from,
        festival_date_to=festival_date_to,
        include_solo=False,
        include_battle_festival=True,
        high_ranker_rank=base_config.high_ranker_rank,
        report_formats=list(base_config.report_formats),
        reports=list(base_config.reports),
    )
    battle_config.validate()
    return battle_config


def battle_festival_collect_plan(
    base_config: ShareConfig,
    probe: BattleFestivalProbeResult,
    current_day: date | None = None,
) -> BattleFestivalCollectPlan:
    current_day = current_day or today_jst()
    current = current_day.isoformat()
    if probe.period is not None:
        date_from = max(base_config.date_from, probe.period.date_from)
        date_to = min(base_config.date_to, probe.period.date_to, current)
        if date_from <= date_to:
            official_config = _battle_festival_share_config_for_window(
                base_config,
                date_from=date_from,
                date_to=date_to,
                festival_date_from=probe.period.date_from,
                festival_date_to=probe.period.date_to,
            )
            return BattleFestivalCollectPlan(official_config, "official_period", True, "官方战祭周期已匹配采集范围")
        return BattleFestivalCollectPlan(None, "official_inactive", False, "官方战祭周期未覆盖采集范围")

    return BattleFestivalCollectPlan(
        None,
        "missing_official_period",
        False,
        f"missing_official_period: 未检测到官方战祭开放期，跳过战祭采集（probe_status={probe.status or 'unknown'}）",
    )


def _battle_festival_collect_has_evidence(counts: dict[str, Any]) -> bool:
    return any(
        int(counts.get(key) or 0) > 0
        for key in ("detail_candidates", "existing_detail_skipped", "detail_pages", "matches")
    )


def _battle_festival_collect_summary(counts: dict[str, Any]) -> str:
    return (
        "battle_festival 采集结果："
        f"戦祭り seeds {int(counts.get('detail_candidates') or 0)}，"
        f"details {int(counts.get('detail_pages') or 0)}，"
        f"matches {int(counts.get('matches') or 0)}，"
        f"绝对戦功样本 {int(counts.get('battle_festival_merit_samples') or 0)}，"
        f"player缺戦功 {int(counts.get('battle_festival_player_merit_missing') or 0)}，"
        f"缺戦功重抓 {int(counts.get('battle_festival_existing_merit_missing') or 0)}，"
        f"skipped_by_mode {int(counts.get('skipped_by_mode') or 0)}"
    )


def _upload_contribution(
    settings: Settings,
    config: ClientConfig,
    transport: JsonTransport,
    share_config: ShareConfig,
    progress: ProgressReporter | None = None,
) -> tuple[dict[str, Any], Path, int]:
    if progress:
        progress.message(f"正在打包 {share_config.mode_scope} 标准化贡献数据")
    package_path = (
        _client_tmp_dir(settings)
        / f"{share_config.mode_scope}_{share_config.target_version}_{share_config.date_from}_{share_config.date_to}.jsonl"
    )
    export_result = export_contribution(settings, share_config, config.contributor, package_path)
    package_text = export_result.path.read_text(encoding="utf-8")
    assert_safe_contribution_payload(package_text)
    package_summary = _summarize_contribution_package(package_text)
    if progress:
        progress.message(_format_package_summary(package_summary))
        if package_summary.mode_scope == MODE_SCOPE_BATTLE_FESTIVAL and package_summary.match_count > 0 and package_summary.player_merit_sample_count == 0:
            progress.message("battle_festival 包警告：player侧戦功样本为 0，本地 DB 仍可能是旧坏数据；需要重新采集生成新包后页面才会刷新。")
    if progress:
        progress.message(f"正在上传 {share_config.mode_scope} 到服务器")
    upload = transport.request_json(
        "POST",
        f"{config.server_url}/api/v1/uploads",
        {"package_text": package_text, "content_hash": sha256_text(package_text)},
        token=config.api_token,
    )
    if progress and upload.get("already_uploaded"):
        progress.message("服务器提示 already_uploaded=true：本次是同内容重复上传，内容未变化；请重新采集生成新包后再上传。")
    try:
        export_result.path.unlink()
    except OSError:
        pass
    return upload, export_result.path, export_result.match_count


def _summarize_contribution_package(package_text: str) -> ContributionPackageSummary:
    lines = [line for line in package_text.splitlines() if line.strip()]
    manifest = json.loads(lines[0]) if lines else {}
    merit_key = "戦功"
    odds_key = "戦功オッズ"
    rank_key = "戦祭りランキング"
    player_merit_sample_count = 0
    player_missing_merit_count = 0
    for line in lines[1:]:
        record = json.loads(line)
        for player in record.get("players") or []:
            if str(player.get("role") or "") != "player":
                continue
            profile = player.get("profile") or {}
            has_merit = bool(str(profile.get(merit_key) or "").strip())
            if has_merit:
                player_merit_sample_count += 1
            elif profile.get(odds_key) or profile.get(rank_key):
                player_missing_merit_count += 1
    return ContributionPackageSummary(
        package_id=str(manifest.get("package_id") or ""),
        mode_scope=str(manifest.get("mode_scope") or ""),
        match_count=int(manifest.get("match_count") or 0),
        body_hash=str(manifest.get("body_hash") or ""),
        content_hash=sha256_text(package_text),
        player_merit_sample_count=player_merit_sample_count,
        player_missing_merit_count=player_missing_merit_count,
    )


def _format_package_summary(summary: ContributionPackageSummary) -> str:
    return (
        f"{summary.mode_scope} 包检查："
        f"match_count {summary.match_count}，"
        f"body_hash {summary.body_hash[:16]}，"
        f"package_id {summary.package_id}，"
        f"player側戦功样本 {summary.player_merit_sample_count}，"
        f"player缺戦功 {summary.player_missing_merit_count}"
    )


def doctor_client(settings: Settings, transport: JsonTransport | None = None) -> dict[str, Any]:
    transport = transport or UrllibJsonTransport()
    path = client_config_path(settings)
    if not path.exists():
        return {
            "configured": False,
            "config_path": str(path),
            "message": "还没有绑定 VPS；请先运行 eiketsu-client bind",
        }
    config = load_client_config(settings)
    result: dict[str, Any] = {
        "configured": True,
        "config_path": str(path),
        "server_url": config.server_url,
        "contributor": config.contributor,
        "user_public_id": config.user_public_id,
    }
    try:
        result["server_config"] = transport.request_json("GET", f"{config.server_url}/api/v1/config")
        result["message"] = "客户端已绑定，服务端可访问"
    except Exception as exc:  # noqa: BLE001 - doctor 需要把可读诊断带回给非技术用户。
        result["message"] = f"客户端已绑定，但无法访问服务端：{exc}"
    return result


def load_client_config(settings: Settings) -> ClientConfig:
    path = client_config_path(settings)
    if not path.exists():
        raise RuntimeError("还没有绑定 VPS；请先运行 eiketsu-client bind")
    payload = json.loads(path.read_text(encoding="utf-8"))
    return ClientConfig(
        server_url=_normalize_server_url(str(payload.get("server_url") or "")),
        api_token=str(payload.get("api_token") or ""),
        contributor=str(payload.get("contributor") or ""),
        user_public_id=str(payload.get("user_public_id") or ""),
    )


def save_client_config(settings: Settings, config: ClientConfig) -> Path:
    path = client_config_path(settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "server_url": config.server_url,
                "api_token": config.api_token,
                "contributor": config.contributor,
                "user_public_id": config.user_public_id,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return path


def client_config_path(settings: Settings) -> Path:
    override = os.environ.get("EIKETSU_CLIENT_CONFIG_DIR")
    if override:
        return Path(override) / CLIENT_CONFIG_FILE
    appdata = os.environ.get("APPDATA")
    if appdata:
        return Path(appdata) / "EiketsuCollector" / CLIENT_CONFIG_FILE
    return settings.data_dir / CLIENT_CONFIG_FILE


def cleanup_raw_snapshots(settings: Settings) -> ClientCleanupResult:
    raw_dir = settings.raw_dir
    files_removed = 0
    bytes_removed = 0
    if raw_dir.exists():
        for path in raw_dir.rglob("*"):
            if path.is_file():
                files_removed += 1
                try:
                    bytes_removed += path.stat().st_size
                except OSError:
                    pass
        shutil.rmtree(raw_dir, ignore_errors=True)

    _ensure_client_database(settings)
    engine = make_engine(settings)
    with Session(engine) as session:
        rows_removed = len(session.scalars(select(RawSnapshot.id)).all())
        session.execute(delete(RawSnapshot))
        session.commit()

    return ClientCleanupResult(
        raw_dir=raw_dir,
        files_removed=files_removed,
        bytes_removed=bytes_removed,
        rows_removed=rows_removed,
    )


def _request_share_config(config: ClientConfig, transport: JsonTransport, target_version: str = "") -> ShareConfig:
    remote_config = _request_share_config_payload(config, transport, target_version=target_version)
    share_config = ShareConfig.from_payload(remote_config)
    share_config.validate()
    return share_config


def _request_share_config_payload(config: ClientConfig, transport: JsonTransport, target_version: str = "") -> dict[str, Any]:
    url = f"{config.server_url}/api/v1/config"
    requested_version = str(target_version or "").strip()
    if requested_version:
        url += "?" + urllib.parse.urlencode({"target_version": requested_version})
    remote_config = transport.request_json("GET", url)
    if not remote_config.get("configured", True):
        raise RuntimeError("服务端还没有配置采集版本和日期范围")
    return remote_config


def _client_tmp_dir(settings: Settings) -> Path:
    path = settings.root_dir / ".tmp" / "client_upload"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _normalize_server_url(server_url: str) -> str:
    value = server_url.strip().rstrip("/")
    if not value:
        raise ValueError("server_url 不能为空")
    return value


def _configured_server_url(settings: Settings) -> str:
    try:
        return load_client_config(settings).server_url
    except RuntimeError:
        return "http://43.128.141.76:8000"


def _ensure_client_database(settings: Settings) -> None:
    # 单文件 exe 不携带 Alembic 脚本，客户端本地库用 create_all 初始化即可。
    engine = make_engine(settings)
    Base.metadata.create_all(engine)
