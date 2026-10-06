"""In-game automation for the TownChess UE5 client (runs inside an uncooked -game session).

    UnrealEditor TownChess.uproject -game -RenderOffscreen -tcauto=cpu:novice:w:untimed \
        -ExecCmds="py <abs>/Scripts/autotest.py" -TCTest=cpu -TCOut=<dir>

Drives the real client through the same entry points the mouse uses (ATCBoard.click_square, HUD buttons) and checks,
after every authoritative change, that the board shows exactly the core's position. Results go to the log as
`[TCTEST] ...` lines and to <TCOut>/result.json.

Scenarios (-TCTest=):
  cpu        rejection test, then a full game against the core's engine (move policy prefers special moves)
  script     plays the moves listed in -TCMoves=uci,uci,... for our side (the other side is a scripted browser or the
             engine), checking sync after every move; used for the special-rules game against a browser opponent
  reconnect  joins the active game after a restart and verifies the rebuilt board, turn and clocks, then plays on
  drag       drag and drop with the board API the mouse uses: an illegal drop snaps back; a legal drop is accepted
  keys       keyboard paths through the real key handler: Tab raises and lowers the clipboard; on the menu, "Join by Code"
             takes typed letters, BackSpace and Escape (promotion keys need a start-position option in the core: not yet)
  promo      from a set position (-tcstartfen, -tcallowstartfen): drag a pawn to the last rank and press Escape (it must
             go home, BUG-008), then drag again and press Q (queen promotion accepted, every piece on its square)
  rematch    resigns the first game and asks for a rematch: the new game must seat us on the other colour, and the
             board, camera and seat-mirrored props must follow by themselves ("the board flips between games")
"""
import json
import os
import time

import unreal


def arg(name, default=""):
    import shlex
    try:
        toks = shlex.split(unreal.SystemLibrary.get_command_line(), posix=False)
    except ValueError:
        toks = unreal.SystemLibrary.get_command_line().split()
    for tok in (t.strip('"') for t in toks):
        if tok.lower().startswith(f"-{name.lower()}="):
            return tok.split("=", 1)[1]
    return default


TEST = arg("TCTest", "cpu")
OUT = arg("TCOut", "/tmp/tctest")
MOVES = [m for m in arg("TCMoves", "").split(",") if m]
MAX_PLIES = int(arg("TCMaxPlies", "300"))
ACCEPT_DRAW = arg("TCAcceptDraw", "") == "1"
KILL_AT_PLY = int(arg("TCKillAtPly", "0"))  # simulate a hard crash (SIGKILL) once the game reaches this ply
IDLE_AFTER_PLY = int(arg("TCIdleAfterPly", "0"))  # stop moving from this ply on (clock / flag-fall test)
EXPECT_TERMINATION = arg("TCExpectTermination", "")  # e.g. checkmate, timeout, agreement, stalemate, resignation
EXPECT_WINNER = arg("TCExpectWinner", "")  # w, b, or "none"
EXPECT_PLY = int(arg("TCExpectPly", "-1"))  # reconnect: the ply the game had when the client was killed
EXPECT_FEN = arg("TCExpectFen", "").replace("_", " ")  # reconnect: the position at the kill (spaces as underscores)
os.makedirs(OUT, exist_ok=True)

R = {"test": TEST, "checks": [], "pass": None, "moves": [], "features": {}, "screens": []}
S = {"phase": "boot", "t0": time.time(), "wait_until": 0.0, "last_len": -1, "anim_before": 0, "frames": 0,
     "deadline": time.time() + float(arg("TCTimeout", "900")), "shots": 0, "script_i": 0, "rej_before": 0}


def log(msg):
    unreal.log(f"[TCTEST] {msg}")


def check(name, ok, detail=""):
    R["checks"].append({"name": name, "ok": bool(ok), "detail": str(detail)})
    log(f"{'PASS' if ok else 'FAIL'} {name} {detail}")
    return ok


