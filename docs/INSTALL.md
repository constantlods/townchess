# Installing and playing TownChess (beta)

## Requirements

- Windows 10/11, 64-bit, DirectX 12 GPU with Shader Model 6. Tested on an NVIDIA RTX 4070 Ti SUPER; the "Auto" graphics
  preset turns hardware ray tracing on where the GPU supports it and uses High otherwise.
- The Microsoft Visual C++ 2015-2022 runtime (x64). If the game reports a missing runtime, run
  `vc_redist.x64.exe` from Unreal Engine's `Engine\Extras\Redist\en-us` folder (or Microsoft's download) once.
- About 6 GB of disk space.

## Start

Run `TownChess.exe` in the build folder (on the build PC: `C:\TownChess\builds\Development\Windows\TownChess.exe`).
The game starts its own local chess core (a bundled Node.js process with the TownChess rules engine and Stockfish 19)
and closes it again when the game exits; nothing is installed system-wide and nothing listens on the network beyond
localhost.

## Playing

- **Menu (FIND A GAME):** Casual / Private Match / Join by Code / Play vs AI (White or Black), Find Match. Below it:
  Time Control, Strength (house levels and the Stockfish league), Opponent (the caged patient or the Annotator),
  Hands (bare, sleeves, watch), Settings.
- **Moving:** drag a piece onto its square, or click the piece and then the square. An illegal drop slides back.
  Promotion asks for the piece (Q/R/B/N keys work too; Escape cancels).
- **Mouse wheel:** raise or lower your seat view (higher = the board seen more from above).
- **Tab:** lift the game record clipboard (moves and the opening's name) and put it back.
- **Left list in play:** Offer Draw, Resign (click twice), Settings. After the game: Rematch (the board turns so you
  play the other colour), Leave Table.
- **Settings:** volume, graphics preset (Auto / Medium / High / Epic), view height. All settings are remembered.

## Known issues

See docs/KNOWN_LIMITATIONS.md for the full list with severities. In short: DLSS is not active unless NVIDIA's DLSS
plugin is installed into Unreal Engine 5.8; online play needs a TownChess server (local play and play against the
engine work offline); hand skins (dirty, scarred, tattooed) and gloves are not in yet.

## Licences

All third-party assets are free (CC0 Poly Haven scans, Epic's MetaHuman, OFL fonts); Stockfish 19 is GPL-3.0 and runs
as a separate program (its licence and source pointer ship next to it in `engines\`). docs/FREE_ASSETS.md lists every
asset and generator.
