# Configure the Python runtime

By default the plugin picks a system Python 3.11+, or downloads a standalone Python from the domestic mirror (`dsh-vision-python-bootstrap-1317715800.cos.ap-guangzhou.myqcloud.com`) when none is found, falling back to the GitHub release when the mirror is unreachable; most users never need to configure this section. The rest is for advanced setups where automatic discovery fails, a specific interpreter is required, or an external runtime is used.

The packaged `managed` runtime creates its own isolated virtual environment. `runtime.python` selects the Python executable used to bootstrap or refresh that environment; it does not replace the managed environment with the interpreter's global site-packages. Set it when automatic discovery fails or when several Python installations exist. The override is also used by `runtime.mode: external`.

Python 3.11 or newer is required; the automatically downloaded standalone Python is 3.13.15 and, like a system interpreter, is only used to bootstrap the isolated environment. Without an override, the plugin tries `python3` then `python` on macOS/Linux, and `python`, `py -3`, then `python3` on Windows, before falling back to the domestic-mirror standalone download (GitHub release as a secondary fallback). A configured value is passed as one executable name or path, not as a shell command with arguments, so use `py` (not `py -3`) for the Windows launcher; use an absolute path when you need a specific version.

Configure it in the Profile patch:

```yaml
- id: vision-toolkit
  config:
    runtime:
      # macOS/Linux system Python
      python: python3
      # Or a project-local environment:
      # python: /absolute/path/to/project/.venv/bin/python
      # Windows venv (forward slashes also work in YAML):
      # python: C:/Users/you/project/.venv/Scripts/python.exe
      # Windows launcher, when its default Python is 3.11+:
      # python: py
```

For a managed runtime, create the project-local interpreter and point `runtime.python` at it. The plugin installs the locked dependencies into its own managed cache (Tencent Cloud PyPI mirror first, official PyPI as fallback), so installing the lockfile into this bootstrap environment is optional:

```sh
python3 --version                         # must report 3.11 or newer
uv venv .venv --python 3.13
```

For `runtime.mode: external`, install the locked dependencies using the `runtime/requirements.lock` from the **DSH Vision Toolkit plugin** checkout, then point `runtime.agentVisionToolkitPath` at a separate exact `agent-vision-toolkit` snapshot. The packaged `vendor/agent-vision-toolkit` directory is such a snapshot when it has not been modified:

```sh
uv pip install --python .venv/bin/python \
  -r /absolute/path/to/dsh-vision-toolkit/runtime/requirements.lock
```

```yaml
- id: vision-toolkit
  config:
    runtime:
      mode: external
      python: /absolute/path/to/dsh-vision-toolkit/.venv/bin/python
      agentVisionToolkitPath: /absolute/path/to/dsh-vision-toolkit/vendor/agent-vision-toolkit
```

On Windows, use `py -3 --version` for the version check and `.venv\Scripts\python.exe` plus `runtime\requirements.lock` in the corresponding commands:

```powershell
py -3 --version                         # must report 3.11 or newer
uv venv .venv --python 3.13
# External mode only; use the plugin checkout's absolute lockfile path:
uv pip install --python .venv\Scripts\python.exe -r C:\absolute\path\to\dsh-vision-toolkit\runtime\requirements.lock
```

Point `runtime.python` at the same interpreter, save the Profile patch, and restart the Web Profile. Then open **Settings → Vision Toolkit**: the Runtime panel should show the resolved interpreter and Python version, and **Run health check** plus **Test vision model** should complete without the Python-version error. A final smoke test is to place a PNG/JPEG in the session workspace and call `vision_glance`.

## Updating the standalone Python mirror

The standalone Python is pinned in `assets/python-bootstrap.json` and mirrored at `https://dsh-vision-python-bootstrap-1317715800.cos.ap-guangzhou.myqcloud.com` (Tencent Cloud COS, `ap-guangzhou`). When upgrading the Python build, sync the mirror with:

```sh
node scripts/python-bootstrap.mjs --write   # fetch the latest GitHub release manifest
node scripts/python-bootstrap-mirror.mjs    # download and sha256-verify every platform archive
# run the coscmd publish command printed by the script to push .python-bootstrap-dist/<buildTag>/
```

After pushing, verify each mirror URL returns `206`/`200` and that `Content-Length` matches the `size` field in the manifest.

The mirror bucket is public-read; archives live at `https://dsh-vision-python-bootstrap-1317715800.cos.ap-guangzhou.myqcloud.com/<buildTag>/`.

## Allowed input directories

The path fence automatically allows the session workspace and the platform temporary directory. On macOS/Linux the temporary root is `/tmp`. On Windows it is `TEMP`, then `TMP`, with the operating-system fallback if neither is set; model-generated `/tmp/...` paths are translated to that Windows directory before the normal realpath fence runs. No `allowedDirs` entry is needed for these platform temporary paths.

Use `allowedDirs` only for additional trusted input roots outside the workspace and platform temporary directory:

```yaml
- id: vision-toolkit
  config:
    allowedDirs:
      # macOS/Linux example
      - /srv/vision-inputs
      # Windows example (use this instead on Windows)
      # - D:/vision-inputs
```

`allowedDirs` is an input allowlist, not the managed runtime cache. The managed runtime keeps its own files under `$DSH_HOME/cache/dsh-vision-toolkit` (or `~/.dsh/cache/dsh-vision-toolkit` when `DSH_HOME` is unset); that directory does not need to be added. Environment-variable forms such as `$env:TEMP` and `%TEMP%` are not expanded inside `allowedDirs`, so configure extra roots with real absolute paths.
