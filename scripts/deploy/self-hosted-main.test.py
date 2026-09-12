from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).with_name("self-hosted-main.sh")
WORKFLOW_PATH = Path(__file__).parents[2] / ".github" / "workflows" / "deploy.yml"
WORKFLOWS_ROOT = WORKFLOW_PATH.parent


class SelfHostedDeployScriptTests(unittest.TestCase):
    def setUp(self) -> None:
        self.script = SCRIPT_PATH.read_text(encoding="utf-8")
        self.workflow = WORKFLOW_PATH.read_text(encoding="utf-8")

    def test_workflow_uses_self_hosted_runner_without_ssh(self) -> None:
        self.assertIn("github.repository == 'eherochaos/EiketsuLeaderboard'", self.workflow)
        self.assertIn("github.event_name == 'push' && github.ref == 'refs/heads/main'", self.workflow)
        self.assertIn("github.event_name == 'workflow_dispatch'", self.workflow)
        self.assertIn("runs-on: [self-hosted, linux, eiketsu-prod]", self.workflow)
        self.assertIn("bash scripts/deploy/self-hosted-main.sh", self.workflow)
        self.assertNotIn("DEPLOY_SSH_KEY", self.workflow)
        self.assertNotIn("scp -P", self.workflow)
        self.assertNotIn("ssh -p", self.workflow)

    def test_pull_request_workflows_do_not_use_self_hosted_runner(self) -> None:
        for path in WORKFLOWS_ROOT.glob("*.yml"):
            text = path.read_text(encoding="utf-8")
            if "pull_request" not in text:
                continue
            self.assertNotIn("self-hosted", text, msg=str(path))
            self.assertNotIn("eiketsu-prod", text, msg=str(path))

    def test_script_reuses_remote_deploy_core(self) -> None:
        self.assertIn("tar \\", self.script)
        self.assertIn("tar -C apps/web/dist", self.script)
        self.assertIn("SITE_ANALYTICS_ADMIN_TOKEN_B64", self.script)
        self.assertIn("bash scripts/deploy/remote-main.sh", self.script)

    def test_public_smoke_accepts_empty_tier_list_and_checks_pages(self) -> None:
        result, calls = self.run_public_smoke('{"tierRows": []}')

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("skip public deck config smoke", result.stdout)
        self.assertNotIn("/api/tier-list-deck-config", calls)
        self.assertIn("http://smoke.test/tier-list/", calls)
        self.assertIn("http://smoke.test/admin-stats/", calls)

    def test_public_smoke_checks_encoded_deck_id(self) -> None:
        result, calls = self.run_public_smoke(json.dumps({"tierRows": [{"deckId": "card-a,card/b &c"}]}))

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("deckId=card-a%2Ccard%2Fb%20%26c", calls)
        self.assertIn("http://smoke.test/admin-stats/", calls)
        self.assertNotIn("skip public deck config smoke", result.stdout)

    def test_public_smoke_rejects_missing_id_in_populated_tier_list(self) -> None:
        for row in ({}, {"deckId": None}, {"deckId": ""}, {"deckId": "  "}, {"deckId": 1}, None):
            with self.subTest(row=row):
                result, calls = self.run_public_smoke(json.dumps({"tierRows": [row]}))
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("tier list smoke deck id is missing", result.stderr)
                self.assertNotIn("/api/tier-list-deck-config", calls)
                self.assertNotIn("/admin-stats/", calls)

    def test_public_smoke_rejects_invalid_snapshots(self) -> None:
        for snapshot in ("{broken", "null", "[]", "{}", '{"tierRows": null}', '{"tierRows": {}}'):
            with self.subTest(snapshot=snapshot):
                result, calls = self.run_public_smoke(snapshot)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn("skip public deck config smoke", result.stdout)
                self.assertNotIn("/admin-stats/", calls)

    def test_public_smoke_still_rejects_http_failures(self) -> None:
        for path in ("/api/tier-list-snapshot", "/tier-list/", "/admin-stats/"):
            with self.subTest(path=path):
                result, _ = self.run_public_smoke('{"tierRows": []}', fail_path=path)
                self.assertEqual(result.returncode, 22)

    def test_public_smoke_still_rejects_deck_config_failure(self) -> None:
        result, calls = self.run_public_smoke('{"tierRows": [{"deckId": "card-a"}]}', fail_path="/api/tier-list-deck-config")

        self.assertEqual(result.returncode, 22)
        self.assertNotIn("/admin-stats/", calls)

    def run_public_smoke(self, snapshot: str, *, fail_path: str = "") -> tuple[subprocess.CompletedProcess[str], str]:
        bash = shutil.which("bash")
        if not bash and os.name == "nt":
            git = shutil.which("git")
            candidate = Path(git).parent.parent / "bin" / "bash.exe" if git else None
            if candidate and candidate.is_file():
                bash = str(candidate)
        node = shutil.which("node")
        if not bash or not node:
            self.fail("Bash and Node are required for public deployment smoke tests")

        # 从工作流提取真实步骤，防止只测部署脚本而漏掉末尾的重复验收。
        step = self.workflow.split("      - name: Smoke public deployment\n", 1)[1]
        step = step.split("      - name:", 1)[0]
        commands = textwrap.dedent(step.split("        run: |\n", 1)[1])
        stubs = r'''
node() { "$SMOKE_NODE" "$@"; }
curl() {
  printf '%s\n' "$*" >> "$SMOKE_TRACE"
  if [ -n "$SMOKE_FAIL_PATH" ] && [[ "$*" == *"$SMOKE_FAIL_PATH"* ]]; then
    return 22
  fi
  local output_file=''
  while [ "$#" -gt 0 ]; do
    if [ "$1" = '-o' ]; then
      shift
      output_file="$1"
    fi
    shift
  done
  if [ -n "$output_file" ]; then
    printf '%s' "$SMOKE_SNAPSHOT" > "$output_file"
  fi
  return 0
}
'''
        with tempfile.TemporaryDirectory(prefix="public-deploy-smoke-") as temp_dir:
            root = Path(temp_dir)
            trace = root / "calls.txt"
            env = {
                **os.environ, "DEPLOY_PUBLIC_URL_BASE": "http://smoke.test/", "RUNNER_TEMP": root.as_posix(),
                "SMOKE_NODE": Path(node).as_posix(), "SMOKE_TRACE": trace.as_posix(),
                "SMOKE_SNAPSHOT": snapshot, "SMOKE_FAIL_PATH": fail_path,
            }
            result = subprocess.run(
                [bash, "--noprofile", "--norc", "-s"], input="set -e\n" + stubs + commands,
                env=env, capture_output=True, text=True, encoding="utf-8", timeout=30, check=False,
            )
            return result, trace.read_text(encoding="utf-8") if trace.exists() else ""


if __name__ == "__main__":
    unittest.main()
