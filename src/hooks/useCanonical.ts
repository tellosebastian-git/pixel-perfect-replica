import { useEffect } from "react";

export const SITE_URL = "https://vittro.com.ar";

/** Points the single canonical link and og:url at this page; restores on unmount. */
export function useCanonical(path: string) {
  useEffect(() => {
    const url = `${SITE_URL}${path}`;
    let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "canonical";
      document.head.appendChild(link);
    }
    const og = document.querySelector<HTMLMetaElement>('meta[property="og:url"]');
    const prevLink = link.href;
    const prevOg = og?.content;
    link.href = url;
    if (og) og.content = url;
    return () => {
      link!.href = prevLink;
      if (og && prevOg !== undefined) og.content = prevOg;
    };
  }, [path]);
}
