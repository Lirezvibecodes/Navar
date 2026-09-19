/**
 * A blocky, pixelated wash of an image: drawn small onto an offscreen canvas,
 * scaled back up with smoothing disabled so each source block stays a
 * hard-edged square, then laid onto the real canvas through a soft blur so
 * those edges read as gently out of focus rather than jagged.
 *
 * Originally the story card's background, and now shared with anything else
 * that wants the same "pixelated blurry" look at its own size — the profile
 * banner draws one too — so the technique stays one implementation instead of
 * two copies quietly drifting apart.
 */
export function drawPixelatedWash(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  width: number,
  height: number,
  pixelW = 54,
  blurPx = 8
): void {
  const pixelH = Math.round((height / width) * pixelW);
  const tiny = document.createElement("canvas");
  tiny.width = pixelW;
  tiny.height = pixelH;
  const tctx = tiny.getContext("2d");
  if (!tctx) return;
  tctx.filter = "brightness(.45) saturate(1.3)";
  const scale = Math.max(pixelW / img.naturalWidth, pixelH / img.naturalHeight) * 1.2;
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  tctx.drawImage(img, (pixelW - dw) / 2, (pixelH - dh) / 2, dw, dh);

  const blocky = document.createElement("canvas");
  blocky.width = width;
  blocky.height = height;
  const bctx = blocky.getContext("2d");
  if (!bctx) return;
  bctx.imageSmoothingEnabled = false;
  bctx.drawImage(tiny, 0, 0, width, height);

  ctx.save();
  ctx.filter = `blur(${blurPx}px)`;
  ctx.drawImage(blocky, 0, 0);
  ctx.restore();
}
