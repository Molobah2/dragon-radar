"""Prepare a community song for the site playlist (run by hand, never on the server).

    python -m radar.audio_prep IN_FILE OUT_NAME "Title" "Maker" x_handle

What it does, like a DJ preparing a set:
  1. trims silence at the start and the end, so there is never a gap between songs
  2. evens out loudness (EBU R128, two passes) so every song sits at the same level
  3. encodes a light AAC file for phones (radar/static/audio/OUT_NAME.m4a)
  4. listens for where the song's ending begins and stores that as the mix point,
     so the next song starts rising while this one is still playing
  5. adds or updates the song in radar/static/audio/playlist.json (order is kept)
"""
import json
import re
import subprocess
import sys
from pathlib import Path

AUDIO = Path(__file__).parent / "static" / "audio"
PLAYLIST = AUDIO / "playlist.json"
TARGET_LUFS, TARGET_TP, TARGET_LRA = -14.0, -1.5, 11.0
XF_MIN, XF_MAX = 6.0, 12.0          # crossfade length in seconds


def _run(args: list[str]) -> str:
    return subprocess.run(args, capture_output=True, text=True, check=True).stderr


def _duration(path: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True, check=True).stdout
    return float(out.strip())


def _loud_windows(path: Path, step: float = 0.5) -> list[float]:
    """RMS level (dB) of each half second."""
    err = _run(["ffmpeg", "-hide_banner", "-i", str(path), "-af",
                f"asetnsamples=n={int(44100 * step)}:p=0,astats=metadata=1:reset=1,"
                "ametadata=print:key=lavfi.astats.Overall.RMS_level", "-f", "null", "-"])
    vals = []
    for m in re.finditer(r"RMS_level=(-?[\d.]+|-inf)", err):
        vals.append(-120.0 if m.group(1) == "-inf" else float(m.group(1)))
    return vals


def mix_point(path: Path) -> float:
    """Where the next song should start rising: as the ending begins to fade, never in the middle of the song."""
    dur = _duration(path)
    win = _loud_windows(path)
    if not win:
        return max(0.0, dur - 8.0)
    body = sorted(win)[len(win) // 2]                 # the song's typical level
    last_loud = 0.0
    for i, v in enumerate(win):
        if v > body - 9:                              # still clearly playing
            last_loud = (i + 1) * 0.5
    start = min(dur - XF_MIN, max(dur - XF_MAX, last_loud - 3.0))
    return round(max(0.0, start), 2)


def prepare(src: Path, name: str) -> Path:
    AUDIO.mkdir(parents=True, exist_ok=True)
    trim = ("silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,"
            "areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,areverse")
    first = _run(["ffmpeg", "-hide_banner", "-i", str(src), "-af",
                  f"{trim},loudnorm=I={TARGET_LUFS}:TP={TARGET_TP}:LRA={TARGET_LRA}:print_format=json", "-f", "null", "-"])
    stats = json.loads(first[first.rindex("{"):first.rindex("}") + 1])
    norm = (f"loudnorm=I={TARGET_LUFS}:TP={TARGET_TP}:LRA={TARGET_LRA}:measured_I={stats['input_i']}:"
            f"measured_TP={stats['input_tp']}:measured_LRA={stats['input_lra']}:measured_thresh={stats['input_thresh']}:"
            f"offset={stats['target_offset']}:linear=true")
    out = AUDIO / f"{name}.m4a"
    _run(["ffmpeg", "-hide_banner", "-y", "-i", str(src), "-vn", "-af", f"{trim},{norm}", "-ar", "44100", "-ac", "2",
          "-c:a", "aac", "-b:a", "112k", "-movflags", "+faststart", str(out)])
    return out


def add(src: str, name: str, title: str, by: str, x: str) -> dict:
    out = prepare(Path(src), name)
    entry = {"src": f"audio/{out.name}", "title": title, "by": by, "x": x.lstrip("@"),
             "dur": round(_duration(out), 2), "mix": mix_point(out)}
    songs = json.loads(PLAYLIST.read_text()) if PLAYLIST.exists() else []
    songs = [s for s in songs if s["src"] != entry["src"]] + [entry] if all(s["src"] != entry["src"] for s in songs) \
        else [entry if s["src"] == entry["src"] else s for s in songs]
    PLAYLIST.write_text(json.dumps(songs, indent=2, ensure_ascii=False) + "\n")
    return entry


if __name__ == "__main__":
    print(add(*sys.argv[1:6]))
