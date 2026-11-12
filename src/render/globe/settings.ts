/** Optional access keys, kept in localStorage (never required). */
const K_ION = 'meridiano.cesiumIonToken';
const K_GOOGLE = 'meridiano.googleMapsKey';

function get(k: string): string {
  try {
    return localStorage.getItem(k) ?? '';
  } catch {
    return '';
  }
}
function set(k: string, v: string) {
  try {
    if (v) localStorage.setItem(k, v);
    else localStorage.removeItem(k);
  } catch {
    /* storage unavailable */
  }
}
export const accessKeys = {
  ionToken: () => get(K_ION),
  googleKey: () => get(K_GOOGLE),
  setIonToken: (v: string) => set(K_ION, v.trim()),
  setGoogleKey: (v: string) => set(K_GOOGLE, v.trim()),
};
