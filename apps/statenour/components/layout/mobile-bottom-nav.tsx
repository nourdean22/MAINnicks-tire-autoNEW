"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type MobileNavItem = {
  href: string;
  label: string;
  kicker: string;
};

function readHash() {
  if (typeof window === "undefined") {
    return "#today";
  }

  return window.location.hash || "#today";
}

export function MobileBottomNav({ items }: { items: MobileNavItem[] }) {
  const [activeHash, setActiveHash] = useState(readHash);

  useEffect(() => {
    const syncHash = () => setActiveHash(readHash());
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  return (
    <nav className="mobile-bottom-nav" aria-label="Primary mobile">
      {items.map((item) => {
        const targetHash = item.href.includes("#") ? item.href.slice(item.href.indexOf("#")) : "#today";
        const active = activeHash === targetHash;

        return (
          <Link className={`mobile-bottom-link ${active ? "mobile-bottom-link-active" : ""}`} href={item.href} key={item.href}>
            <span className="mobile-bottom-kicker">{item.kicker}</span>
            <strong>{item.label}</strong>
          </Link>
        );
      })}
    </nav>
  );
}
