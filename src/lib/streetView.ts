/**
 * Normalize a Google Maps URL the user pasted into an iframe-embeddable
 * Street View URL.
 *
 * Why this exists: users grab the URL from their browser address bar after
 * positioning Street View, which gives a `https://www.google.com/maps/@lat,lng,3a,...`
 * page URL. Google blocks framing of those (X-Frame-Options: SAMEORIGIN),
 * so the embedded iframe in DetailPanel renders a broken-image placeholder.
 *
 * The fix: extract the camera params (and panoid if present) from any of
 * the common URL shapes Google uses, then re-build a documented embed URL
 * (`output=svembed`) that IS allowed in third-party iframes.
 *
 * Returns the original string when:
 *   - The URL is already an embed URL (`/maps/embed?pb=…`)
 *   - The URL is empty/null
 *   - We can't parse it (graceful fallback — let the browser try its luck)
 */
export function normalizeStreetViewUrl(input: string | null | undefined): string {
  if (!input) return "";
  const url = input.trim();
  if (!url) return "";

  // Already an embed URL — pass through unchanged. These come from Google's
  // "Embed a map" share dialog and are guaranteed to work.
  if (/\/maps\/embed\?/.test(url)) return url;

  // Try to pull (lat, lng, heading, pitch) from the `/maps/@lat,lng,3a,75y,Xh,Yt/`
  // segment. The `3a` marker means "Street View"; without it we leave the URL
  // alone (it's probably a regular map link, not Street View).
  const camMatch = url.match(
    /\/maps\/@(-?\d+\.\d+),(-?\d+\.\d+),3a,[\d.]+y,([\d.]+)h,([\d.]+)t/
  );
  // Pano id is embedded inside the `/data=…` blob as `!1sPANOID!`.
  const panoMatch = url.match(/!1s([^!?/]+)/);

  if (camMatch) {
    const [, lat, lng, headingRaw, pitchRaw] = camMatch;
    const heading = headingRaw;
    // Google's svembed pitch convention is `tilt - 90`, NOT raw tilt.
    // Tilt 90 = horizontal, so pitch passed to embed is 0; tilt 99 → +9.
    const pitch = (parseFloat(pitchRaw) - 90).toFixed(2);

    if (panoMatch) {
      // Panoid wins when present — pinpoints the exact panorama, not a
      // best-match-by-coords (which Google sometimes substitutes with a
      // newer photo at the same location).
      return `https://www.google.com/maps?layer=c&panoid=${encodeURIComponent(
        panoMatch[1]
      )}&cbp=11,${heading},0,0,${pitch}&output=svembed`;
    }
    return `https://www.google.com/maps?q=&layer=c&cbll=${lat},${lng}&cbp=11,${heading},0,0,${pitch}&output=svembed`;
  }

  // Last-ditch: if we got a panoid but no camera block, build a plain pano
  // embed with default heading/pitch.
  if (panoMatch) {
    return `https://www.google.com/maps?layer=c&panoid=${encodeURIComponent(
      panoMatch[1]
    )}&cbp=11,0,0,0,0&output=svembed`;
  }

  // Couldn't recognize the shape — return as-is so the iframe at least
  // tries to render. The user will see a broken frame and know to re-paste.
  return url;
}
