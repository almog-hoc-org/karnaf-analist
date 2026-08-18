"use client";

import type { ReactNode } from "react";
import { track, type TrackOptions } from "@/lib/track";
import type { EventName } from "@/lib/events";

export default function TrackableOutboundLink({
  href,
  eventName,
  subject,
  detail,
  className,
  children,
  title,
}: {
  href: string;
  eventName: EventName;
  className?: string;
  children: ReactNode;
  title?: string;
} & TrackOptions) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      onClick={() => track(eventName, { subject, detail })}
      className={className}
    >
      {children}
    </a>
  );
}
