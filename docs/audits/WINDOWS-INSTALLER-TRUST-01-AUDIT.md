# WINDOWS-INSTALLER-TRUST-01 — AUDIT

**Status:** audit-complete / implementation-ready  
**Date:** 2026-09-20  
**Worktree:** `D:\Projects\dm-discover-personal-feed-01`  
**Branch:** `build/discover-personal-feed-01`  
**HEAD at audit:** `62ed4b72ab881be9ba698335495c8005a981755c`  
**Rule:** no product code was written before this audit.

---

## 0. Packaging inventory

| Item | Current value | Source |
|---|---|---|
| electron-builder config | `electron-builder.yml` (canonical) + generated `electron-builder.brand.json` | `scripts/apply-brand.cjs` |
| package scripts | `build:packaged` → `scripts/build-packaged.cjs` | `package.json` |
| NSIS include | `electron/build-resources/installer.nsh` | `nsis.include` |
| afterPack | `scripts/after-pack-win-icon.cjs` (rcedit icon + version strings) | yml + brand json |
| afterSign | **none** | — |
| artifactBuildCompleted / beforeBuild | **none** | — |
| updater | **none** (no `electron-updater`, no squirrel delivery) | source search |
| appId | `local.digitalme.v2` | yml + `brands/tujimi/brand.json` |
| productName | `兔机米` | brand kit |
| executableName | **implicit** = productName → `兔机米.exe` | electron-builder default |
| publisherName | **not set** on NSIS/win; rcedit `CompanyName` = `organizationName` (`兔机米`) | afterPack |
| copyright | `兔机米` | yml |
| install directory | per-user `%LOCALAPPDATA%\Programs\digitalme-v2` (`package.json` `name`) | observed 360 path + electron-builder default |
| userData | `%APPDATA%\digitalme-v2` (`userDataDirName`) | brand kit |
| oneClick | `true` | nsis |
| perMachine | `false` | nsis |
| allowElevation | `false` | nsis |
| requestedExecutionLevel | **not set** (NSIS user-level, no UAC) | nsis |
| createDesktopShortcut | `always` | nsis (standard) |
| createStartMenuShortcut | `true` | nsis (standard) |
| shortcutName | `兔机米` | nsis |
| deleteAppDataOnUninstall | `false` | nsis |
| icon | `electron/build-resources/icon.ico` | brand kit |
| code signing | `win.signAndEditExecutable: false`; `CSC_IDENTITY_AUTO_DISCOVERY=false` | yml + `build-packaged.cjs` |
| signing env | no `CSC_LINK` / `WIN_CSC_*` / certificate file | packaging scripts |
| differential / nsisWeb | **none** (full NSIS + zip) | yml |

---

## 1. Current setup.exe signed?

**UNSIGNED** (by packaging config; no Authenticode hook exists).

Evidence:

- `win.signAndEditExecutable: false` — electron-builder does not invoke winCodeSign.
- `CSC_IDENTITY_AUTO_DISCOVERY: "false"` in `scripts/build-packaged.cjs`.
- No `afterSign`, no certificate file, no `publisherName` Authenticode identity.

`CODE_SIGNING_STATUS=UNSIGNED`

A live `Get-AuthenticodeSignature` on a newly built setup.exe is required after this audit’s trust-test Candidate (no existing `*-setup.exe` in-tree). Do not forge a signature. Do not use a self-signed cert as Public Alpha.

---

## 2. Current 兔机米.exe signed?

**UNSIGNED** (same reason). afterPack `rcedit` writes icon/version strings only; it is not Authenticode.

---

## 3. Does the installer itself invoke PowerShell?

**YES — product issue (case B).**

`electron/build-resources/installer.nsh`:

- `customInstall`: `ExecWait powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ...` creates Desktop + Start Menu `.lnk` via `WScript.Shell`.
- `customUnInstall`: same host, deletes those `.lnk` files.

This runs **inside setup.exe / uninstaller**, not from Owner’s test shell. `ExecWait` on `powershell.exe` without `-WindowStyle Hidden` produces a **visible PowerShell window**. `-ExecutionPolicy Bypass` is also a classic AV heuristic.

This is independent of whether the Owner launched setup.exe from PowerShell (`Start-Process`). Both can be true; **B is sufficient to explain a visible PowerShell during install**.

---

## 4. Does the installed app invoke PowerShell on first launch?

**NO for ordinary first start of Talk / Digital Self / Settings.**

