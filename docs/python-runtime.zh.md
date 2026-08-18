# 配置 Python 运行时

默认情况下插件会自动选择系统 Python 3.11+，找不到时下载托管 Python，普通用户无需配置本节。以下内容供自动发现失败、需要固定版本或使用外部运行时的高级场景参考。

打包的 `managed` 运行时会创建自己的隔离虚拟环境。`runtime.python` 指定的是引导或刷新该环境时使用的 Python 解释器，并不会把 managed 运行时替换成系统解释器的全局 site-packages。当自动发现失败或机器上有多个 Python 时，应设置这个选项；`runtime.mode: external` 也使用该覆盖值。

要求 Python 3.11 或更高版本；自动下载的托管 Python 为 3.13.15，与系统 Python 一样只用于引导隔离环境。不设置覆盖值时，插件在 macOS/Linux 上依次尝试 `python3`、`python`，在 Windows 上依次尝试 `python`、`py -3`、`python3`，全部不可用时会自动下载托管 Python。手动配置的值会作为一个可执行文件名或路径传入，而不是作为带参数的 Shell 命令，因此 Windows 启动器应填写 `py`（不要填写 `py -3`）；需要固定版本时，请填写绝对路径。

在 Profile patch 中配置：

```yaml
- id: vision-toolkit
  config:
    runtime:
      # macOS/Linux 系统 Python
      python: python3
      # 或使用项目内虚拟环境：
      # python: /absolute/path/to/project/.venv/bin/python
      # Windows 虚拟环境（YAML 中也可以使用正斜杠）：
      # python: C:/Users/you/project/.venv/Scripts/python.exe
      # Windows 启动器；其默认 Python 必须是 3.11+：
      # python: py
```

对于 managed 运行时，创建项目内解释器并将 `runtime.python` 指向它即可。插件会把锁定依赖安装到自己的 managed 缓存中，因此将 lockfile 安装到这个引导环境是可选的：

```sh
python3 --version                         # 必须是 3.11 或更高
uv venv .venv --python 3.13
```

对于 `runtime.mode: external`，请使用 **DSH Vision Toolkit 插件** checkout 中的 `runtime/requirements.lock` 安装锁定依赖，再把 `runtime.agentVisionToolkitPath` 指向另一个准确的 `agent-vision-toolkit` 快照。未被修改的打包目录 `vendor/agent-vision-toolkit` 就是这样的快照：

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

Windows 请使用 `py -3 --version` 检查版本，并在对应命令中使用 `.venv\Scripts\python.exe` 和 `runtime\requirements.lock`：

```powershell
py -3 --version                         # 必须是 3.11 或更高
uv venv .venv --python 3.13
# 仅 external 模式需要；请使用插件 checkout 中 lockfile 的绝对路径：
uv pip install --python .venv\Scripts\python.exe -r C:\absolute\path\to\dsh-vision-toolkit\runtime\requirements.lock
```

把 `runtime.python` 指向同一个解释器，保存 Profile patch 后重启 Web Profile。然后打开 **设置 → 视觉工具**：运行时面板应显示实际使用的解释器和 Python 版本；点击 **运行健康检查** 和 **测试视觉模型**，确认不再出现 Python 版本错误。最后可将一张 PNG/JPEG 放入会话工作区并调用 `vision_glance` 做冒烟测试。

## 允许读取的输入目录

路径围栏会自动允许会话工作区和平台临时目录。macOS/Linux 的临时目录根路径是 `/tmp`。Windows 依次读取 `TEMP`、`TMP`，两者都未设置时使用操作系统回退值；模型生成的 `/tmp/...` 路径会先映射到该 Windows 临时目录，再执行常规 realpath 路径围栏检查。这些平台临时路径无需加入 `allowedDirs`。

只有在需要读取会话工作区和平台临时目录之外的可信输入根目录时，才配置 `allowedDirs`：

```yaml
- id: vision-toolkit
  config:
    allowedDirs:
      # macOS/Linux 示例
      - /srv/vision-inputs
      # Windows 示例（Windows 上改用这一项）
      # - D:/vision-inputs
```

`allowedDirs` 是输入目录白名单，不是 managed 运行时缓存目录。managed 运行时自己的文件位于 `$DSH_HOME/cache/dsh-vision-toolkit`（未设置 `DSH_HOME` 时是 `~/.dsh/cache/dsh-vision-toolkit`），无需加入白名单。`allowedDirs` 内不会展开 `$env:TEMP` 或 `%TEMP%` 这类环境变量，因此额外输入根目录必须填写真实绝对路径。
