"use client";

import { useEffect, useState } from "react";
import styles from "./ProofPhoto.module.css";

/**
 * A proof photo (ORDER_PROOF_PHOTOS_PLAN.md). The photo endpoints need the Bearer token, so the
 * image is fetched as a blob and shown from an object URL; a click opens it full size.
 */
export default function ProofPhoto<K extends string>({
  orderId,
  kind,
  load,
  alt,
  caption,
}: {
  orderId: number;
  kind: K;
  /** Fetches the image bytes; pass a module-level function (it is an effect dependency). */
  load: (orderId: number, kind: K) => Promise<Blob>;
  alt: string;
  caption?: React.ReactNode;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let live = true;
    load(orderId, kind)
      .then((blob) => {
        if (!live) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [load, orderId, kind]);

  return (
    <figure className={styles.photo}>
      <div className={styles.frame}>
        {url ? (
          <a href={url} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element -- object URL, not a static asset */}
            <img src={url} alt={alt} />
          </a>
        ) : (
          <span className={styles.state}>{failed ? "Photo not available" : "Loading photo…"}</span>
        )}
      </div>
      {caption && <figcaption className={styles.caption}>{caption}</figcaption>}
    </figure>
  );
}
