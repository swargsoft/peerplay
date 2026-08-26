import type { Metadata } from "next";
import { LanPairing } from "@/components/lan/LanPairing";

export const metadata: Metadata = {
  title: "PeerPlay — Local Wi-Fi Pairing",
};

export default function LanPage() {
  return <LanPairing />;
}
