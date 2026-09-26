"""Download the MobileSAM ONNX models (~45 MB) used for AI roof detection.

    python scripts/download_models.py

Source: https://huggingface.co/Acly/MobileSAM (ONNX export of MobileSAM, MIT licence).
Without these files SuryaJal still works, using a basic OpenCV fallback.
"""
import sys
import urllib.request
from pathlib import Path

MODELS = Path(__file__).resolve().parent.parent / "models"
BASE = "https://huggingface.co/Acly/MobileSAM/resolve/main/"
FILES = {
    "mobile_sam_image_encoder.onnx": 28157093,
    "sam_mask_decoder_multi.onnx": 16496559,
}


def fetch(name: str, size: int) -> None:
    target = MODELS / name
    if target.exists() and target.stat().st_size == size:
        print(f"✓ {name} already present")
        return
    tmp = target.with_suffix(".part")
    print(f"↓ {name} ({size / 1e6:.1f} MB)")
    req = urllib.request.Request(BASE + name, headers={"User-Agent": "SuryaJal/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r, open(tmp, "wb") as f:
        done = 0
        while True:
            chunk = r.read(1 << 16)
            if not chunk:
                break
            f.write(chunk)
            done += len(chunk)
            print(f"\r   {done / size * 100:5.1f}%", end="", flush=True)
    print()
    if tmp.stat().st_size != size:
        tmp.unlink()
        raise SystemExit(f"✗ {name}: size mismatch - try again")
    tmp.replace(target)


def main():
    MODELS.mkdir(exist_ok=True)
    try:
        for n, s in FILES.items():
            fetch(n, s)
    except Exception as e:  # network trouble should not block the app
        print(f"Could not download models ({e}). SuryaJal will use the OpenCV fallback.")
        sys.exit(0)
    print("MobileSAM ready ✓")


if __name__ == "__main__":
    main()
