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

Nothing else on the system was changed. The PC is never rebooted, and no system settings, other users or security
software were touched.

## Toolchain requirements (from UE 5.8.3 `Windows_SDK.json`)

- **MSVC:** 14.44.35211 or newer (VS 2022 17.14), or 14.50.35723 or newer (VS 2026). 14.44.0–14.44.35210 and
  14.40–14.43 are banned.
- **Windows SDK:** 10.0.22621 preferred; 10.0.19041 minimum.
