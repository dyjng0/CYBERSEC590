"""Run the bundled student lab. Python standard library only; use uv or Python 3.11+."""
import argparse
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
WORKSHOP = ROOT / "workshop"


def run(*args):
    subprocess.run(args, cwd=ROOT, check=True)


def compose(*args):
    run("docker", "compose", "-f", str(ROOT / "compose.yaml"), *args)


def initialize():
    target = WORKSHOP / ".env"
    if target.exists():
        print("workshop/.env already exists; your settings were preserved.")
    else:
        with target.open("x", encoding="utf-8") as output:
            output.write((WORKSHOP / ".env.example").read_text(encoding="utf-8"))
        target.chmod(0o600)
        print("Created workshop/.env. Add your own provider and Langfuse project keys.")


def doctor():
    if not shutil.which("docker"):
        raise RuntimeError("Install Docker Desktop and start its engine first. See README.md.")
    compose("version")
    run("docker", "info", "--format", "Docker Engine {{.ServerVersion}}")
    print(f"Python {sys.version.split()[0]}. No Git, local Node, GPU, or Ollama installation is required.")


def select_provider(value):
    initialize()
    target = WORKSHOP / ".env"
    text = target.read_text(encoding="utf-8-sig")
    if re.search(r"(?m)^MODEL_PROVIDER\s*=", text):
        text = re.sub(r"(?m)^MODEL_PROVIDER\s*=.*$", f"MODEL_PROVIDER={value}", text)
    else:
        text += f"\nMODEL_PROVIDER={value}\n"
    target.write_text(text, encoding="utf-8")
    print(f"Selected {value}; each provider's existing key and model were preserved. Run probe, then restart if the app is running.")


def execute(action, provider):
    if action == "init":
        initialize()
        return
    if action == "provider":
        if provider is None:
            raise RuntimeError("Use: uv run lab.py provider ollama  OR  uv run lab.py provider duke")
        select_provider(provider)
        return
    if action == "doctor":
        doctor()
    elif action in ("setup", "install"):
        doctor()
        initialize()
        compose("build", "workshop")
        compose("run", "--rm", "--no-deps", "workshop", "npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund")
    elif action in ("models", "probe", "probe-json"):
        compose("run", "--rm", "--no-deps", "workshop", "npm", "run", "probe", "--", action)
    elif action == "check":
        compose("run", "--rm", "--no-deps", "workshop", "sh", "-c", "npm test && npm run typecheck && npm run build")
    elif action == "up":
        compose("up", "-d", "--wait", "--wait-timeout", "90")
        print(f"Open http://127.0.0.1:{os.environ.get('LAB_PORT', '3333')}. App readiness does not verify model access or trace delivery.")
    elif action == "restart":
        compose("restart", "workshop")
        compose("up", "-d", "--wait", "--wait-timeout", "90")
    elif action == "stop":
        compose("down")
        print("Stopped. Source, credentials, and dependency volumes retained.")
    elif action == "logs":
        compose("logs", "--tail", "80", "workshop")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["init", "provider", "doctor", "setup", "install", "models", "probe", "probe-json", "check", "up", "restart", "stop", "logs"])
    parser.add_argument("provider", nargs="?", choices=["ollama", "duke"])
    try:
        args = parser.parse_args()
        execute(args.action, args.provider)
    except subprocess.CalledProcessError as error:
        print("Command failed. If Docker is unavailable, reopen Docker Desktop, wait for the engine, then retry. See README.md and 'uv run lab.py logs'.", file=sys.stderr)
        sys.exit(error.returncode or 1)
    except (RuntimeError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
