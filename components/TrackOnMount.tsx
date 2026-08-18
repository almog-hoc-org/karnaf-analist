"use client";

import { useEffect } from "react";
import { track, type TrackOptions } from "@/lib/track";
import type { EventName } from "@/lib/events";

export default function TrackOnMount({ name, subject, detail }: { name: EventName } & TrackOptions) {
  useEffect(() => {
    track(name, { subject, detail });
  }, [name, subject, detail]);

  return null;
}