def world():
    for pcm in unreal.ObjectIterator(unreal.PlayerCameraManager):
        try:
            if pcm.get_world() is not None:
                return pcm.get_world(), pcm
        except Exception:
            pass
    return None, None


def objs():
    w, pcm = world()
    if not w:
        return None, None, None, None
    # game-instance subsystems are plain UObjects: take the live instance (skip the class default object)
    core = next((o for o in unreal.ObjectIterator(unreal.TCCoreClient) if not o.get_name().startswith("Default__")), None)
    board = unreal.GameplayStatics.get_actor_of_class(w, unreal.TCBoard)
    return w, pcm, core, board


def screenshot(tag):
    """-RenderOffscreen never reads the viewport back; render the player view through the level's ShotCapture."""
    try:
        w, pcm, _, _ = objs()
        caps = unreal.GameplayStatics.get_all_actors_of_class(w, unreal.SceneCapture2D)
        if not caps:
            return
        cap = caps[0]
        rt = unreal.RenderingLibrary.create_render_target2d(w, 1920, 1080, unreal.TextureRenderTargetFormat.RTF_RGBA8_SRGB)
        cap.set_actor_location_and_rotation(pcm.get_camera_location(), pcm.get_camera_rotation(), False, True)
        cc = cap.capture_component2d
        cc.set_editor_property("fov_angle", pcm.get_fov_angle())
        cc.set_editor_property("texture_target", rt)
        cc.set_editor_property("capture_every_frame", True)
        S["pending_shot"] = (w, rt, f"{S['shots']:02d}-{tag}.png", time.time() + 1.5)
        S["shots"] += 1
    except Exception as e:
        log(f"screenshot failed: {e}")


def flush_shot():
    p = S.get("pending_shot")
    if p and time.time() >= p[3]:
        w, rt, name, _ = p
        unreal.RenderingLibrary.export_render_target(w, rt, OUT, name)
        R["screens"].append(name)
        S["pending_shot"] = None


PRIORITY = ("promotion", "castle", "en_passant", "check", "capture")


def choose(core, board):
    """Pick a move for our side from the core's legal moves; prefer moves that exercise special rules."""
    st = core.get_state()
    legal = list(st.legal_moves)
    layout = board.get_shown_layout()
    mine = core.get_my_color()

    def score(m):
        frm, to = m[:2], m[2:4]
        code = layout.get(frm, "")
        s = 0
        if len(m) == 5:
            s += 100
        if code.endswith("k") and abs(ord(frm[0]) - ord(to[0])) == 2:
            s += 80
        if code.endswith("p") and frm[0] != to[0] and to not in layout:
            s += 70  # en passant
        if to in layout and not layout[to].startswith(mine):
            s += 20
        return s
    legal.sort(key=lambda m: (-score(m), m))
    return legal[0] if legal else None


def note_features(st):
    for e in st.last_events:
        R["features"][e.type] = R["features"].get(e.type, 0) + 1


def finish(ok):
    R["pass"] = bool(ok) and all(c["ok"] for c in R["checks"])
    with open(os.path.join(OUT, "result.json"), "w") as f:
        json.dump(R, f, indent=2)
    log(f"RESULT {'PASS' if R['pass'] else 'FAIL'} ({sum(c['ok'] for c in R['checks'])}/{len(R['checks'])} checks)")
    S["phase"] = "quit"
    S["wait_until"] = time.time() + 2.0


def tick(_dt):
    try:
        _tick(_dt)
    except Exception as e:  # a driver bug must fail the run, not loop forever
        import traceback
        check("driver error", False, f"{e}: {traceback.format_exc()[-400:]}")
        finish(False)


