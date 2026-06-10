"use client";

import { MapPin, ExternalLink } from "lucide-react";

interface Props {
  address?: string | false | null;
  /** When `compact`, render a one-line button-style link suitable for table cells. */
  variant?: "block" | "compact" | "inline-icon";
  className?: string;
}

/**
 * Renders an address with a "deeplink" to Google Maps. On mobile this
 * triggers the native Maps app on iOS / Android, on desktop it opens
 * Google Maps in a new tab. Used wherever the field tech (Javier) or
 * installer needs to drive to the address — Order detail, Measurements
 * list, Installations list, Route Planner.
 *
 * Empty / falsy addresses render as "—" so callers don't need to guard.
 */
export function AddressLink({ address, variant = "block", className }: Props) {
  if (!address || typeof address !== "string" || !address.trim()) {
    return <span className={className ?? "text-slate-400"}>—</span>;
  }
  const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
  if (variant === "inline-icon") {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        title="Open in Google Maps"
        className={`inline-flex items-center text-slate-400 hover:text-indigo-700 ${className ?? ""}`}
        aria-label="Open in Google Maps"
        onClick={(e) => e.stopPropagation()}
      >
        <MapPin size={14} />
      </a>
    );
  }
  if (variant === "compact") {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        title="Open in Google Maps"
        className={`inline-flex max-w-full items-center gap-1 truncate text-slate-600 hover:text-indigo-700 hover:underline ${className ?? ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <MapPin size={12} className="shrink-0" />
        <span className="truncate">{address}</span>
      </a>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title="Open in Google Maps"
      className={`group inline-flex items-start gap-1.5 text-slate-700 hover:text-indigo-700 ${className ?? ""}`}
      onClick={(e) => e.stopPropagation()}
    >
      <MapPin size={14} className="mt-0.5 shrink-0 text-slate-400 group-hover:text-indigo-700" />
      <span className="whitespace-pre-line">{address}</span>
      <ExternalLink
        size={11}
        className="mt-1 shrink-0 text-slate-300 transition group-hover:text-indigo-500"
      />
    </a>
  );
}

interface PhoneLinkProps {
  phone?: string | false | null;
  className?: string;
}

/**
 * `tel:` deeplink + icon. On desktop the browser delegates to the OS
 * dialer (FaceTime / Skype / Teams), on mobile it places the call.
 * Same purpose as AddressLink: cut friction when the operator (Majela)
 * or field tech needs to ring the customer.
 */
export function PhoneLink({ phone, className }: PhoneLinkProps) {
  if (!phone || typeof phone !== "string" || !phone.trim()) {
    return <span className={className ?? "text-slate-400"}>—</span>;
  }
  // Strip everything except digits and '+' to make the tel: link safe.
  const tel = phone.replace(/[^\d+]/g, "");
  return (
    <a
      href={`tel:${tel}`}
      className={`inline-flex items-center gap-1 text-slate-700 hover:text-indigo-700 hover:underline ${className ?? ""}`}
      onClick={(e) => e.stopPropagation()}
    >
      {phone}
    </a>
  );
}
