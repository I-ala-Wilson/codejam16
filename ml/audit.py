"""Per-take quality audit for the dataset recordings (ml/PROTOCOL.md).

    ml/.venv/bin/python ml/audit.py data/recordings            # a folder, a person's folder, or single .json files

Checks every take: motion shows up in at least 80% of the cue windows, the tone is strong (SNR of 30 dB or more), the cues
line up with the motion, and the hands-off lead-in is still. Only the first three can FAIL a take. A lead-in that was not
still is a WARN: the take stays usable because the floor then comes from its quietest frames (dataset.take_floor).
Exit code 1 if any take has a problem.
"""

import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from data import LEAD_IN_MARGIN_S, LEAD_IN_S, Session, find_sessions, load_session
from dataset import MAX_LEAD_IN_MOTION_FRACTION, MIN_LEAD_IN_FRAMES, MOTION_DB, take_floor
from features import GUARD_BINS, excess_db, frame_centers, motion_energy, spectrogram_db, still_floor

MIN_MOTION_FRACTION = 0.8
MIN_SNR_DB = 30.0
#: Bins either side of the carrier left out of the off-tone level.
OFF_TONE_BINS = 4
#: At least this share of the motion in a cue's period must fall inside its cue window; much less means the cues and the
#: audio are misaligned. (Some motion outside is normal: the hand returns to rest.)
MIN_INSIDE_SHARE = 0.40


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
    #: Median time from a cue to the peak of its motion inside the cue window, in ms (200 to 1000 ms is normal).
    offset_ms: float | None
    problems: list[str] = field(default_factory=list)
    #: Things worth knowing that do not make the take unusable.
    warnings: list[str] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return not self.problems


def _failed(session: Session, problem: str) -> AuditResult:
    return AuditResult(session.name, session.person, session.gesture, len(session.reps), None, 0.0, 0.0, None, [problem])


def _tone_snr(spec: np.ndarray, centre: int) -> float:
    carrier = spec[:, centre - GUARD_BINS : centre + GUARD_BINS + 1].max(axis=1)
    off = np.abs(np.arange(spec.shape[1]) - centre) > OFF_TONE_BINS
    return float(np.median(carrier) - np.median(spec[:, off]))


def _cue_statistics(session: Session, energy: np.ndarray, seconds: np.ndarray) -> tuple[float, float | None, float]:
    """(share of cue windows with motion, median cue-to-peak latency in ms inside the window, share of the motion in
    each cue's period that falls inside its cue window)."""
    period_s = float(session.meta.get("periodMs", 3000)) / 1000
    moving = energy > MOTION_DB
    present = 0
    latencies: list[float] = []
    inside_frames = period_frames = 0
    for start, end, _ in session.reps:
        s, e = start / session.sample_rate, end / session.sample_rate
        inside = (seconds >= s) & (seconds <= e)
        inside_frames += int((moving & inside).sum())
        period_frames += int((moving & (seconds >= s) & (seconds < s + period_s)).sum())
        if inside.any() and energy[inside].max() > MOTION_DB:
            present += 1
            latencies.append(float(seconds[inside][np.argmax(energy[inside])] - s))
    share = inside_frames / period_frames if period_frames else 0.0
    return present / len(session.reps), (float(np.median(latencies)) * 1000 if latencies else None), share


def _alignment_problems(inside_share: float) -> list[str]:
    if inside_share < MIN_INSIDE_SHARE:
        return [
            f"cues and motion look misaligned: only {inside_share:.0%} of the motion in each cue period falls inside its "
            f"cue window (need {MIN_INSIDE_SHARE:.0%})"
        ]
    return []


def _lead_in_motion(spec: np.ndarray, lead_in: np.ndarray) -> float:
    """Share of lead-in frames with motion, measured against the lead-in's own floor."""
    if lead_in.sum() < MIN_LEAD_IN_FRAMES:
        return 0.0
    energy = motion_energy(excess_db(spec, still_floor(spec[lead_in])))
    return float(np.mean(energy[lead_in] > MOTION_DB))


def audit_session(session: Session) -> AuditResult:
    spec = spectrogram_db(session.samples, session.sample_rate, session.tone_hz)
    if spec.shape[0] == 0:
        return _failed(session, "recording is too short for one analysis window")
    centre = spec.shape[1] // 2  # frames are centred on the tone
    seconds = frame_centers(spec.shape[0]) / session.sample_rate
    first_cue = min((s for s, _, _ in session.reps), default=int(LEAD_IN_S * session.sample_rate)) / session.sample_rate
    lead_in = seconds < first_cue - LEAD_IN_MARGIN_S

    floor, _ = take_floor(session, spec)  # the same floor the training data uses
    energy = motion_energy(excess_db(spec, floor))
    lead_in_motion = _lead_in_motion(spec, lead_in)
    snr = _tone_snr(spec[lead_in] if lead_in.sum() >= MIN_LEAD_IN_FRAMES else spec, centre)
    problems: list[str] = []
    warnings: list[str] = []
    if lead_in_motion > MAX_LEAD_IN_MOTION_FRACTION:
        warnings.append(
            f"lead-in not still: motion in {lead_in_motion:.0%} of it (usable: the floor comes from the quietest frames)"
        )
    if snr < MIN_SNR_DB:
        problems.append(f"tone too weak: SNR {snr:.0f} dB (need {MIN_SNR_DB:.0f})")

    fraction: float | None = None
    offset: float | None = None
    if session.meta.get("takeKind") != "none":
        if not session.reps:
            problems.append("gesture take has no cue windows")
        else:
            fraction, offset, inside_share = _cue_statistics(session, energy, seconds)
            if fraction < MIN_MOTION_FRACTION:
                problems.append(f"motion in only {fraction:.0%} of cue windows (need {MIN_MOTION_FRACTION:.0%})")
            problems.extend(_alignment_problems(inside_share))
    return AuditResult(
        session.name,
        session.person,
        session.gesture,
        len(session.reps),
        fraction,
        lead_in_motion,
        snr,
        offset,
        problems,
        warnings,
    )


def _format(result: AuditResult) -> str:
    cues = "no cues" if result.motion_fraction is None else f"motion {result.motion_fraction:.0%} of {result.n_reps} cues"
    offset = "" if result.offset_ms is None else f"  peak {result.offset_ms:+.0f} ms after cue"
    head = "FAIL" if result.problems else ("WARN" if result.warnings else "PASS")
    lines = [
        f"{head} {result.name}  {result.person} {result.gesture}  {cues}  lead-in motion {result.lead_in_motion_fraction:.0%}"
        f"  SNR {result.snr_db:.0f} dB{offset}"
    ]
    lines.extend(f"     - {p}" for p in result.problems)
    lines.extend(f"     ~ {w}" for w in result.warnings)
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
    warned = [r for r in results if r.passed and r.warnings]
    sys.stdout.write(
        f"\n{len(results) - len(failed)}/{len(results)} takes usable ({len(warned)} with warnings), {len(failed)} to redo\n"
    )
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
