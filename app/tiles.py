"""Satellite tile fetching (Esri World Imagery) with memory + disk cache and
"Map data not yet available" placeholder detection."""
from __future__ import annotations

import asyncio
import io
import math
from collections import OrderedDict
from typing import Optional, Tuple

import httpx
import numpy as np
from PIL import Image

from .config import CACHE_DIR, ESRI_TILE_URL, MAX_NATIVE_ZOOM, USER_AGENT
from .geo import TILE, latlon_to_px

PLACEHOLDER_MAX_BYTES = 3000   # Esri's grey "no data yet" tile is ~2.5 KB


def _is_placeholder(raw: bytes, img: Image.Image) -> bool:
    if len(raw) > PLACEHOLDER_MAX_BYTES:
        return False
    arr = np.asarray(img.convert("L"), dtype=np.float32)
    return float(arr.std()) < 12.0


class TileFetcher:
    def __init__(self, cache_dir=CACHE_DIR / "tiles", mem_items: int = 160):
        self.cache_dir = cache_dir
        self.mem: "OrderedDict[Tuple[int,int,int], Tuple[Optional[Image.Image], bool]]" = OrderedDict()
        self.mem_items = mem_items
        self._client: Optional[httpx.AsyncClient] = None
        self._sem = asyncio.Semaphore(8)

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(headers={"User-Agent": USER_AGENT},
                                             timeout=httpx.Timeout(15.0), follow_redirects=True)
        return self._client

    async def close(self):
        if self._client is not None:
            await self._client.aclose()

    def _disk_path(self, z, x, y):
        return self.cache_dir / str(z) / str(x) / f"{y}.jpg"

    async def tile(self, z: int, x: int, y: int) -> Tuple[Optional[Image.Image], bool]:
        """Returns (RGB image or None, is_placeholder)."""
        n = 2 ** z
        if not (0 <= y < n):
            return None, True
        x %= n
        key = (z, x, y)
        if key in self.mem:
            self.mem.move_to_end(key)
            return self.mem[key]
        raw = None
        p = self._disk_path(z, x, y)
        if p.exists():
            raw = p.read_bytes()
        else:
            async with self._sem:
                try:
                    r = await self.client.get(ESRI_TILE_URL.format(z=z, x=x, y=y))
                    if r.status_code == 200 and r.content:
                        raw = r.content
                except httpx.HTTPError:
                    raw = None
            if raw:
                try:
                    p.parent.mkdir(parents=True, exist_ok=True)
                    p.write_bytes(raw)
                except OSError:
                    pass
        if not raw:
            return None, True        # network failure: don't cache in memory
        try:
            img = Image.open(io.BytesIO(raw)).convert("RGB")
        except Exception:
            return None, True
        res = (img, _is_placeholder(raw, img))
        self.mem[key] = res
        if len(self.mem) > self.mem_items:
            self.mem.popitem(last=False)
        return res

    async def crop(self, z: int, gx0: int, gy0: int, w: int, h: int):
        """Crop a w x h window whose top-left is global pixel (gx0, gy0) at zoom z.
        Returns (RGB uint8 array, fraction of placeholder/missing tiles)."""
        tx0, ty0 = gx0 // TILE, gy0 // TILE
        tx1, ty1 = (gx0 + w - 1) // TILE, (gy0 + h - 1) // TILE
        coords = [(tx, ty) for ty in range(ty0, ty1 + 1) for tx in range(tx0, tx1 + 1)]
        results = await asyncio.gather(*(self.tile(z, tx, ty) for tx, ty in coords))
        mosaic = Image.new("RGB", ((tx1 - tx0 + 1) * TILE, (ty1 - ty0 + 1) * TILE), (40, 40, 40))
        bad = 0
        for (tx, ty), (img, ph) in zip(coords, results):
            if img is None or ph:
                bad += 1
            if img is not None:
                mosaic.paste(img, ((tx - tx0) * TILE, (ty - ty0) * TILE))
        ox, oy = gx0 - tx0 * TILE, gy0 - ty0 * TILE
        arr = np.asarray(mosaic.crop((ox, oy, ox + w, oy + h)))
        return arr, bad / len(coords)

    async def crop_around(self, lat: float, lon: float, z: int, size: int):
        """Centered crop; steps down the zoom level if imagery is missing.
        Returns dict(img, z, gx0, gy0)."""
        z = min(int(z), MAX_NATIVE_ZOOM)
        last = None
        for zz in range(z, max(z - 3, 14), -1):
            gx, gy = latlon_to_px(lat, lon, zz)
            gx0, gy0 = int(math.floor(gx - size / 2)), int(math.floor(gy - size / 2))
            img, bad = await self.crop(zz, gx0, gy0, size, size)
            last = {"img": img, "z": zz, "gx0": gx0, "gy0": gy0, "bad": bad}
            if bad <= 0.25:
                return last
        return last

    async def crop_bbox(self, latlngs, max_px: int = 640, pad_frac: float = 0.35,
                        min_span_px: int = 160):
        """Crop covering a polygon (for report thumbnails). Picks the highest zoom
        where the padded bbox fits in max_px. Returns dict(img, z, gx0, gy0)."""
        lats = [p[0] for p in latlngs]
        lons = [p[1] for p in latlngs]
        for z in range(MAX_NATIVE_ZOOM, 12, -1):
            x0, y0 = latlon_to_px(max(lats), min(lons), z)
            x1, y1 = latlon_to_px(min(lats), max(lons), z)
            span = max(x1 - x0, y1 - y0)
            side = max(min_span_px, span * (1 + 2 * pad_frac))
            if side <= max_px:
                cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
                side = int(side)
                gx0, gy0 = int(cx - side / 2), int(cy - side / 2)
                img, bad = await self.crop(z, gx0, gy0, side, side)
                if bad > 0.25 and z > 16:
                    continue
                return {"img": img, "z": z, "gx0": gx0, "gy0": gy0, "bad": bad}
        return None