- `electron/main.cjs`: no `powershell` / `pwsh` / `cmd.exe` spawn on boot.
- Capability acquisition for **Coding** (`src/capability/coding-runtime-candidates.ts` `defaultExtractZip`) does call `powershell.exe Expand-Archive` with `windowsHide: true`. That is **not** first-run of the empty app; it is out of this task’s Coding freeze. Recorded as: not a first-launch visible window; do not change in this task.

`electron/owner-scenario-env.cjs` uses `cmd.exe` for MCP test fixtures only — not packaged install path.

---

## 5. Why does install write/replace 兔机米.exe?

**Standard NSIS extract.** oneClick installer unpacks the app into `%LOCALAPPDATA%\Programs\digitalme-v2\`. On upgrade/reinstall, NSIS overwrites existing files including `兔机米.exe`.

360 “setup.exe 修改 …\兔机米.exe” matches this **single expected overwrite**, not a second custom copy.

Build-time extra: afterPack `rcedit` patches PE resources of `兔机米.exe` **before** NSIS packs it. That is packaging, not install-time. It can slightly raise unsigned-PE heuristics, but it is the current way to set ProductName/icon without winCodeSign (which needs symlink privilege). Keep rcedit; do not add a second install-time rewrite.

---

## 6. Duplicate copy/rename/overwrite of the exe?

**At install: NO extra custom copy.** One NSIS extract.

**At pack: YES once** — electron-builder writes the exe, then afterPack rcedit edits the same file. Necessary for brand metadata while `signAndEditExecutable: false`. Not an install-time duplicate.

**Shortcuts: YES duplicate intent** — electron-builder already has `createDesktopShortcut: always` and `createStartMenuShortcut: true`, **and** `installer.nsh` recreates the same links via PowerShell. The custom macros are redundant.

---

## 7. Are publisher / appId stable?

| Field | Stable across Candidates? | Notes |
|---|---|---|
| appId | **YES** `local.digitalme.v2` | brand kit + yml |
| productName | **YES** `兔机米` | brand kit |
| executableName | **implicit YES** (`兔机米.exe`) | not frozen in config; should be explicit |
| publisherName | **WEAK** | not in NSIS/win config; only rcedit CompanyName |
| install directory | **YES** `...\Programs\digitalme-v2` | from npm `name` |
| userData | **YES** `digitalme-v2` | `deleteAppDataOnUninstall: false` |

Do **not** change appId / productName / exe basename / install dir this round. Changing `executableName` to ASCII would break Windows reputation further.

Optional this round: set `win.publisherName` / explicit `win.executableName` to the **same current values** so they cannot drift.

---

## 8. Custom install logic that raises AV false-positive risk?

**YES:**

1. NSIS `ExecWait powershell.exe -ExecutionPolicy Bypass` during install/uninstall (visible window + script host).
2. Unsigned setup.exe + unsigned `兔机米.exe` (reputation).
3. afterPack PE resource edit (unsigned binary mutation at build).

Not present: Defender/360 policy changes, services, extra registry beyond NSIS uninstall keys, download-and-run, browser hijack, Run-key autostart.

---

## 9. Can electron-builder / NSIS standard features replace custom logic?

**YES. Delete the custom NSIS PowerShell.**

electron-builder 25 NSIS is Unicode. Standard options already configured:

- `createDesktopShortcut: always`
- `createStartMenuShortcut: true`
- `shortcutName: 兔机米`

The nsh comment (“CreateShortCut fails on non-ASCII `兔机米.exe`”) was a workaround for ANSI NSIS. It is not needed on top of the standard shortcut flags, and it is the root of the visible PowerShell.

**Keep:**

- per-user oneClick, `allowElevation: false`
- `deleteAppDataOnUninstall: false`
- afterPack rcedit (icon/version; no winCodeSign)
- unsigned packaging until a **purchased** Authenticode cert exists

**Do not:**

- self-sign
- hide PowerShell with `WindowStyle Hidden` while leaving Bypass in the installer
- whitelist or disable AV
- change identity fields

---

## PowerShell classification

| Case | Meaning | This product |
|---|---|---|
| A | Owner/test `Start-Process` from a PowerShell console | possible **TEST_LAUNCH_ARTIFACT** if testers launch setup that way; **not** the only cause |
| B | installer starts `powershell.exe` | **YES — `installer.nsh` customInstall/customUnInstall** |
| C | first-run app starts visible PowerShell | **NO** for ordinary boot |

**Root cause for historical visible PowerShell during Candidate install: B.** Fix by removing custom NSIS shell, not by hiding a window.

---

## Immediate vs certificate

**A. Can improve now**

- Remove `installer.nsh` PowerShell include.
- Rely on standard NSIS shortcuts.
- Explicit stable `executableName` + `publisherName` matching current identity.
- Keep per-user, no elevation.

**B. Requires a formal code-signing certificate**

- Authenticode on setup.exe and `兔机米.exe`
- SmartScreen / 360 “未知发布者” / low reputation

Even after A, unsigned publisher remains. Expected final engineering verdict if AV only complains about unknown publisher:

`INSTALLER_BEHAVIOR_ACCEPTED` + `PUBLIC_CODE_SIGNING_REQUIRED`

---

## Installer target shape

```
setup.exe
  → standard NSIS unpack
  → %LOCALAPPDATA%\Programs\digitalme-v2\
  → standard desktop + Start Menu shortcuts
  → done
