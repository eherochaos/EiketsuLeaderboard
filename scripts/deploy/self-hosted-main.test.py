from __future__ import annotations

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


if __name__ == "__main__":
    unittest.main()
