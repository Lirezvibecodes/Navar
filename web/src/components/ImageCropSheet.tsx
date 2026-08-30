import { useEffect, useRef, useState } from "react";
import { ActionButton, GhostButton, Sheet } from "./ui";

/** On-screen size of the crop window. The exported image is square regardless
 *  of device pixel ratio, so this only has to look right, not match a size. */
const VIEWPORT = 280;
/** Side length of the square rasterized on confirm. */
const OUTPUT = 512;
/** How far past the cover-fit scale a pinch may zoom in. */
const MAX_ZOOM = 4;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

interface Point {
  x: number;
  y: number;
}

function centroid(points: Point[]): Point {
  return {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  };
}

/**
 * A gesture in progress: the pointers currently down, and the pan/zoom the
 * view was at when this set of pointers was established. Re-established every
 * time a finger is added or lifted, so a pinch handing off to a single-finger
 * pan (or back) never jumps.
 */
interface Gesture {
  pointers: Map<number, Point>;
  baseCenter: Point;
  baseDistance: number | null;
  baseOffset: Point;
  baseZoom: number;
}

/**
 * Crop a picked image to a square before it goes anywhere.
 *
 * Every cover the app accepts — a playlist's own artwork, a custom avatar —
 * ends up in a fixed-size square slot, and letting the server or an
 * `object-fit` guess which part of an arbitrary photo belongs there produces
 * off-center faces and cropped edges. This asks the person instead: pan and
 * pinch-zoom a square window over their picture with the same Pointer Events
 * a long-press already uses in this app (`useLongPress`, ui.tsx), then
 * rasterize exactly what the window shows into a single `Blob`.
 *
 * Takes the source `File` directly and owns the sheet's open state itself
 * (open whenever `file` is set) so callers don't juggle a second boolean.
 */
export function ImageCropSheet({
  file,
  onCancel,
  onConfirm,
}: {
  file: File | null;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [coverScale, setCoverScale] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [exporting, setExporting] = useState(false);
  const gesture = useRef<Gesture | null>(null);

  // The scale at which the image, at zoom 1, exactly covers the square
  // viewport with no gaps — the same fit `object-fit: cover` would choose.
  useEffect(() => {
    if (!file) {
      setImg(null);
      return;
    }
    let live = true;
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => {
      if (!live) return;
      setImg(el);
      setCoverScale(VIEWPORT / Math.min(el.naturalWidth, el.naturalHeight));
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    };
    el.src = url;
    return () => {
      live = false;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const totalScale = coverScale * zoom;

  // How far the image can be panned, in viewport px, before its edge would
  // cross into the square and show empty space. Zero on an axis that is
  // already exactly viewport-sized at the current zoom (the axis `cover`
  // fit itself, before any zooming in).
  const maxOffset = (): Point => {
    if (!img) return { x: 0, y: 0 };
    return {
      x: Math.max(0, (img.naturalWidth * totalScale - VIEWPORT) / 2),
      y: Math.max(0, (img.naturalHeight * totalScale - VIEWPORT) / 2),
    };
  };

  const clampOffset = (p: Point): Point => {
    const max = maxOffset();
    return { x: clamp(p.x, -max.x, max.x), y: clamp(p.y, -max.y, max.y) };
  };

  const beginGesture = (pointers: Map<number, Point>) => {
    const pts = [...pointers.values()];
    gesture.current = {
      pointers,
      baseCenter: centroid(pts),
      baseDistance:
        pts.length === 2 ? Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) : null,
      baseOffset: offset,
      baseZoom: zoom,
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const pointers = new Map(gesture.current?.pointers ?? []);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    beginGesture(pointers);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g || !g.pointers.has(e.pointerId)) return;
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...g.pointers.values()];
    const center = centroid(pts);

    let nextZoom = g.baseZoom;
    if (pts.length === 2 && g.baseDistance) {
      const distance = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      nextZoom = clamp(g.baseZoom * (distance / g.baseDistance), 1, MAX_ZOOM);
    }

    setZoom(nextZoom);
    setOffset(
      clampOffset({
        x: g.baseOffset.x + (center.x - g.baseCenter.x),
        y: g.baseOffset.y + (center.y - g.baseCenter.y),
      })
    );
  };

  const endPointer = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const pointers = new Map(g.pointers);
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      gesture.current = null;
      return;
    }
    beginGesture(pointers);
  };

  const confirm = async () => {
    if (!img) return;
    setExporting(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = OUTPUT;
      canvas.height = OUTPUT;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      // The inverse of how the viewport draws the image: the source square
      // that ends up under the crop window, in the image's own pixels.
      const srcSize = VIEWPORT / totalScale;
      const srcX = img.naturalWidth / 2 - (offset.x + VIEWPORT / 2) / totalScale;
      const srcY = img.naturalHeight / 2 - (offset.y + VIEWPORT / 2) / totalScale;
      ctx.drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, OUTPUT, OUTPUT);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.92)
      );
      if (blob) onConfirm(blob);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Sheet open={file != null} onClose={onCancel} title="Crop">
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "2px 8px 12px" }}>
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerLeave={endPointer}
          onPointerCancel={endPointer}
          style={{
            position: "relative",
            width: VIEWPORT,
            height: VIEWPORT,
            borderRadius: 16,
            overflow: "hidden",
            background: "rgba(255,255,255,.04)",
            touchAction: "none",
          }}
        >
          {img ? (
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: img.naturalWidth,
                height: img.naturalHeight,
                marginLeft: -img.naturalWidth / 2,
                marginTop: -img.naturalHeight / 2,
                transform: `translate(${offset.x}px, ${offset.y}px)`,
              }}
            >
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  transform: `scale(${totalScale})`,
                  transformOrigin: "center center",
                }}
              >
                <img
                  src={img.src}
                  alt=""
                  draggable={false}
                  style={{ width: "100%", height: "100%", display: "block", userSelect: "none" }}
                />
              </div>
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: 8, width: "100%" }}>
          <GhostButton onClick={onCancel} disabled={exporting}>
            Cancel
          </GhostButton>
          <ActionButton onClick={() => void confirm()} disabled={!img || exporting}>
            {exporting ? "Saving…" : "Use photo"}
          </ActionButton>
        </div>
      </div>
    </Sheet>
  );
}
