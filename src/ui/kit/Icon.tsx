import type { CSSProperties } from 'react';
import { appHost, useAppHost } from '../../app/host';

const ICON_BASE = () => new URL('icons/', document.baseURI).href;

/** SVG from public/icons rendered as a CSS mask, so it follows `currentColor`. */
export function Icon({ name, size, className = '' }: { name: string; size?: number; className?: string }) {
  const style = { '--src': `url("${ICON_BASE()}${name}.svg")`, ...(size ? { fontSize: size } : {}) } as CSSProperties;
  return <span className={`icon ${className}`} style={style} aria-hidden />;
}

/** Country flag from public/data/flags/{iso2}.svg; hides itself if the file is missing. */
export function Flag({ id, width = 24 }: { id: string | null | undefined; width?: number }) {
  const iso = useAppHost((s) => (id ? s.world?.countryById.get(id)?.iso2 : undefined));
  if (!iso) return <span className="flag" style={{ width, height: width * 0.67 }} />;
  const src = new URL(`data/flags/${iso.toLowerCase()}.svg`, document.baseURI).href;
  return <img className="flag" src={src} alt="" style={{ width, height: width * 0.67 }} onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />;
}
export const flagIso = (id: string) => appHost.getState().world?.countryById.get(id)?.iso2;
