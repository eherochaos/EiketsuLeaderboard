from __future__ import annotations

import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).with_name("self-hosted-main.sh")
WORKFLOW_PATH = Path(__file__).parents[2] / ".github" / "workflows" / "deploy.yml"


class SelfHostedDeployScriptTests(unittest.TestCase):
    def setUp(self) -> None:
        self.script = SCRIPT_PATH.read_text(encoding="utf-8")
        self.workflow = WORKFLOW_PATH.read_text(encoding="utf-8")

    def test_workflow_uses_self_hosted_runner_without_ssh(self) -> None:
        self.assertIn("runs-on: [self-hosted, linux, eiketsu-prod]", self.workflow)
        self.assertIn("bash scripts/deploy/self-hosted-main.sh", self.workflow)
        self.assertNotIn("DEPLOY_SSH_KEY", self.workflow)
        self.assertNotIn("scp -P", self.workflow)
        self.assertNotIn("ssh -p", self.workflow)

    def test_script_reuses_remote_deploy_core(self) -> None:
        self.assertIn("tar \\", self.script)
        self.assertIn("tar -C apps/web/dist", self.script)
        self.assertIn("SITE_ANALYTICS_ADMIN_TOKEN_B64", self.script)
        self.assertIn("bash scripts/deploy/remote-main.sh", self.script)


if __name__ == "__main__":
    unittest.main()
