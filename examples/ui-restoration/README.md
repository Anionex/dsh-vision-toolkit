# UI restoration example

English | [中文](README.zh.md)

This example is a deterministic, keyless proof that DSH Vision Toolkit can close a local UI-restoration loop through its real runtime. It renders a reference page, an intentionally inaccurate first implementation, and the final implementation with `vision_html_screenshot`; it then evaluates both candidates with `vision_pixel_diff` and enforces numeric acceptance thresholds.

## Flow

1. `tests/fixtures/ui-restoration-reference.html` is copied into a temporary workspace as the reference source.
2. `initial.html` and `implementation.html` are copied into the same workspace.
3. The runtime renders all three local files at `1200 × 720` and scale `1` through the pinned Chrome-family adapter.
4. The runtime compares the initial and final screenshots against the reference with an `8 × 8` grid and six ranked regions.
5. Check mode verifies the committed evidence; write mode replaces it only after the initial and final thresholds pass.

The runner uses the package's `VisionToolkitRuntime` and `UpstreamAdapter`, not a separate screenshot or image-diff implementation. It requires Python with Pillow and NumPy plus Chrome, Chromium, or Edge; it does not require a vision-service Credential.

## Inputs and evidence

| Path | Role |
|---|---|
| `initial.html` | Deliberately inaccurate reconstruction used to prove the comparison detects meaningful drift |
| `implementation.html` | Final reconstruction expected to match the reference |
| `assets/reference.png` | Browser-rendered reference image |
| `assets/initial.png` | Browser-rendered initial reconstruction |
| `assets/initial-heatmap.png` | Pixel-difference heatmap for the initial reconstruction |
| `assets/initial-report.json` | Portable initial comparison report with relative image paths |
| `assets/implementation.png` | Browser-rendered final reconstruction |
| `assets/final-heatmap.png` | Pixel-difference heatmap for the final reconstruction |
| `assets/final-report.json` | Portable final comparison report with relative image paths |
| `assets/metrics.json` | Stable viewport and acceptance metrics used by check mode |

![Reference](assets/reference.png)

![Initial reconstruction](assets/initial.png)

![Final reconstruction](assets/implementation.png)

## Run

From `dsh-vision-toolkit/`:

```sh
npm run example:ui-restoration
```

The command prints a structured result and exits non-zero when the environment, checked-in assets, or thresholds do not match the contract. The committed metrics are:

```json
{
  "initialDifferencePct": 6.04,
  "finalDifferencePct": 0,
  "initialWorstRegions": 6,
  "finalWorstRegions": 0
}
```

The initial comparison must remain at least `1%` different so the example cannot pass with two equivalent fixtures. The final comparison must remain at or below `0.02%`, and the committed evidence currently records an exact `0%` difference.

## Refresh evidence

Run write mode only when intentionally changing the reference, reconstruction, viewport, renderer contract, or expected artifacts:

```sh
npm run example:ui-restoration:write
npm run example:ui-restoration
```

Write mode renders into a temporary workspace, validates the thresholds, copies the approved PNGs and reports into `assets/`, rewrites report paths to portable relative paths, and updates `metrics.json`. The following check-mode run is the required confirmation that the committed package can reproduce the refreshed evidence.

The automated regression test is `tests/ui-restoration-example.spec.ts`; the macOS Chrome keychain/profile isolation contract is independently covered by `tests/html-screenshot-guard.spec.ts`.
