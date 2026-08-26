"use client";

import QRCodeLib from "qrcode";
import { useEffect, useState } from "react";

interface LanQrProps {
  payload: string;
  label?: string;
}

/** Renders a pairing payload (SDP signal) as a scannable QR code. */
export const LanQr = ({ payload, label }: LanQrProps) => {
  const [dataUrl, setDataUrl] = useState<string>("");

  useEffect(() => {
    if (!payload) return;
    let cancelled = false;
    void QRCodeLib.toDataURL(payload, {
      margin: 1,
      errorCorrectionLevel: "L", // SDP payloads are large; maximize capacity
      scale: 6,
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch((err) => console.error("[LAN] QR generation failed", err));
    return () => {
      cancelled = true;
    };
  }, [payload]);

  if (!dataUrl) return null;

  return (
    <div className="flex flex-col items-center gap-2">
      {label && <span className="text-[11px] text-neutral-500">{label}</span>}
      <div className="bg-white p-2 rounded-md">
        {/* eslint-disable-next-line @next/next/no-img-element -- data URL from local QR generation */}
        <img src={dataUrl} alt={label ?? "Pairing QR code"} className="w-48 h-48" />
      </div>
    </div>
  );
};
