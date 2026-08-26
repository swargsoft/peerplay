"use client";

import { Button } from "@/components/ui/button";
import { Camera, X } from "lucide-react";
import jsQR from "jsqr";
import { useEffect, useRef, useState } from "react";

interface QrScannerProps {
  onScan: (payload: string) => void;
  onClose: () => void;
}

/**
 * Camera-based QR scanner. Uses jsQR (pure JS) rather than the BarcodeDetector
 * API so it also works on iOS Safari — essential for phone pairing.
 */
export const QrScanner = ({ onScan, onClose }: QrScannerProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let raf = 0;
    let scanned = false;

    const cleanup = () => {
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((track) => track.stop());
    };

    const tick = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const result = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "dontInvert",
          });
          if (result?.data && !scanned) {
            scanned = true;
            cleanup();
            onScan(result.data);
            return;
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };

    void navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((cameraStream) => {
        if (cancelled) {
          cameraStream.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = cameraStream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = cameraStream;
          video.setAttribute("playsinline", "true");
          void video.play();
          raf = requestAnimationFrame(tick);
        }
      })
      .catch((err: unknown) => {
        console.error("[LAN] QR scanner camera error", err);
        setError(
          err instanceof Error && err.name === "NotAllowedError"
            ? "Camera access denied"
            : "Camera unavailable"
        );
      });

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [onScan]);

  return (
    <div className="w-full flex flex-col items-center gap-3">
      <div className="relative w-full aspect-video bg-neutral-950 rounded-md border border-neutral-800 overflow-hidden">
        <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" muted />
        <canvas ref={canvasRef} className="hidden" />
        <div className="absolute inset-x-8 inset-y-6 border border-primary/60 rounded-md pointer-events-none" />
        {error && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-red-400 bg-neutral-950/80 px-4 text-center">
            {error}
          </div>
        )}
      </div>
      <p className="text-[11px] text-neutral-500 flex items-center gap-1">
        <Camera size={12} /> Point the camera at the peer&apos;s QR code
      </p>
      <Button variant="ghost" size="sm" className="text-xs" onClick={onClose}>
        <X size={14} className="mr-1" /> Cancel
      </Button>
    </div>
  );
};
