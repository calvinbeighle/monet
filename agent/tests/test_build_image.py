"""Tests for os/build-image.sh - validates script structure, options, and safety checks.

These tests validate the build script without requiring root, virt-customize, or
an actual Debian image. They parse the script and verify correctness of its logic,
argument handling, required file checks, and output paths.
"""

import os
import subprocess
import stat
import re
import pytest

REPO_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BUILD_SCRIPT = os.path.join(REPO_DIR, "os", "build-image.sh")


class TestBuildScriptExists:
    """The build script must exist and be executable."""

    def test_script_exists(self):
        assert os.path.isfile(BUILD_SCRIPT), "os/build-image.sh must exist"

    def test_script_is_executable(self):
        mode = os.stat(BUILD_SCRIPT).st_mode
        assert mode & stat.S_IXUSR, "os/build-image.sh must be executable"

    def test_script_has_shebang(self):
        with open(BUILD_SCRIPT) as f:
            first_line = f.readline()
        assert first_line.startswith("#!/"), "Script must have a shebang line"
        assert "bash" in first_line, "Script must use bash"


class TestBuildScriptContent:
    """Validate the script's internal structure and safety checks."""

    @pytest.fixture(autouse=True)
    def load_script(self):
        with open(BUILD_SCRIPT) as f:
            self.content = f.read()

    def test_set_euo_pipefail(self):
        assert "set -euo pipefail" in self.content, (
            "Script must use strict mode (set -euo pipefail)"
        )

    def test_root_check(self):
        assert "EUID" in self.content, "Script must check for root privileges"

    def test_checks_required_tools(self):
        for tool in ["virt-customize", "qemu-img", "curl"]:
            assert tool in self.content, f"Script must check for {tool}"

    def test_checks_required_repo_files(self):
        for path in [
            "agent/main.py",
            "agent/requirements.txt",
            "os/strip.sh",
            "os/install.sh",
        ]:
            assert path in self.content, f"Script must verify {path} exists"

    def test_supports_arm64_and_amd64(self):
        assert "arm64" in self.content
        assert "amd64" in self.content

    def test_downloads_debian_cloud_image(self):
        assert "cloud.debian.org" in self.content, (
            "Script must download from official Debian cloud mirror"
        )

    def test_resizes_image(self):
        assert "qemu-img resize" in self.content

    def test_runs_strip_sh(self):
        assert "strip.sh" in self.content

    def test_runs_install_sh(self):
        assert "install.sh" in self.content

    def test_compacts_output(self):
        assert "qemu-img convert" in self.content, "Script must compact the final image"

    def test_supports_skip_download(self):
        assert "--skip-download" in self.content

    def test_supports_source_image(self):
        assert "--source" in self.content

    def test_supports_api_key_injection(self):
        assert "--api-key" in self.content
        assert "ANTHROPIC_API_KEY" in self.content

    def test_supports_password_setting(self):
        assert "--password" in self.content

    def test_has_usage_help(self):
        assert "--help" in self.content

    def test_outputs_qcow2(self):
        assert ".qcow2" in self.content

    def test_cleans_up_staging(self):
        assert "rm -rf" in self.content and "staging" in self.content.lower(), (
            "Script must clean up staging directory"
        )


class TestBuildScriptArgParsing:
    """Validate argument parsing via --help (does not need root)."""

    def test_help_exits_zero(self):
        result = subprocess.run(
            ["bash", BUILD_SCRIPT, "--help"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        assert result.returncode == 0

    def test_help_shows_usage(self):
        result = subprocess.run(
            ["bash", BUILD_SCRIPT, "--help"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        assert "Usage" in result.stdout or "usage" in result.stdout

    def test_unknown_option_fails(self):
        result = subprocess.run(
            ["bash", BUILD_SCRIPT, "--nonexistent-flag"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        assert result.returncode != 0


class TestBuildScriptRootGuard:
    """Verify the script refuses to run without root."""

    def test_refuses_non_root(self):
        if os.geteuid() == 0:
            pytest.skip("Cannot test root guard when running as root")
        result = subprocess.run(
            ["bash", BUILD_SCRIPT],
            capture_output=True,
            text=True,
            timeout=5,
        )
        assert result.returncode != 0
        assert "root" in result.stderr.lower() or "root" in result.stdout.lower()


class TestBuildScriptOutputPaths:
    """Validate default output path construction."""

    @pytest.fixture(autouse=True)
    def load_script(self):
        with open(BUILD_SCRIPT) as f:
            self.content = f.read()

    def test_default_output_includes_arch(self):
        assert "monet-os-${ARCH}.qcow2" in self.content or "monet-os-" in self.content

    def test_default_output_in_build_dir(self):
        assert "BUILD_DIR" in self.content
        assert "build" in self.content.lower()


class TestBuildScriptSafety:
    """The script must handle edge cases safely."""

    @pytest.fixture(autouse=True)
    def load_script(self):
        with open(BUILD_SCRIPT) as f:
            self.content = f.read()

    def test_does_not_hardcode_api_keys(self):
        # Ensure no actual API keys are baked into the script
        assert "sk-ant-" not in self.content
        assert "sk_live" not in self.content

    def test_uses_work_image_not_base(self):
        # Must operate on a copy, not the downloaded base image
        assert "WORK_IMAGE" in self.content
        assert "cp " in self.content  # copies base to working image

    def test_growpart_for_partition_resize(self):
        assert "growpart" in self.content, (
            "Script must grow the partition after qemu-img resize"
        )

    def test_resize2fs_for_filesystem(self):
        assert "resize2fs" in self.content, (
            "Script must resize the filesystem after growing the partition"
        )


class TestRepoFilesForBuild:
    """Verify all files referenced by the build script exist in the repo."""

    def test_strip_sh_exists(self):
        assert os.path.isfile(os.path.join(REPO_DIR, "os", "strip.sh"))

    def test_install_sh_exists(self):
        assert os.path.isfile(os.path.join(REPO_DIR, "os", "install.sh"))

    def test_sway_config_exists(self):
        assert os.path.isfile(os.path.join(REPO_DIR, "os", "sway.config"))

    def test_monet_agent_service_exists(self):
        assert os.path.isfile(os.path.join(REPO_DIR, "os", "monet-agent.service"))

    def test_plymouth_theme_exists(self):
        assert os.path.isfile(
            os.path.join(REPO_DIR, "os", "plymouth", "monet.plymouth")
        )
        assert os.path.isfile(os.path.join(REPO_DIR, "os", "plymouth", "monet.script"))

    def test_agent_main_exists(self):
        assert os.path.isfile(os.path.join(REPO_DIR, "agent", "main.py"))

    def test_agent_requirements_exists(self):
        assert os.path.isfile(os.path.join(REPO_DIR, "agent", "requirements.txt"))
