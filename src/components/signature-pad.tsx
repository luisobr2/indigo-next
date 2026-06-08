"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

export interface SignaturePadHandle {
  clear: () => void;
  /** Returns base64 PNG (NO data: prefix). null if pad is empty. */
  getDataURL: () => string | null;
}

interface SignaturePadProps {
  width?: number;
  height?: number;
  onChange?: (hasInk: boolean) => void;
}

export const SignaturePad = forwardRef<SignaturePadHandle, SignaturePadProps>(
  function SignaturePad({ width = 500, height = 180, onChange }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [hasInk, setHasInk] = useState(false);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d")!;
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "#1f4486";
      ctx.lineCap = "round";

      let drawing = false;
      let lastX = 0,
        lastY = 0;
      let inkDetected = false;

      function pos(e: MouseEvent | TouchEvent) {
        const r = canvas!.getBoundingClientRect();
        const t = "touches" in e ? e.touches[0] : (e as MouseEvent);
        return {
          x: ((t.clientX - r.left) * canvas!.width) / r.width,
          y: ((t.clientY - r.top) * canvas!.height) / r.height,
        };
      }
      function start(e: MouseEvent | TouchEvent) {
        drawing = true;
        const p = pos(e);
        lastX = p.x;
        lastY = p.y;
        e.preventDefault();
      }
      function move(e: MouseEvent | TouchEvent) {
        if (!drawing) return;
        const p = pos(e);
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        lastX = p.x;
        lastY = p.y;
        if (!inkDetected) {
          inkDetected = true;
          setHasInk(true);
          onChange?.(true);
        }
        e.preventDefault();
      }
      function end() {
        drawing = false;
      }

      canvas.addEventListener("mousedown", start);
      canvas.addEventListener("mousemove", move);
      canvas.addEventListener("mouseup", end);
      canvas.addEventListener("mouseout", end);
      canvas.addEventListener("touchstart", start, { passive: false });
      canvas.addEventListener("touchmove", move, { passive: false });
      canvas.addEventListener("touchend", end);
      return () => {
        canvas.removeEventListener("mousedown", start);
        canvas.removeEventListener("mousemove", move);
        canvas.removeEventListener("mouseup", end);
        canvas.removeEventListener("mouseout", end);
        canvas.removeEventListener("touchstart", start);
        canvas.removeEventListener("touchmove", move);
        canvas.removeEventListener("touchend", end);
      };
    }, [onChange]);

    useImperativeHandle(ref, () => ({
      clear: () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
        setHasInk(false);
        onChange?.(false);
      },
      getDataURL: () => {
        if (!hasInk) return null;
        const url = canvasRef.current?.toDataURL("image/png");
        return url ? url.replace(/^data:image\/png;base64,/, "") : null;
      },
    }));

    return (
      <div>
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="w-full touch-none rounded-lg border border-slate-200 bg-white"
          style={{ touchAction: "none" }}
        />
      </div>
    );
  },
);
