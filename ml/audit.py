"""Per-take quality audit for the dataset recordings (ml/PROTOCOL.md).

    ml/.venv/bin/python ml/audit.py data/recordings            # a folder, a person's folder, or single .json files

Checks every take: the hands-off lead-in is still, motion shows up in at least 80% of the cue windows, the tone is
strong (SNR of 30 dB or more), and the cues line up with the motion. Exit code 1 if any take has a problem.
"""

import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from data import LEAD_IN_MARGIN_S, LEAD_IN_S, Session, find_sessions, load_session
from features import excess_db, frame_centers, spectrogram_db, still_floor

#: A frame counts as motion when some non-guard bin is this far above the lead-in floor (PROTOCOL.md section 3).
MOTION_DB = 6.0
MIN_MOTION_FRACTION = 0.8
MAX_LEAD_IN_MOTION_FRACTION = 0.10
MIN_SNR_DB = 30.0
#: Bins either side of the carrier left out of the motion measure (main lobe) and of the off-tone level.
GUARD_BINS = 2
OFF_TONE_BINS = 4
MIN_LEAD_IN_FRAMES = 10
#: Motion before the cue by more than this, or after the cue window has closed, means cues and audio are misaligned.
MAX_EARLY_MS = 300.0
#: Search this far either side of a cue window for the motion peak.
SEARCH_MARGIN_S = 1.0


@dataclass(frozen=True)
class AuditResult:
    name: str
    person: str
    gesture: str
    n_reps: int
    #: Share of cue windows with motion; None when the take has no cues (NONE takes).
    motion_fraction: float | None
    lead_in_motion_fraction: float
    snr_db: float
    #: Median time from a cue to the peak of its motion, in ms (a reaction time of 200 to 600 ms is normal).
    offset_ms: float | None
    problems: list[str] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return not self.problems


def _failed(session: Session, problem: str) -> AuditResult:
    return AuditResult(session.name, session.person, session.gesture, len(session.reps), None, 0.0, 0.0, None, [problem])


def _motion_energy(excess: np.ndarray, centre: int) -> np.ndarray:
    """Per frame: the largest excess over the floor in any bin outside the carrier's main lobe."""
    keep = np.abs(np.arange(excess.shape[1]) - centre) > GUARD_BINS
    return excess[:, keep].max(axis=1)


def _tone_snr(spec: np.ndarray, centre: int) -> float:
    carrier = spec[:, centre - GUARD_BINS : centre + GUARD_BINS + 1].max(axis=1)
    off = np.abs(np.arange(spec.shape[1]) - centre) > OFF_TONE_BINS
    return float(np.median(carrier) - np.median(spec[:, off]))


def _cue_statistics(session: Session, energy: np.ndarray, seconds: np.ndarray) -> tuple[float, float | None]:
    present = 0
    latencies: list[float] = []
    for start, end, _ in session.reps:
        s, e = start / session.sample_rate, end / session.sample_rate
        inside = (seconds >= s) & (seconds <= e)
        if inside.any() and energy[inside].max() > MOTION_DB:
            present += 1
        near = (seconds >= s - SEARCH_MARGIN_S) & (seconds <= e + SEARCH_MARGIN_S)
        if near.any() and energy[near].max() > MOTION_DB:
            latencies.append(float(seconds[near][np.argmax(energy[near])] - s))
    fraction = present / len(session.reps)
    return fraction, (float(np.median(latencies)) * 1000 if latencies else None)


def _alignment_problems(session: Session, offset_ms: float | None) -> list[str]:
    if offset_ms is None:
        return []
    window_ms = float(session.meta.get("cueWindowMs", 1500))
    if offset_ms < -MAX_EARLY_MS or offset_ms > window_ms:
        return [f"cues and motion look misaligned: motion peaks {offset_ms:+.0f} ms from the cue (window {window_ms:.0f} ms)"]
    return []


def audit_session(session: Session) -> AuditResult:
    spec = spectrogram_db(session.samples, session.sample_rate, session.tone_hz)
    if spec.shape[0] == 0:
        return _failed(session, "recording is too short for one analysis window")
    centre = spec.shape[1] // 2  # frames are centred on the tone
    seconds = frame_centers(spec.shape[0]) / session.sample_rate
    first_cue = min((s for s, _, _ in session.reps), default=int(LEAD_IN_S * session.sample_rate)) / session.sample_rate
    lead_in = seconds < first_cue - LEAD_IN_MARGIN_S
    if lead_in.sum() < MIN_LEAD_IN_FRAMES:
        return _failed(session, "the hands-off lead-in is too short to learn a floor")

    energy = _motion_energy(excess_db(spec, still_floor(spec[lead_in])), centre)
    lead_in_motion = float(np.mean(energy[lead_in] > MOTION_DB))
    snr = _tone_snr(spec[lead_in], centre)
    problems: list[str] = []
    if lead_in_motion > MAX_LEAD_IN_MOTION_FRACTION:
        problems.append(f"lead-in not still: motion in {lead_in_motion:.0%} of the hands-off lead-in")
    if snr < MIN_SNR_DB:
        problems.append(f"tone too weak: SNR {snr:.0f} dB (need {MIN_SNR_DB:.0f})")

    fraction: float | None = None
    offset: float | None = None
    if session.meta.get("takeKind") != "none":
        if not session.reps:
            problems.append("gesture take has no cue windows")
        else:
            fraction, offset = _cue_statistics(session, energy, seconds)
            if fraction < MIN_MOTION_FRACTION:
                problems.append(f"motion in only {fraction:.0%} of cue windows (need {MIN_MOTION_FRACTION:.0%})")
            problems.extend(_alignment_problems(session, offset))
    return AuditResult(
        session.name, session.person, session.gesture, len(session.reps), fraction, lead_in_motion, snr, offset, problems
    )


def _format(result: AuditResult) -> str:
    cues = "no cues" if result.motion_fraction is None else f"motion {result.motion_fraction:.0%} of {result.n_reps} cues"
    offset = "" if result.offset_ms is None else f"  peak {result.offset_ms:+.0f} ms after cue"
    head = "PASS" if result.passed else "FAIL"
    lines = [
        f"{head} {result.name}  {result.person} {result.gesture}  {cues}  lead-in motion {result.lead_in_motion_fraction:.0%}"
        f"  SNR {result.snr_db:.0f} dB{offset}"
    ]
    lines.extend(f"     - {p}" for p in result.problems)
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    if not argv:
        sys.stderr.write("usage: audit.py <folder-or-json>...\n")
        return 2
    paths: list[Path] = []
    for arg in argv:
        p = Path(arg)
        paths.extend(find_sessions(p) if p.is_dir() else [p])
    if not paths:
        sys.stderr.write("no recordings found (need <name>.json with a sibling <name>.wav)\n")
        return 2
    results = [audit_session(load_session(p)) for p in paths]
    for r in results:
        sys.stdout.write(_format(r) + "\n")
    failed = [r for r in results if not r.passed]
    sys.stdout.write(f"\n{len(results) - len(failed)}/{len(results)} takes pass\n")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
