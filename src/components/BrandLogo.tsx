type Props = {
  size?: number;
  className?: string;
  /** Kept for call-site compatibility; unused with native img. */
  priority?: boolean;
};

/**
 * Brand mark with transparent background (no black plate).
 * Uses a native img so browsers don't flatten alpha via the image optimizer cache.
 */
export function BrandLogo({ size = 36, className = "" }: Props) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- intentional: preserve PNG alpha without optimizer cache
    <img
      src="/brand/logo-mark.png"
      alt="Airport Investment Intelligence"
      width={size}
      height={size}
      decoding="async"
      className={`shrink-0 bg-transparent object-contain ${className}`.trim()}
      style={{ background: "transparent" }}
    />
  );
}
