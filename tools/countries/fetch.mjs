// Downloads Natural Earth countries + World Bank indicators into tools/.cache (uses curl: respects HTTPS_PROXY/CA bundle).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const CACHE = join(here, '..', '.cache');
mkdirSync(CACHE, { recursive: true });

export const INDICATORS = [
  'SP.POP.TOTL', 'NY.GDP.MKTP.CD', 'NY.GDP.MKTP.KD.ZG', 'MS.MIL.XPND.CD',
  'MS.MIL.TOTL.P1', 'EG.USE.ELEC.KH.PC', 'SP.URB.TOTL.IN.ZS', 'SP.DYN.LE00.IN',
];
export const NE_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson';

function get(url, out) {
  if (existsSync(out) && statSync(out).size > 1000 && !process.env.REFETCH) return;
  console.log('fetch', url);
  const tmp = out + '.part';
  execFileSync('curl', ['-sS', '-L', '--fail', '--retry', '3', '--max-time', '300', '-o', tmp, url], { stdio: 'inherit' });
  renameSync(tmp, out);
}

get(NE_URL, join(CACHE, 'ne_countries.geojson'));
for (const ind of INDICATORS) {
  get(`https://api.worldbank.org/v2/country/all/indicator/${ind}?format=json&per_page=20000&date=2015:2025`, join(CACHE, `wb_${ind}.json`));
}
