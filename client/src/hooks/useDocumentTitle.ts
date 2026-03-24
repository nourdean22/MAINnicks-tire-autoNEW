/**
 * useDocumentTitle — Dynamically sets the document title.
 * Restores original title on unmount.
 */
import { useEffect, useRef } from "react";

export function useDocumentTitle(title: string) {
  const prevTitle = useRef(document.title);

  useEffect(() => {
    document.title = title;
    return () => {
      document.title = prevTitle.current;
    };
  }, [title]);
}
