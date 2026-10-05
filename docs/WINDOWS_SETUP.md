# Windows development PC: setup log

This is the record of every change made on the owner's Windows PC for TownChess, as the owner's directive requires. The
machine's address and account are deliberately not recorded here: the repository is public.

## Machine (read-only inventory, 2026-10-03)

| | |
| --- | --- |
| OS | Windows 11 Pro, build 26200 |
| CPU | AMD Ryzen 9 7900X, 12 cores / 24 threads |
| RAM | 31 GB |
| GPU | NVIDIA GeForce RTX 4070 Ti SUPER, 16 GB, driver 616.64. There is also integrated AMD Radeon graphics, which UE must not select |
| Disk | C: 272 GB free of 931 GB; D: 69 GB free of 467 GB |
| Present before setup | Git 2.55, Python 3.12, Epic Games Launcher |

## Changes, in order

| # | Change | Done by | Why | How to undo |
| --- | --- | --- | --- | --- |
| 1 | OpenSSH Server enabled; firewall rule `TownChess-SSH-In` (TCP 22, only from the Proxmox host and the render VM) | Owner | Remote builds and tests from Proxmox | `Remove-NetFirewallRule -Name TownChess-SSH-In; Stop-Service sshd; Set-Service sshd -StartupType Manual` |
| 2 | A key pair generated **on Proxmox**; only the public key installed in `C:\ProgramData\ssh\administrators_authorized_keys`. A key that had been exposed in chat was replaced and deleted on the Proxmox side | Owner (install), agent (key generation) | Key-only authentication | Remove the line from that file |
| 3 | Workspace `C:\TownChess` with a clone of the repository (`C:\TownChess\townchess`) and logs in `C:\TownChess\logs` | Agent | Dedicated workspace; nothing outside it is used | Delete `C:\TownChess` |
| 4 | Node.js LTS (24.19.0) via `winget install OpenJS.NodeJS.LTS` | Agent (approved) | Runs the TownChess core: tests, server, core bundle | `winget uninstall OpenJS.NodeJS.LTS` |
| 5 | Visual Studio Community 2022 17.14 via winget, with the components UE 5.8 lists in `Engine/Config/Windows/Windows_SDK.json`: game dev with C++, desktop C++, .NET desktop, Windows 11 SDK 10.0.22621, Clang, UE IDE/debugger integration, MSVC 14.44 x64 and ATL. Installed silently with `--norestart` | Agent (approved) | UE C++ compilation and Windows packaging | Visual Studio Installer → Uninstall, or `winget uninstall Microsoft.VisualStudio.2022.Community` |
| 6 | Update attempt (`setup.exe update --quiet --norestart`). It exited 87 (an argument-quoting error) and changed nothing. Not needed: winget had already installed the latest 17.14.41 (September 2026) | Agent | The MSVC folder is named `14.44.35207`, which UE 5.8 bans. The actual `cl.exe` is 19.44.35229 (product 14.44.35229), which includes the 14.44.35211 fix; servicing updates kept the old folder name | — |
| 7 | Unreal Engine 5.8.3 through the Epic Games Launcher | Owner | Prebuilt engine; needs the owner's Epic sign-in | Remove it in the Launcher |
| 9 | Visual C++ redistributable 14.50 (from UE's own `Engine\Extras\Redist\en-us\vc_redist.x64.exe`), so the packaged game's launcher stub stops reporting a missing runtime | Owner | UE 5.8 requires 14.50+; the PC had 14.44 registered | Settings > Apps > Microsoft Visual C++ v14 Redistributable (x64) > Uninstall |
| 10 | MetaHuman Creator plugin enabled in `TownChess.uproject`; MetaHuman Creator Core Data (about 6 GB of presets, grooms, clothing, texture models) installed through the Epic Games Launcher | Owner (launcher), agent (project file) | The MetaHuman opponent | Launcher > Library > 5.8 > Options > untick Core Data; remove the plugin line from the .uproject |
| 11 | Signed in to Epic inside the editor for MetaHuman cloud auto-rigging and texture synthesis | Owner | Required by MetaHuman Creator's cloud steps; a headless editor over SSH cannot complete this login | Sign out in the editor / revoke at epicgames.com > Account > Apps |
| 12 | Owner's reference image placed at `C:\TownChess\reference picture.png`; screenshots in `C:\TownChess\shots` | Owner / agent | Visual comparison loop | Delete the files |
| 13 | A copy of the project, `ue5\TownChess 5.8 - 2 5.8\`, was created by the launcher when the owner opened the project; its MetaHuman was copied into the real project and the copy was deleted with the owner's approval (2026-10-04) | Launcher, agent (deletion) | — | — |
| 14 | The editor enabled the `Reflex` and `OptiXDenoise` plugins in the local `TownChess.uproject` (and wrote two GPU-skin cvars and an Android file-server block into `DefaultEngine.ini`). OptiXDenoise crashed the packaged game at startup (missing OptiX DLL), so the committed project now lists it as disabled; Reflex and the cvars were kept. The local edits were discarded with `git checkout` (their content is in the commit, minus the Android block and its local token) | Owner (editor) / agent | Packaged game must start | Set `OptiXDenoise` back to `true` in `TownChess.uproject` (not recommended) |
| 8 | Packaged builds written to `C:\TownChess\builds`, Poly Haven assets to `C:\TownChess\assets` (inside the workspace). Defender was only queried (`Get-MpComputerStatus`, `Get-MpThreatDetection`), never changed | Agent | Packaging and the antivirus check | Delete those folders |

**Incident (2026-10-04):** while locating which project the open editor had loaded, the agent printed the editor's
full command line, which contains a one-time Epic login exchange code (`-AUTH_PASSWORD`), and listed
`%LOCALAPPDATA%\UnrealEngine\5.8\Saved\Logs` (outside the workspace). The code is in the local session transcript on
the Proxmox side only; it is not in the repository or its history. Process queries are now limited to the executable
path, never the command line.

Nothing else on the system was changed. The PC is never rebooted, and no system settings, other users or security
software were touched.

## Toolchain requirements (from UE 5.8.3 `Windows_SDK.json`)

- **MSVC:** 14.44.35211 or newer (VS 2022 17.14), or 14.50.35723 or newer (VS 2026). 14.44.0–14.44.35210 and
  14.40–14.43 are banned.
- **Windows SDK:** 10.0.22621 preferred; 10.0.19041 minimum.
