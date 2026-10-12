"use client";
import { useRef } from "react";
import { useRouter } from "next/navigation";

/** Hidden staff menu: tap the top-right corner 5 times quickly. Customers won't trigger it by accident. */
export function DeviceCorner() {
  const router = useRouter();
  const taps = useRef<number[]>([]);
  return (
    <button
      type="button"
      aria-label="Device settings (staff)"
      className="fixed right-0 top-0 z-50 h-16 w-16 opacity-0"
      onClick={() => {
        const now = Date.now();
        taps.current = [...taps.current.filter((t) => now - t < 2500), now];
        if (taps.current.length >= 5) {
          taps.current = [];
          router.push("/kiosk/device");
        }
      }}
    />
  );
}
