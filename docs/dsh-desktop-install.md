# Installing and Updating dsh-vision-toolkit in DSH Desktop

This guide explains how to install, verify, and update `dsh-vision-toolkit` in **DSH Desktop**.

> Why a separate guide? DSH Desktop bundles its own `dsh` CLI but intentionally does **not** add it to the system PATH. Running `dsh` in a system shell (PowerShell, cmd, or the macOS Terminal) reports "command not found" by design — this is not a plugin issue. Always use the **DSH Terminal** opened from the desktop tray.

## 1. Open the DSH Terminal

1. Find the **DSH Desktop** icon in the system tray (bottom-right on Windows, top-right menu bar on macOS).
2. **Right-click** the icon and choose **Open DSH Terminal**.
3. Verify the environment in the opened terminal:

```sh
dsh --version
```

If the version prints, the terminal environment is ready. If the command is not found, make sure the app is v2.0+ and try fully quitting and relaunching DSH Desktop first.

## 2. Install the plugin

Run the following command in the **DSH Terminal**:

```sh
dsh plugin --profile desktop add @anionex/dsh-vision-toolkit@0.1.34
```

Notes:

- `--profile desktop` targets the default `desktop` profile; replace `desktop` with `web` to install into a `web` profile.
- **Pin an exact version** (currently `0.1.34`). The DSH 1024Store marketplace catalog lags behind npm, so a one-click marketplace install can land on an older version; an explicit version guarantees the latest release.
- If the active profile is already the target profile, you can omit `--profile desktop` and run `dsh plugin add @anionex/dsh-vision-toolkit@0.1.34` directly.

## 3. Restart and verify

1. **Fully quit DSH Desktop**: right-click the tray icon → **Quit** (closing the window only hides it).
2. Reopen DSH Desktop.
3. Open **Settings → Vision Toolkit** and click **Test vision model** to confirm the built-in free vision service works.
4. Paste an image into the conversation and ask directly, or invoke `/vision-skills` for the full vision workflow.

## 4. Update to a new version

1. Check the latest version on the [npm page](https://www.npmjs.com/package/@anionex/dsh-vision-toolkit).
2. In the **DSH Terminal**, rerun the install command with the new version:

```sh
dsh plugin --profile desktop add @anionex/dsh-vision-toolkit@<new-version>
```

3. **Fully quit and reopen DSH Desktop** so the new version takes effect.

If you installed without pinning an exact version, the official `dsh plugin update` command also works; with a pinned version such as `@0.1.34`, use the explicit-version command above.

## Troubleshooting

| Problem | What to do |
| --- | --- |
| `dsh` is not recognized in a system shell | Expected. Open **DSH Terminal** from the tray instead of using system PowerShell/cmd/Terminal |
| No Open DSH Terminal in the tray menu | Make sure the app is v2.0+; this entry exists only in v2 and later |
| The built-in marketplace fails with "cannot confirm the operation result" | DSH Desktop 2.0.1 has known marketplace install issues; use the DSH Terminal command in this guide instead |
| Plugin does not show up after install | Confirm the command targeted the right profile and **fully quit and restart** DSH Desktop |
| Want to install into the web profile | Replace `desktop` with `web` in the command, then restart DSH Desktop and switch to the web profile |

## Links

- [Project website](https://agent-vision.anionex.me)
- [npm package](https://www.npmjs.com/package/@anionex/dsh-vision-toolkit)
- [DSH Desktop user guide](https://github.com/anywhere-labs/deepseek-harness-desktop/blob/master/docs/user-guide.en.md)
