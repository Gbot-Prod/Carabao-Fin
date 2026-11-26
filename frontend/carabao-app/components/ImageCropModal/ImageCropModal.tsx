"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import styles from "./ImageCropModal.module.css";

type Props = {
  file: File;
  title: string;
  aspectRatio: number;
  outputWidth: number;
  outputHeight: number;
  shape?: "rect" | "rounded-square";
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (croppedFile: File) => void;
};

type NaturalSize = { width: number; height: number };

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Interactive pan-and-zoom cropper locked to a target aspect ratio.
 * Renders the exact visible region to an offscreen canvas on confirm.
 */
export default function ImageCropModal({
  file,
  title,
  aspectRatio,
  outputWidth,
  outputHeight,
  shape = "rect",
  busy = false,
  onCancel,
  onConfirm,
}: Props) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState<NaturalSize | null>(null);
  const [frameSize, setFrameSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const frameRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragStartRef = useRef<{ pointerX: number; pointerY: number; startX: number; startY: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    setNatural(null);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setError(null);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setFrameSize({ width: rect.width, height: rect.height });
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy && !rendering) {
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, rendering, onCancel]);

  // Base size where the image just covers the crop frame at zoom = 1.
  const baseSize = (() => {
    if (!natural || frameSize.width === 0 || frameSize.height === 0) {
      return { width: 0, height: 0 };
    }
    const imgRatio = natural.width / natural.height;
    const frameRatio = frameSize.width / frameSize.height;
    if (imgRatio > frameRatio) {
      return { width: frameSize.height * imgRatio, height: frameSize.height };
    }
    return { width: frameSize.width, height: frameSize.width / imgRatio };
  })();

  const scaledWidth = baseSize.width * zoom;
  const scaledHeight = baseSize.height * zoom;
  const maxOffsetX = Math.max(0, (scaledWidth - frameSize.width) / 2);
  const maxOffsetY = Math.max(0, (scaledHeight - frameSize.height) / 2);

  const clampedOffset = {
    x: clamp(offset.x, -maxOffsetX, maxOffsetX),
    y: clamp(offset.y, -maxOffsetY, maxOffsetY),
  };

  const handleZoomChange = (nextZoom: number) => {
    const z = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    setZoom(z);
    if (baseSize.width > 0 && frameSize.width > 0) {
      const nextMaxX = Math.max(0, (baseSize.width * z - frameSize.width) / 2);
      const nextMaxY = Math.max(0, (baseSize.height * z - frameSize.height) / 2);
      setOffset((prev) => ({
        x: clamp(prev.x, -nextMaxX, nextMaxX),
        y: clamp(prev.y, -nextMaxY, nextMaxY),
      }));
    }
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!natural || busy || rendering) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    dragStartRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      startX: clampedOffset.x,
      startY: clampedOffset.y,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging || !dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.pointerX;
    const dy = e.clientY - dragStartRef.current.pointerY;
    setOffset({
      x: clamp(dragStartRef.current.startX + dx, -maxOffsetX, maxOffsetX),
      y: clamp(dragStartRef.current.startY + dy, -maxOffsetY, maxOffsetY),
    });
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDragging(false);
    dragStartRef.current = null;
  };

  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    if (!natural || busy || rendering) return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.1 : -0.1;
    handleZoomChange(zoom + delta);
  };

  const handleConfirm = async () => {
    const img = imgRef.current;
    if (!img || !natural || frameSize.width === 0 || frameSize.height === 0) return;

    setRendering(true);
    setError(null);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = outputWidth;
      canvas.height = outputHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("Canvas is not supported in this browser.");
      }

      // Image center relative to frame center is (clampedOffset.x, clampedOffset.y).
      const imgLeftInFrame = (frameSize.width - scaledWidth) / 2 + clampedOffset.x;
      const imgTopInFrame = (frameSize.height - scaledHeight) / 2 + clampedOffset.y;

      const scaleToNaturalX = natural.width / scaledWidth;
      const scaleToNaturalY = natural.height / scaledHeight;

      const sx = Math.max(0, -imgLeftInFrame * scaleToNaturalX);
      const sy = Math.max(0, -imgTopInFrame * scaleToNaturalY);
      const sWidth = Math.min(natural.width - sx, frameSize.width * scaleToNaturalX);
      const sHeight = Math.min(natural.height - sy, frameSize.height * scaleToNaturalY);

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, outputWidth, outputHeight);

      const mime =
        file.type === "image/png"
          ? "image/png"
          : file.type === "image/webp"
            ? "image/webp"
            : "image/jpeg";
      const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
      const baseName = file.name.replace(/\.[^/.]+$/, "") || "image";

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, mime, mime === "image/png" ? undefined : 0.92),
      );
      if (!blob) {
        throw new Error("Could not process the cropped image.");
      }
      const cropped = new File([blob], `${baseName}-cropped.${ext}`, { type: mime });
      onConfirm(cropped);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not crop image. Try again.");
      setRendering(false);
    }
  };

  const disabled = busy || rendering || !natural;

  return (
    <div
      className={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy && !rendering) onCancel();
      }}
    >
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="crop-modal-title"
      >
        <div className={styles.header}>
          <h3 id="crop-modal-title" className={styles.title}>{title}</h3>
          <span className={styles.dimensions}>{outputWidth} × {outputHeight} px</span>
        </div>

        <p className={styles.instruction}>
          Drag to reposition and use the slider to zoom.
        </p>

        <div
          ref={frameRef}
          className={`${styles.frame} ${aspectRatio === 1 ? styles.frameSquare : ""} ${dragging ? styles.frameDragging : ""}`}
          style={{ aspectRatio: String(aspectRatio) }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        >
          {imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={imgRef}
              src={imageUrl}
              alt="Crop preview"
              className={styles.image}
              draggable={false}
              onLoad={(e) => {
                const target = e.currentTarget;
                setNatural({ width: target.naturalWidth, height: target.naturalHeight });
              }}
              style={
                natural && scaledWidth > 0
                  ? {
                      width: `${scaledWidth}px`,
                      height: `${scaledHeight}px`,
                      transform: `translate(-50%, -50%) translate(${clampedOffset.x}px, ${clampedOffset.y}px)`,
                    }
                  : { opacity: 0 }
              }
            />
          )}

          {shape === "rounded-square" && (
            <div className={styles.safeZone} aria-hidden="true">
              <span className={styles.safeZoneLabel}>Card badge safe area</span>
            </div>
          )}
        </div>

        <div className={styles.controls}>
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="Zoom out"
            disabled={disabled || zoom <= MIN_ZOOM}
            onClick={() => handleZoomChange(zoom - 0.15)}
          >
            <ZoomOut size={16} />
          </button>
          <input
            type="range"
            className={styles.slider}
            aria-label="Zoom"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.05}
            value={zoom}
            disabled={disabled}
            onChange={(e) => handleZoomChange(Number(e.target.value))}
          />
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="Zoom in"
            disabled={disabled || zoom >= MAX_ZOOM}
            onClick={() => handleZoomChange(zoom + 0.15)}
          >
            <ZoomIn size={16} />
          </button>
          <button
            type="button"
            className={styles.resetBtn}
            disabled={disabled || (zoom === 1 && offset.x === 0 && offset.y === 0)}
            onClick={() => {
              setZoom(1);
              setOffset({ x: 0, y: 0 });
            }}
          >
            <RotateCcw size={13} />
            Reset
          </button>
        </div>

        {error && <p className={styles.error} role="alert">{error}</p>}

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.cancelBtn}
            disabled={busy || rendering}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.confirmBtn}
            disabled={disabled}
            onClick={() => void handleConfirm()}
          >
            {busy || rendering ? "Uploading…" : "Apply & upload"}
          </button>
        </div>
      </div>
    </div>
  );
}
