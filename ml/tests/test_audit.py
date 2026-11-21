import numpy as np
import pytest

from audit import audit_session
from data import Session

FS = 48000
TONE = 20000.0
PERIOD_S = 3.0
CUE_S = 1.5


def db_amp(db: float) -> float:
    return 10 ** (db / 20)


def take(
    n_cues: int = 10,
    react_s: float = 0.3,
    echo_db: float | None = -56.0,
    lead_in_motion: bool = False,
    kind: str = "gesture",
    noise_db: float = -100.0,
    seed: int = 3,
    stray_s: float = 0.0,
) -> Session:
    """A synthetic take: 3 s lead-in, then a cue every PERIOD_S; the hand echo starts `react_s` after each cue."""
    rng = np.random.default_rng(seed)
    seconds = 3.0 + n_cues * PERIOD_S + 1.0
    t = np.arange(int(seconds * FS)) / FS
    x = db_amp(-36) * np.sin(2 * np.pi * TONE * t) + rng.uniform(-1, 1, t.size) * db_amp(noise_db)
    reps = []
    for k in range(n_cues):
        cue = 3.0 + k * PERIOD_S
        reps.append((int(cue * FS), int((cue + CUE_S) * FS), "PUSH"))
        if echo_db is not None:
            a, b = int((cue + react_s) * FS), int((cue + react_s + 0.4) * FS)
            x[a:b] += db_amp(echo_db) * np.sin(2 * np.pi * (TONE + 117) * t[a:b])
        if stray_s > 0:  # motion in the gap before the next cue, like a hand being repositioned
            a, b = int((cue + 2.0) * FS), int((cue + 2.0 + stray_s) * FS)
            x[a:b] += db_amp(-50) * np.sin(2 * np.pi * (TONE - 90) * t[a:b])
    if lead_in_motion:
        a, b = int(1.0 * FS), int(1.5 * FS)
        x[a:b] += db_amp(-50) * np.sin(2 * np.pi * (TONE + 117) * t[a:b])
    meta = {"takeKind": kind, "cueWindowMs": 1500, "periodMs": 3000, "leadInMs": 3000}
    return Session(
        name="synthetic", person="ian", gesture="PUSH", laptop="mbp", sample_rate=FS, tone_hz=TONE,
        samples=x.astype(np.float32), reps=reps if kind == "gesture" else [], meta=meta,
    )


class TestGestureTakes:
    def test_a_clean_take_passes_with_motion_in_every_cue_window(self):
        r = audit_session(take())
        assert r.n_reps == 10
        assert r.motion_fraction == 1.0
        assert r.lead_in_motion_fraction < 0.05
        assert r.snr_db > 30
        assert r.passed and r.problems == []

    def test_the_offset_is_the_latency_from_the_cue_to_the_motion_peak(self):
        r = audit_session(take(react_s=0.1))  # a 0.4 s burst starting 0.1 s after the cue peaks at about 0.3 s
        assert 50 <= r.offset_ms <= 700

    def test_the_offset_shows_a_cue_that_runs_early(self):
        # motion starts 1.0 s after each cue: the cue windows sit well ahead of the motion
        early = audit_session(take(react_s=1.0))
        aligned = audit_session(take(react_s=0.1))
        assert early.offset_ms > aligned.offset_ms + 500

    def test_a_loud_repositioning_burst_in_the_gap_does_not_fail_a_take_whose_gesture_is_in_the_window(self):
        r = audit_session(take(stray_s=0.4))  # gesture 0.4 s inside the window, stray burst of the same length outside
        assert r.passed, r.problems

    def test_a_take_whose_motion_is_mostly_outside_the_cue_windows_is_flagged_as_misaligned(self):
        r = audit_session(take(react_s=1.4, stray_s=0.9))  # only the first 0.1 s of the gesture is inside the window
        assert any("misaligned" in p for p in r.problems)

    def test_a_take_with_no_motion_fails(self):
        r = audit_session(take(echo_db=None))
        assert r.motion_fraction == 0.0
        assert not r.passed
        assert any("motion" in p for p in r.problems)

    def test_motion_in_the_lead_in_is_only_a_warning_when_the_take_is_otherwise_sound(self):
        r = audit_session(take(lead_in_motion=True))
        assert r.lead_in_motion_fraction > 0.1
        assert any("lead-in" in w for w in r.warnings)
        assert r.passed and r.problems == []
        assert r.motion_fraction == 1.0  # the quiet-frame floor still sees every cue's motion

    def test_a_moving_lead_in_does_not_hide_a_take_with_no_motion_in_the_cues(self):
        r = audit_session(take(lead_in_motion=True, echo_db=None))
        assert not r.passed and any("motion" in p for p in r.problems)

    def test_a_weak_tone_is_flagged(self):
        r = audit_session(take(noise_db=-25.0))
        assert r.snr_db < 30
        assert any("tone" in p for p in r.problems)


class TestNoneTakes:
    def test_a_still_none_take_passes_and_has_no_cue_statistics(self):
        r = audit_session(take(kind="none", echo_db=None))
        assert r.n_reps == 0
        assert r.passed
        assert r.motion_fraction is None

    def test_a_none_take_still_needs_a_healthy_tone(self):
        r = audit_session(take(kind="none", echo_db=None, noise_db=-25.0))
        assert not r.passed and any("tone" in p for p in r.problems)


def test_a_recording_too_short_for_one_window_is_reported_not_crashed():
    s = take()
    short = Session(**{**s.__dict__, "samples": s.samples[:1000], "reps": []})
    r = audit_session(short)
    assert not r.passed and any("short" in p for p in r.problems)
