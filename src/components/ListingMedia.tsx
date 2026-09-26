"use client";

import { useState } from "react";
import Image from "next/image";
import type { ShortlistItem } from "@/lib/decision";
import { listingHref, listingPhotoSrc } from "@/lib/listing-display";

type ThumbProps = {
  item: ShortlistItem;
  dim?: boolean;
  size?: "sm" | "md";
};

export function ListingThumb({ item, dim = false, size = "sm" }: ThumbProps) {
  const [failed, setFailed] = useState(false);
  const photo = failed ? null : listingPhotoSrc(item);
  const href = listingHref(item);
  const local = photo?.startsWith("/") ?? false;
  const box = size === "md" ? "h-28 w-28" : "h-20 w-20";
  const inner = (
    <div
      className={`relative shrink-0 overflow-hidden rounded-md border border-line bg-panel-raised ${box} ${dim ? "opacity-40" : ""}`}
    >
      {photo && local ? (
        <Image src={photo} alt="" width={size === "md" ? 112 : 80} height={size === "md" ? 112 : 80} unoptimized className="h-full w-full object-cover" />
      ) : photo ? (
        // Live thumbs are data URLs, the image proxy, or shop CDNs.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-[#1a1b20] text-[10px] uppercase tracking-wide text-muted">
          no photo
        </div>
      )}
    </div>
  );
  if (!href) return inner;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="shrink-0" title={`Open at ${item.merchant}`}>
      {inner}
    </a>
  );
}

export function ListingTitle({
  item,
  className,
}: {
  item: ShortlistItem;
  className?: string;
}) {
  const href = listingHref(item);
  if (!href) return <span className={className}>{item.title}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`hover:underline ${className ?? ""}`}>
      {item.title}
    </a>
  );
}

export function ListingMerchant({ item }: { item: ShortlistItem }) {
  const href = listingHref(item);
  if (!href) return <span className="truncate">{item.merchant}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="truncate hover:underline">
      {item.merchant}
    </a>
  );
}