```

No PowerShell, no extra copy of the exe, no UAC, no userData wipe.

---

## Privilege

Public Alpha: **per-user, no Administrator, no UAC.** Architecture does not need HKLM / services. Do not elevate for convenience.

---

## Regression constraints (do not touch)

Managed AI, Managed Web Discovery, SecretStore, Digital Self, Discover, zero-start capability acquisition, Coding. Uninstall must not delete `%APPDATA%\digitalme-v2` (SecretStore, trial principal via install token).

---

## Implementation (after audit)

Replaced `installer.nsh` PowerShell `ExecWait` with Unicode NSIS `CreateShortCut` / `Delete`. Frozen `win.executableName` and `win.publisherName` to current values `兔机米`. Did not self-sign. Did not change appId / productName / install directory / userDataDirName.

Upgrade from the previous Candidate still ran **old** `Uninstall 兔机米.exe` `customUnInstall` PowerShell once (baked into the already-installed uninstaller). New setup.exe itself spawned only electron-builder’s standard `cmd.exe tasklist` “is 兔机米.exe running” check — not PowerShell.

Clean install of the trust-test Candidate: Desktop + Start Menu `兔机米.lnk` both present. Uninstall of the post-fix uninstaller: no PowerShell child; `secrets.v2.json` / `subjects` remain.

---

## Trust-test Candidate gates (2026-09-20)

| Gate | Result |
|---|---|
| setup.exe Authenticode | NotSigned / UNSIGNED |
| 兔机米.exe Authenticode | NotSigned / UNSIGNED |
| Uninstall 兔机米.exe Authenticode | NotSigned |
| Defender RTP | enabled (not disabled) |
| Defender scan setup.exe | no threats |
| Defender scan installed 兔机米.exe | no threats |
| Defender install | PASS (setup exit 0, no threat detection) |
| Defender first launch | PASS (app ran; no threat detection) |
| 360 processes | 360rp / 360rps / 360sd / 360tray live; not disabled / not whitelisted |
| 360 install | WARN — install completed and was not quarantined; unsigned NSIS overwrite of `兔机米.exe` can still surface as 360 behavior/unknown-publisher (same class as historical “setup.exe 修改 兔机米.exe”); no AV settings changed |
| 360 first launch | PASS — process stayed up under 360 realtime |
| Visible PowerShell from **new** setup.exe | NO |
| Visible PowerShell from first-run 兔机米.exe | NO |
| Admin / UAC | NO |
| userData after uninstall | kept (`secrets.v2.json` exists) |

**Artifact (INSTALLER TRUST TEST, not Public Release)**

- source parent SHA: `62ed4b72ab881be9ba698335495c8005a981755c`
- buildId: `v2-tujimi-20260920T083535Z-62ed4b72`
- filename: `兔机米-0.2.0-public-alpha-win-x64-setup.exe`
- path: `D:\Projects\dm-discover-personal-feed-01\release-staging\v2-tujimi-20260920T083535Z-62ed4b72\兔机米-0.2.0-public-alpha-win-x64-setup.exe`
- size: `84123645` bytes
- SHA256: `559f353b69815983a56757f320d3bc89f125d454581081271161727ffd32873a`

`CODE_SIGNING_STATUS=UNSIGNED`  
`PUBLIC_CODE_SIGNING_REQUIRED` for SmartScreen / unknown publisher. Installer behavior is accepted.
