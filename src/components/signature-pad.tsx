"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Draw a signature with a mouse, finger or pen. Reports a PNG data URL, or
 * null while empty. The ink is always dark on white, whatever the theme,
 * because it ends up on a printed contract.
 */
export function SignaturePad({ onChange, label = "Signature" }: { onChange: (dataUrl: string | null) => void; label?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = canvas.current!;
    // Sharp on high-density screens: draw at device pixels, show at CSS size.
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    const ctx = c.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111827";
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    canvas.current!.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = canvas.current!.getContext("2d")!;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 0.1, p.y + 0.1);
    ctx.stroke();
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvas.current!.getContext("2d")!;
    const p = point(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  function up() {
    if (!drawing.current) return;
    drawing.current = false;
    setEmpty(false);
    onChange(canvas.current!.toDataURL("image/png"));
  }

  function clear() {
    const c = canvas.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setEmpty(true);
    onChange(null);
  }

  return (
    <div>
      <div className="relative rounded-md border bg-white">
        <canvas
          ref={canvas}
          aria-label={label}
          data-signature-pad
          className="block h-36 w-full touch-none cursor-crosshair"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerLeave={up}
        />
        {empty && <span className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-gray-400">Sign here</span>}
        <span className="pointer-events-none absolute bottom-6 left-6 right-6 border-b border-gray-300" />
      </div>
      <button type="button" onClick={clear} className="mt-1 text-xs text-muted-foreground hover:underline">Clear</button>
    </div>
  );
}
