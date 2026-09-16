# Dual-provider tracing lab — start here

> **Credit:** Adapted from the [Langfuse workshop](https://github.com/langfuse/langfuse-workshop) (commit `13e0674`). The Dad IT Support Agent application and visual assets originate from that project. See [ATTRIBUTION.md](ATTRIBUTION.md) for full provenance.

A working, **untraced student starter** for the Dad IT Support Agent. Choose **Ollama Cloud** or **Duke AI Gateway**, then implement Langfuse tracing yourself, following the original lab progression.

The app and its source are included. Provider addresses, starting models, Docker configuration, and tracing dependencies are ready. The tracing implementation is intentionally left for students. **Each student must add their own keys. No instructor credentials are included.**

## What this lab teaches

You ask a fictional iPhone-support assistant a question. It can look up a fictional device profile and search a small local help library. A *trace* records the complete turn: the model requests, tools called, tool results, and answer. You use that record to check whether the assistant actually used evidence and where time was spent. Nothing connects to a real phone.

This kit starts with no Langfuse exporter or observation wrappers. Adding project keys alone does not create traces. Follow [STUDENT-LAB.md](STUDENT-LAB.md) for the exercise. Later upstream prompt-management, dataset, and evaluation modules are outside this kit.

## 1. Before class

Install and open [Docker Desktop](https://docs.docker.com/desktop/). On Windows use Linux containers and finish any WSL setup that Docker requests. Wait until the engine is running. Install [uv](https://docs.astral.sh/uv/getting-started/installation/) and reopen your terminal. Python 3.11+ can also run the helper directly: substitute `python` for `uv run` in every command.

You need internet access to download the container and dependencies, call the chosen model service, and export Langfuse traces. You do not need Git, a GPU, a local Node installation, or a local Ollama installation. Complete the downloads before class; first setup time depends on your connection.

Extract the ZIP into a normal folder. Open a terminal **in the folder containing `lab.py`**. Do not run from inside the ZIP.

```text
uv run lab.py setup
```

This checks Docker, creates `workshop/.env` if missing, builds the container with the restart fix, and installs the versions in `package-lock.json`. Re-running setup preserves your existing `.env`.

## 2. Choose one model provider

Edit **`workshop/.env`** in a text editor. Turn on file extensions if Windows hides them; the filename must be `.env`, not `.env.txt`. Both providers' fields may be filled in, but only the selected provider is used. Keys belong in this server-side file, never in the browser or source code.

| Setting | Ollama Cloud (default) | Duke AI Gateway |
| --- | --- | --- |
| `MODEL_PROVIDER` | `ollama` | `duke` |
| Your key goes in | `OLLAMA_API_KEY` | `DUKE_API_KEY` |
| Model setting | `OLLAMA_MODEL` | `DUKE_MODEL` |
| Starting model | `gemma4:31b` | `gpt-4.1-mini` |
| Preconfigured endpoint | `https://ollama.com/v1` | `https://litellm.oit.duke.edu/v1` |

### Option A: Ollama Cloud

Create your own [Ollama account and API key](https://ollama.com/settings/keys). Paste the key into `OLLAMA_API_KEY=` and leave `MODEL_PROVIDER=ollama`.

The preset is the direct cloud API model ID **`gemma4:31b`**, which worked in our pilot. Do not substitute a local CLI alias such as `gemma4:cloud`. The hosted API needs no Ollama app or model download. See [Ollama's cloud guide](https://docs.ollama.com/cloud).

Ollama currently offers a free plan with starter credits and a limited set of starter models. That does **not** guarantee every account can use Gemma or has enough allowance for a class. Check your account and run the probe below before class. If access is unavailable, select another available tool-capable model with the instructor, or use Duke. Students should not need to buy credits for this exercise. Terms and model access can change; see [current pricing](https://ollama.com/pricing).

### Option B: Duke AI Gateway

Create your own gateway key using [Duke's AI Dashboard Quick Start](https://oit.duke.edu/help/articles/kb0038824/). Paste it into `DUKE_API_KEY=` and set `MODEL_PROVIDER=duke`. Follow your instructor's guidance on funded or unfunded access. An unfunded key still has model and usage limits.

`gpt-4.1-mini` is a starting setting, not a promise of account access. List your available models and use an exact tool-capable model ID. The endpoint follows [Duke's developer guide](https://ai.colab.duke.edu/colab-ai-blog/all-blogs/getting-started-with-dukes-ai-gateway-a-developers-guide/).

## 3. Add your own Langfuse project

Create a Langfuse account/project and copy its **project** public key, secret key, and API base URL into the three `LANGFUSE_...` fields in `workshop/.env`. These keys are separate from the model-provider key.

The template uses the US region: `https://us.cloud.langfuse.com`. If your project is in the EU, use `https://cloud.langfuse.com`; for another region, copy the URL shown by that project. Use a plain URL, without Markdown `[...](...)` formatting. The two keys and the URL must belong to the same project/region. See [Langfuse setup](https://langfuse.com/docs/observability/get-started).

Chat can run without Langfuse keys, but you need them to complete the tracing exercise. The app reports whether project key fields are populated. This is independent of whether you have implemented tracing or Langfuse has accepted a trace.

## 4. Check the model and start

```text
uv run lab.py models
uv run lab.py probe
uv run lab.py up
```

`models` lists IDs reported by the selected provider. If necessary, update that provider's model field before running `probe`. The probe makes two small model requests and checks **structured tool calling plus an answer based on the tool result**. It does not export traces. Listing a model alone does not prove you can call it.

Open **http://127.0.0.1:3333/**. Initially the header says “not checked,” even if the command-line probe passed: it describes requests in this app session. Send “How do I turn Bluetooth on on my iPhone?” A successful answer changes the header to “last request succeeded.” No trace is expected yet. Follow [STUDENT-LAB.md](STUDENT-LAB.md) to implement model tracing, an agent parent, and tool observations, then verify the result.

## 5. Switch providers later

Fill in the other provider's key and model first. Then run:

```text
uv run lab.py provider duke
uv run lab.py probe
uv run lab.py restart
```

Use `provider ollama` to switch back. The command preserves both providers' keys and models. Only one provider is active at a time; there is no automatic fallback. Restart after changing any `.env` setting. The header refreshes automatically after the backend restarts.

## Useful commands

| Command | Purpose |
| --- | --- |
| `uv run lab.py doctor` | Check Docker availability |
| `uv run lab.py init` | Create blank local configuration without installing |
| `uv run lab.py check` | Run offline regression tests, type checks, and build |
| `uv run lab.py logs` | Show recent app logs |
| `uv run lab.py restart` | Restart after configuration changes |
| `uv run lab.py stop` | Stop the kit; keep settings and dependencies |
| `uv run lab.py probe-json` | Optional strict JSON test; not required for tracing |

## Troubleshooting

- **Docker unavailable:** reopen Docker Desktop, wait for its engine, then run `doctor` and `up`. If the computer restarted, reopening Docker may be necessary. The kit fixes the missing-`ps` shutdown error inside its container; it cannot repair a stopped Docker Desktop engine.
- **Port 3333 in use:** stop the other lab, or in Windows PowerShell run `$env:LAB_PORT="3334"` before `uv run lab.py up`. On macOS/Linux use `LAB_PORT=3334 uv run lab.py up`. Open port 3334 and keep that setting for subsequent commands in that terminal.
- **Header says API key missing:** edit the selected provider's key in `workshop/.env`, then restart. A key saved for the other provider is not used.
- **401/403 or model access rejected:** check the selected key and your account's model permissions. **404:** run `models` and copy an exact model ID. Different providers can expose different names.
- **429 / allowance exhausted:** wait and check the provider's account usage. Avoid simultaneous probes and chats; one turn can make several model calls. Discuss Duke access with the instructor if the free allowance is insufficient.
- **Timeout:** the full chat turn has a 90-second limit and no automatic retries. Retry a shorter question later or use another available tool-capable model. If the instructor allows it, `CHAT_TIMEOUT_SECONDS` can be set between 10 and 180; restart afterward.
- **Answer but no trace:** this is expected before you implement the tracing lesson. After implementing it, check both project keys and the region URL; restart; send a new question. Wait briefly for export, then refresh Langfuse's recent traces. The connection probe does not create traces. Check logs for export errors.
- **No tools or invalid tool arguments:** the selected model may be unsuitable or may behave inconsistently. Run `probe`, try a short in-scope question, and record the behavior. Never count text saying “I called a tool” as an actual tool call.
- **Optional JSON test fails:** do not treat this as a failed tracing setup. Some models wrap JSON in Markdown or do not support this response mode.

Use fictional questions. Prompts and tool results go to your chosen model provider; tracing you implement sends inputs and outputs to your Langfuse project. Submit the requested observations/screenshots, not `.env` or keys.

See [ATTRIBUTION.md](ATTRIBUTION.md) for source provenance.