def _tick(_dt):
    S["frames"] += 1
    now = time.time()
    flush_shot()
    if now < S["wait_until"]:
        return
    if S["phase"] == "quit":
        if not S.get("pending_shot"):
            unreal.SystemLibrary.execute_console_command(None, "quit")
        return
    if now > S["deadline"]:
        check("scenario finished before timeout", False, S["phase"])
        finish(False)
        return
    w, pcm, core, board = objs()
    if not core or not board:
        return
    st = core.get_state()

    if TEST == "observe":
        # real-input test support: publish where every square is on screen; the mouse is driven from outside (xdotool)
        if core.has_game() and st.status == "active" and not board.is_animating() and now - S.get("squares_at", 0) > 2:
            pc = unreal.GameplayStatics.get_player_controller(w, 0)
            pos = {}
            for f in "abcdefgh":
                for r in "12345678":
                    ok, xy = unreal.GameplayStatics.project_world_to_screen(pc, board.square_world(f + r) + unreal.Vector(0, 0, board.surface_z() - board.get_actor_location().z), False)
                    if ok:
                        pos[f + r] = [round(xy.x), round(xy.y)]
            state = {"squares": pos, "fen": st.fen, "plies": len(st.history), "turn": st.turn, "selected": board.get_selected(),
                     "awaiting": board.is_awaiting_core(), "status": st.status, "buttons": list(pc.get_hud().get_visible_buttons())}
            with open(os.path.join(OUT, "observe.json"), "w") as f:
                json.dump(state, f)
            S["squares_at"] = now
        elif not core.has_game():
            pc = unreal.GameplayStatics.get_player_controller(w, 0)
            with open(os.path.join(OUT, "observe.json"), "w") as f:
                json.dump({"menu": True, "buttons": list(pc.get_hud().get_visible_buttons())}, f)
        return

    if S["phase"] == "boot":
        if core.has_game() and st.status == "waiting" and not S.get("code_written"):
            # private table: publish the code so the opponent (browser) can join
            with open(os.path.join(OUT, "code.txt"), "w") as f:
                f.write(st.id)
            S["code_written"] = True
            log(f"table code {st.id}")
        if core.has_game() and st.status == "active" and not board.is_animating():
            check("connected, authenticated and joined a game", True, f"{st.id} as {core.get_my_color()}")
            check("board built from authoritative FEN", board.is_in_sync(), st.fen)
            screenshot("start")
            S["phase"] = {"cpu": "reject", "reconnect": "verify_reconnect", "rematch": "rematch_resign", "drag": "drag_illegal", "keys": "keys_tab", "promo": "promo_cancel"}.get(TEST, "play")
            S["wait_until"] = now + 1.0
        return

    if S["phase"] == "reject":
        # illegal request straight to the core (the board UI never offers it): must be refused, board unchanged
        if not core.is_my_turn():
            return
        S["layout_before"] = dict(board.get_shown_layout())
        S["anim_before"] = board.get_animated_moves()
        S["rej_before"] = core.get_rejected_count()
        S["len_before"] = len(st.history)
        frm, to = ("e2", "e5") if core.get_my_color() == "w" else ("e7", "e4")
        core.submit_move(frm, to, "")
        S["phase"] = "reject_wait"
        S["wait_until"] = now + 1.5
        return

    if S["phase"] == "reject_wait":
        check("illegal move rejected by the core", core.get_rejected_count() == S["rej_before"] + 1, core.get_last_rejection())
        check("rejected move was not animated", board.get_animated_moves() == S["anim_before"])
        check("board unchanged after rejection", dict(board.get_shown_layout()) == S["layout_before"] and board.is_in_sync())
        check("history unchanged after rejection", len(core.get_state().history) == S["len_before"])
        S["phase"] = "play"
        return

    if S["phase"] == "drag_illegal":
        # drag a pawn to an illegal square and drop it: nothing may change, the piece snaps back
        if not core.is_my_turn() or board.is_animating():
            return
        S["layout_before"] = dict(board.get_shown_layout())
        S["plies_before"] = len(st.history)
        frm = "e2" if core.get_my_color() == "w" else "e7"
        check("drag starts on an own piece", board.begin_drag(frm))
        board.update_drag(board.square_world("e5"))
        board.end_drag("e5")
        S["phase"] = "drag_illegal_wait"
        S["wait_until"] = now + 1.0
        return

    if S["phase"] == "drag_illegal_wait":
        check("illegal drop changed nothing", dict(board.get_shown_layout()) == S["layout_before"] and len(st.history) == S["plies_before"])
        check("dropped piece snapped back to its square", board.get_physical_mismatches() == 0 and not board.is_dragging())
        frm, to = ("e2", "e4") if core.get_my_color() == "w" else ("e7", "e5")
        S["drag_move"] = (frm, to)
        board.begin_drag(frm)
        board.update_drag(board.square_world(to) + unreal.Vector(1.2, -0.8, 0))  # dropped slightly off-centre, like a hand
        S["result"] = board.end_drag(to)
        S["phase"] = "drag_legal_wait"
        S["wait_until"] = now + 2.0
        return

    if S["phase"] == "drag_legal_wait":
        if board.is_animating() or board.is_awaiting_core():
            return
        frm, to = S["drag_move"]
        check("legal drop sent the move", "submitted" in str(S["result"]).lower(), S["result"])
        mine = [h for h in st.history if h.color == core.get_my_color()]
        check("core accepted the dropped move", len(st.history) > S["plies_before"] and mine and mine[-1].to == to, st.fen)
        check("dropped piece settled exactly on its square, board in sync", board.is_in_sync() and board.get_physical_mismatches() == 0 and board.get_resyncs() == 0)
        finish(True)
        return

    if S["phase"] == "keys_tab":
        pc = unreal.GameplayStatics.get_player_controller(w, 0)
        clip = next(iter(unreal.GameplayStatics.get_all_actors_of_class(w, unreal.TCClipboard)), None)
        check("level has the game-record clipboard", clip is not None)
        if not clip:
            finish(False)
            return
        S["clip_before"] = clip.is_raised()
        pc.press_key_for_test("Tab")
        S["phase"] = "keys_tab_up"
        S["wait_until"] = now + 1.0
        return

    if S["phase"] == "keys_tab_up":
        pc = unreal.GameplayStatics.get_player_controller(w, 0)
        clip = unreal.GameplayStatics.get_all_actors_of_class(w, unreal.TCClipboard)[0]
        check("Tab raises the clipboard", clip.is_raised() != S["clip_before"] and clip.is_raised())
        pc.press_key_for_test("Tab")
        S["phase"] = "keys_tab_down"
        S["wait_until"] = now + 1.0
        return

    if S["phase"] == "keys_tab_down":
        clip = unreal.GameplayStatics.get_all_actors_of_class(w, unreal.TCClipboard)[0]
        check("Tab again puts it back", not clip.is_raised())
        core.resign()
        S["phase"] = "keys_leave"
        S["wait_until"] = now + 1.5
        return

    if S["phase"] == "keys_leave":
        core.leave_game()
        S["phase"] = "keys_join"
        S["wait_until"] = now + 1.0
        return

    if S["phase"] == "keys_join":
        pc = unreal.GameplayStatics.get_player_controller(w, 0)
        hud = pc.get_hud()
        check("menu shows Join by Code", "join" in list(hud.get_visible_buttons()), list(hud.get_visible_buttons()))
        hud.press_button("join")
        check("Join by Code starts code entry", pc.get_editor_property("typing_code") and pc.get_editor_property("join_code") == "GAME-")
        for k in ("A", "B", "One"):
            pc.press_key_for_test(k)
        code = pc.get_editor_property("join_code")
        check("typed keys appear in the code", code == "GAME-AB1", code)
        pc.press_key_for_test("BackSpace")
        check("BackSpace removes the last character", pc.get_editor_property("join_code") == "GAME-AB", pc.get_editor_property("join_code"))
        pc.press_key_for_test("Escape")
        check("Escape ends code entry", not pc.get_editor_property("typing_code"))
        # settings panel: opens from the menu, cycles the volume (remembered by the game mode), closes
        gm = unreal.GameplayStatics.get_game_mode(w)
        hud.press_button("settings")
        S["vol_before"] = gm.get_volume()
        S["phase"] = "keys_settings"
        S["wait_until"] = now + 0.5
        return

    if S["phase"] == "keys_settings":
        pc = unreal.GameplayStatics.get_player_controller(w, 0)
        hud = pc.get_hud()
        gm = unreal.GameplayStatics.get_game_mode(w)
        btns = list(hud.get_visible_buttons())
        check("Settings opens the panel", all(b in btns for b in ("set_vol", "set_quality", "set_view", "set_close")), btns)
        hud.press_button("set_vol")
        check("Volume cycles", abs(gm.get_volume() - S["vol_before"]) > 0.01, f"{S['vol_before']} -> {gm.get_volume()}")
        hud.press_button("set_vol")
        hud.press_button("set_vol")
        hud.press_button("set_vol")
        hud.press_button("set_vol")  # full cycle (5 steps) back to where it was
        hud.press_button("set_close")
        S["phase"] = "keys_settings_closed"
        S["wait_until"] = now + 0.5
        return

    if S["phase"] == "keys_settings_closed":
        pc = unreal.GameplayStatics.get_player_controller(w, 0)
        btns = list(pc.get_hud().get_visible_buttons())
        check("Close hides the panel", "set_vol" not in btns, btns)
        finish(True)
        return

    if S["phase"] == "promo_cancel":
        if not core.is_my_turn() or board.is_animating():
            return
        check("set position has a promotion", any(m.startswith("e7e8") for m in st.legal_moves), st.fen)
        pc = unreal.GameplayStatics.get_player_controller(w, 0)
        board.begin_drag("e7")
        board.update_drag(board.square_world("e8") + unreal.Vector(0.9, 0.6, 0))
        r = board.end_drag("e8")
        check("drop on the last rank asks for the piece", "promotion" in str(r).lower() and board.has_pending_promotion(), r)
        pc.press_key_for_test("Escape")
        S["phase"] = "promo_cancel_wait"
        S["wait_until"] = now + 1.0
        return

    if S["phase"] == "promo_cancel_wait":
        pc = unreal.GameplayStatics.get_player_controller(w, 0)
        check("Escape cancels the promotion", not board.has_pending_promotion() and len(st.history) == 0)
        check("cancelled pawn went home (BUG-008)", board.get_physical_mismatches() == 0 and board.is_in_sync(), board.get_physical_mismatches())
        board.begin_drag("e7")
        board.update_drag(board.square_world("e8") + unreal.Vector(-0.7, 0.8, 0))
        board.end_drag("e8")
        pc.press_key_for_test("Q")
        S["phase"] = "promo_confirm_wait"
        S["wait_until"] = now + 2.0
        return

    if S["phase"] == "promo_confirm_wait":
        if board.is_animating() or board.is_awaiting_core():
            return
        mine = [h for h in st.history if h.color == core.get_my_color()]
        check("Q promotes to a queen (core accepted)", bool(mine) and mine[0].to == "e8" and mine[0].promotion == "q", st.fen)
        check("promoted piece settled on its square, board in sync", board.is_in_sync() and board.get_physical_mismatches() == 0 and board.get_resyncs() == 0)
        finish(True)
        return

    if S["phase"] == "rematch_resign":
        S["first"] = (st.id, core.get_my_color(), board.square_world("a1").x)
        core.resign()
        S["phase"] = "rematch_ask"
        S["wait_until"] = now + 1.5
        return

    if S["phase"] == "rematch_ask":
        check("first game ended by resignation", st.status == "resigned", st.status)
        core.rematch()
        S["phase"] = "rematch_verify"
        S["wait_until"] = now + 3.0
        return

    if S["phase"] == "rematch_verify":
        first_id, first_color, first_a1 = S["first"]
        if st.id == first_id or board.is_animating():
            return
        color = core.get_my_color()
        a1 = board.square_world("a1").x
        cx = board.get_actor_location().x
        check("rematch is a new game", st.id != first_id, f"{first_id} -> {st.id}")
        check("colours swapped on rematch", color != first_color and color in ("w", "b"), f"{first_color} -> {color}")
        # the player keeps the dressed seat; the board turns so the player's own first rank is nearest
        check("board turned for the new seat (a1 changed sides)", (first_a1 < cx) != (a1 < cx), f"a1 x {first_a1:.0f} -> {a1:.0f}")
        check("own first rank nearest the player", (a1 < cx) == (color == "w"), f"a1 x {a1:.0f}, board x {cx:.0f}, playing {color}")
        check("board shown from the new seat matches the core", board.is_in_sync(), st.fen)
        screenshot("rematch")
        finish(True)
        return

    if S["phase"] == "verify_reconnect":
        check("reconnected game resumed at the ply it had when killed", EXPECT_PLY < 0 or len(st.history) == EXPECT_PLY, f"ply {len(st.history)} expected {EXPECT_PLY}")
        check("restored position equals the position at the kill", not EXPECT_FEN or st.fen == EXPECT_FEN, st.fen)
        check("board rebuilt from authoritative state after reconnect", board.is_in_sync())
        check("turn restored", st.turn in ("w", "b"), st.turn)
        timed = st.initial_ms > 0  # FTCGameState::IsTimed is C++-only
        check("clocks restored", (not timed) or (0 < st.white_clock_ms <= st.initial_ms and 0 < st.black_clock_ms <= st.initial_ms), f"{st.white_clock_ms:.0f}/{st.black_clock_ms:.0f} of {st.initial_ms:.0f}")
        S["phase"] = "play"
        return

    if S["phase"] == "play":
        if board.is_animating() or board.is_awaiting_core():
            return
        if len(st.history) != S["last_len"]:
            # a new authoritative position has been shown: it must match exactly
            if S["last_len"] >= 0:
                new_moves = len(st.history) - S["last_len"]
                anims = board.get_animated_moves() - S.get("anims_at_len", 0)
                ok = board.is_in_sync() and board.get_resyncs() == 0 and board.get_physical_mismatches() == 0 and anims == new_moves
                check(f"ply {len(st.history)} board in sync without repair", ok,
                      f"{st.history[-1].san if st.history else ''} resyncs={board.get_resyncs()} misplaced={board.get_physical_mismatches()} animated={anims}/{new_moves}")
                pre = S.pop("pre_clock", None)
                if pre is not None and new_moves >= 1 and st.initial_ms > 0:
                    mine = core.get_my_color()
                    server_ms = st.white_clock_ms if mine == "w" else st.black_clock_ms
                    # the core sampled our clock when it accepted the move, a little after our display sample
                    diff = pre - server_ms
                    # Inherent error = one-way transit of the last state + frame quantisation + transit of the move;
                    # observed 9-500 ms on a loaded VM. 750 ms still catches real bugs (wrong side, 2x speed, no tick).
                    check("displayed clock agrees with the core's clock", -50 <= diff <= 750, f"display {pre:.0f} vs core {server_ms:.0f} (diff {diff:.0f} ms)")
            S["last_len"] = len(st.history)
            S["anims_at_len"] = board.get_animated_moves()
            note_features(st)
            if len(st.history) in (10, 30):
                screenshot(f"ply{len(st.history)}")
            if KILL_AT_PLY and len(st.history) >= KILL_AT_PLY:
                R["killed_at_ply"] = len(st.history)
                R["killed_fen"] = st.fen
                with open(os.path.join(OUT, "result.json"), "w") as f:
                    json.dump(R, f, indent=2)
                log(f"KILLING the client at ply {len(st.history)} (simulated crash)")
                import signal
                if hasattr(signal, "SIGKILL"):
                    os.kill(os.getpid(), signal.SIGKILL)
                else:  # Windows: TerminateProcess on ourselves, as hard as SIGKILL (no shutdown code runs)
                    import ctypes
                    k32 = ctypes.windll.kernel32
                    # 64-bit handles: without explicit types ctypes passes the pseudo-handle as a 32-bit int and the
                    # call fails silently (the first Windows run kept "killing" from ply 12 to 22)
                    k32.GetCurrentProcess.restype = ctypes.c_void_p
                    k32.TerminateProcess.argtypes = [ctypes.c_void_p, ctypes.c_uint]
                    k32.TerminateProcess(k32.GetCurrentProcess(), 9)
                    os._exit(9)  # never reached when TerminateProcess works
        if st.status not in ("active", "waiting"):
            detail = f"{st.status} / {st.termination} winner={st.winner or '-'}"
            if EXPECT_TERMINATION:
                check(f"game ended by {EXPECT_TERMINATION}", st.termination == EXPECT_TERMINATION, detail)
            else:
                log(f"result (no expectation given): {detail}")
            if EXPECT_WINNER:
                check(f"winner is {EXPECT_WINNER}", (st.winner or "none") == EXPECT_WINNER, detail)
            R["moves"] = [m.san for m in st.history]
            screenshot("end")
            S["phase"] = "done"
            S["wait_until"] = now + 2.5
            return
        if len(st.history) >= MAX_PLIES:
            check("game within ply budget", False, len(st.history))
            finish(False)
            return
        if ACCEPT_DRAW and st.draw_offer_by and st.draw_offer_by != core.get_my_color():
            # through the same HUD button a player clicks
            hud = unreal.GameplayStatics.get_player_controller(w, 0).get_hud()
            if not S.get("draw_pressed"):
                hud.press_button("accept")
                S["draw_pressed"] = True
                log(f"draw offer from {st.draw_offer_by}: pressed the HUD accept button")
            S["wait_until"] = now + 1.0
            return
        if not core.is_my_turn():
            return
        if IDLE_AFTER_PLY and len(st.history) >= IDLE_AFTER_PLY:
            # let our clock run: sample the displayed clock to prove it is counting down
            ms = core.get_display_clock_ms(core.get_my_color())
            if "idle_clock_start" not in S:
                S["idle_clock_start"] = (now, ms)
            elif now - S["idle_clock_start"][0] > 5 and not S.get("clock_checked"):
                dt = (now - S["idle_clock_start"][0]) * 1000
                dropped = S["idle_clock_start"][1] - ms
                check("our clock counts down while it is our move", abs(dropped - dt) < 1500, f"dropped {dropped:.0f} ms in {dt:.0f} ms")
                S["clock_checked"] = True
            return
        if TEST == "script":
            if S["script_i"] >= len(MOVES):
                return  # our scripted moves are done; wait for the opponent to end the game
            mv = MOVES[S["script_i"]]
            S["script_i"] += 1
        else:
            mv = choose(core, board)
        if not mv:
            return
        if st.clock_running == core.get_my_color():
            S["pre_clock"] = core.get_display_clock_ms(core.get_my_color())
        r1 = board.click_square(mv[:2])
        r2 = board.click_square(mv[2:4])
        if r2 == unreal.TCClickResult.NEEDS_PROMOTION:
            board.choose_promotion(mv[4] if len(mv) == 5 else "q")
        elif r2 != unreal.TCClickResult.SUBMITTED:
            check(f"click {mv} accepted by the board UI", False, f"{r1} {r2}")
        S["anim_before"] = board.get_animated_moves()
        return

    if S["phase"] == "done":
        finish(True)


unreal.register_slate_post_tick_callback(tick)
log(f"armed: test={TEST} out={OUT} moves={len(MOVES)}")
