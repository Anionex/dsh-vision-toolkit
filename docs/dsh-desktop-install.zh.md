# DSH Desktop 安装与更新指南

本指南说明如何在 **DSH Desktop（桌面版）** 中安装、验证和更新 `dsh-vision-toolkit`。

> 为什么需要单独一份指南？DSH Desktop 自带 `dsh` 命令行，但**不会写入系统 PATH**。在系统终端（PowerShell、cmd、macOS 终端）里运行 `dsh` 会提示找不到命令，这是桌面版的设计行为，不是插件问题。请始终使用桌面版托盘提供的 **DSH 终端**。

## 1. 打开 DSH 终端

1. 找到系统托盘中的 **DSH Desktop** 图标（Windows 在右下角，macOS 在右上角菜单栏）。
2. **右键**图标，选择 **Open DSH Terminal**（或 **打开 DSH 终端**）。
3. 打开的终端里先确认环境可用：

```sh
dsh --version
```

能看到版本号就说明终端环境正常。如果提示找不到命令，请确认应用版本是 v2.0+，并完全退出桌面版后重新打开再试。

## 2. 安装插件

在 **DSH 终端** 中运行以下命令：

```sh
dsh plugin --profile desktop add @anionex/dsh-vision-toolkit@0.1.34
```

几点说明：

- `--profile desktop` 表示安装到桌面版默认的 `desktop` Profile；想装到 `web` Profile 时把 `desktop` 换成 `web`。
- **建议带精确版本号**（当前为 `0.1.34`）。DSH 1024Store 插件市场的目录数据有滞后，市场里一键安装可能装到旧版本；显式写版本号能确保装到最新版。
- 如果当前激活的 Profile 就是要装的 Profile，也可以省略 `--profile desktop`，直接运行 `dsh plugin add @anionex/dsh-vision-toolkit@0.1.34`。

## 3. 重启并验证

1. **完全退出 DSH Desktop**：托盘右键 → **退出**（关闭窗口只是隐藏，不算退出）。
2. 重新打开 DSH Desktop。
3. 进入 **设置 → 视觉工具**，点击 **测试视觉模型**，确认默认免费视觉服务可用。
4. 在会话中**粘贴一张图片直接提问**，或调用 `/vision-skills` 使用完整视觉工作流。

## 4. 更新到新版本

1. 在 [npm 页面](https://www.npmjs.com/package/@anionex/dsh-vision-toolkit) 查看最新版本号。
2. 在 **DSH 终端** 中，把安装命令里的版本号换成新版本后重新执行：

```sh
dsh plugin --profile desktop add @anionex/dsh-vision-toolkit@<新版本号>
```

3. 再次**完全退出并重启 DSH Desktop**，新版本才会生效。

如果当初安装时没有锁定精确版本，也可以使用官方更新命令 `dsh plugin update`，但精确版本安装（`@0.1.34` 这种写法）下请使用上面的显式版本号方式升级。

## 常见问题

| 问题 | 处理方式 |
| --- | --- |
| 系统终端里找不到 `dsh` 命令 | 正常。请从托盘打开 **DSH 终端**，不要用系统 PowerShell/cmd/终端 |
| 托盘菜单里没有 Open DSH Terminal | 确认应用是 v2.0+ 版本；v2 才开始提供该入口 |
| 内置插件市场安装失败，提示“无法确认操作结果” | DSH Desktop 2.0.1 的市场安装链路有已知问题，请改用本文的 DSH 终端命令安装 |
| 装完插件没生效 | 确认命令装到了正确的 Profile，并**完全退出后重启**桌面版 |
| 想装到 web Profile | 把命令中的 `desktop` 换成 `web`，重启桌面版后到 web Profile 使用 |

## 相关链接

- [项目主页](https://agent-vision.anionex.me)
- [npm 包](https://www.npmjs.com/package/@anionex/dsh-vision-toolkit)
- [DSH Desktop 用户指南](https://github.com/anywhere-labs/deepseek-harness-desktop/blob/master/docs/user-guide.md)
