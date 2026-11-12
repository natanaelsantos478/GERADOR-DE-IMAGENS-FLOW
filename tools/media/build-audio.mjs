// Builds public/audio/*.ogg + manifest.json from raw downloads in tools/.cache/media (see oga-fetch.sh / wiki-get.mjs).
// Every sound is a real recording (CC0 / public domain / CC-BY) except ui_* and notify_*, which are declared synth.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const C = path.resolve(here, '../.cache/media');
const OUT = path.resolve(here, '../../public/audio');
const TMP = path.join(C, 'build-tmp');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });
const FF = process.env.FFMPEG || 'ffmpeg';
const ff = (args) => execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
const probe = (f) => parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());

// --- source metadata ---
const oga = (slug, file, extra = {}) => {
  const m = Object.fromEntries(fs.readFileSync(path.join(C, 'oga', slug, 'meta.txt'), 'utf8').trim().split('\n').map((l) => l.split(/=(.*)/s).slice(0, 2)));
  return { p: path.join(C, 'oga', slug, file), license: m.license, author: m.author, source: m.source, ...extra };
};
const wiki = (file) => {
  const m = JSON.parse(fs.readFileSync(path.join(C, 'wiki', file + '.meta.json'), 'utf8'));
  return { p: path.join(C, 'wiki', file), license: m.license, author: m.author, source: m.source };
};
const pack150 = (sub, file, who, srcUrl) => ({
  p: path.join(C, 'x/150', sub, file), license: 'CC0', author: who + ' (via untamedpixels "150 Combat Sound Effects")',
  source: srcUrl + ' ; https://opengameart.org/content/150-combat-sound-effects',
});
const firearm = (dir, file) => ({
  p: path.join(C, 'x/fire/Prepared SFX Library', dir, file), license: 'CC0', author: 'Ben Jaszczak et al. (bart)',
  source: 'https://opengameart.org/content/the-free-firearm-sound-library',
});

// --- ffmpeg helpers ---
const SFX_Q = ['-ac', '1', '-ar', '44100', '-c:a', 'libvorbis', '-q:a', '3'];
const MUS_Q = ['-ac', '2', '-ar', '44100', '-c:a', 'libvorbis', '-b:a', '112k'];
import { spawnSync } from 'node:child_process';
const peakDb = (file) => {
  // astats works on float samples, so it reports true peaks above 0 dBFS (volumedetect clips at 0)
  const r = spawnSync(FF, ['-hide_banner', '-i', file, '-af', 'astats', '-f', 'null', '-'], { encoding: 'utf8' });
  const all = [...r.stderr.matchAll(/Peak level dB: (-?[\d.]+|-inf)/g)].map((m) => parseFloat(m[1]));
  return Math.max(...all);
};
// render a filter graph from inputs into a temp wav, then peak-normalise and encode
function render({ inputs, graph, dur, loop, music, out, peak = -2.5, loud }) {
  const tmp = path.join(TMP, out + '.wav');
  const args = [];
  for (const i of inputs) args.push(...(i.args || []), '-i', i.p);
  args.push('-filter_complex', graph, '-map', '[o]', '-ar', '44100', '-c:a', 'pcm_f32le', tmp);
  ff(args);
  let norm;
  if (loud) norm = `loudnorm=I=${loud}:TP=-1.5:LRA=11`;
  else norm = `volume=${(peak - peakDb(tmp)).toFixed(2)}dB`;
  const tmp2 = path.join(TMP, out + '.n.wav');
  ff(['-i', tmp, '-af', norm, '-ar', '44100', '-c:a', 'pcm_f32le', tmp2]);
  const dst = path.join(OUT, out + '.ogg');
  ff(['-i', tmp2, ...(music ? MUS_Q : SFX_Q), dst]);
  return dst;
}
const fade = (d, s = 0.004) => `afade=t=in:d=${s},afade=t=out:st=${Math.max(0, d - 0.08).toFixed(3)}:d=0.08`;
// seamless loop: crossfade the last X seconds of [a,b] into its head -> clip of length (b-a-X). Done in 3 steps (files)
// because ffmpeg's concat refuses amix output inside a single graph.
const loopClip = (src, a, b, x, pre, name) => {
  const L = b - a, T = (n) => path.join(TMP, `${name}.${n}.wav`);
  const pf = pre ? pre + ',' : '';
  ff(['-i', src.p, '-af', `${pf}atrim=${a}:${b},asetpts=PTS-STARTPTS`, '-ar', '44100', '-ac', '1', T('seg')]);
  ff(['-i', T('seg'), '-af', `atrim=0:${x},asetpts=PTS-STARTPTS,afade=t=in:d=${x}:curve=hsin`, T('head')]);
  ff(['-i', T('seg'), '-af', `atrim=${L - x}:${L},asetpts=PTS-STARTPTS,afade=t=out:d=${x}:curve=hsin`, T('tail')]);
  ff(['-i', T('head'), '-i', T('tail'), '-filter_complex', '[0:a][1:a]amix=inputs=2:normalize=0:duration=longest[o]', '-map', '[o]', T('x')]);
  ff(['-i', T('seg'), '-af', `atrim=${x}:${L - x},asetpts=PTS-STARTPTS`, T('mid')]);
  ff(['-i', T('x'), '-i', T('mid'), '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1[o]', '-map', '[o]', T('loop')]);
  return { ...src, p: T('loop') };
};
const mono = 'pan=mono|c0=0.5*c0+0.5*c1';
const pitch = (r) => `asetrate=44100*${r},aresample=44100`;

// --- synth (declared) for ui_* / notify_* ---
function synth(out, tones, { peak = -3 } = {}) {
  // tone: [freqHz, startS, durS, decay]
  const inputs = tones.map(([f, , d, k]) => `aevalsrc=exprs='0.6*sin(2*PI*${f}*t)*exp(-t*${k})':d=${d}:s=44100`);
  const args = [];
  for (const s of inputs) args.push('-f', 'lavfi', '-i', s);
  const g = tones.map(([, st, d], i) => `[${i}:a]afade=t=in:d=0.003,afade=t=out:st=${(d - 0.02).toFixed(3)}:d=0.02,adelay=${Math.round(st * 1000)}:all=1[a${i}]`).join(';') +
    `;${tones.map((_, i) => `[a${i}]`).join('')}amix=inputs=${tones.length}:normalize=0[o]`;
  const tmp = path.join(TMP, out + '.wav');
  ff([...args, '-filter_complex', g, '-map', '[o]', tmp]);
  const tmp2 = path.join(TMP, out + '.n.wav');
  ff(['-i', tmp, '-af', `volume=${(peak - peakDb(tmp)).toFixed(2)}dB`, tmp2]);
  ff(['-i', tmp2, ...SFX_Q, path.join(OUT, out + '.ogg')]);
}

const S = {}; // id -> { sources:[], note, loop?, synth? }
const add = (id, sources, note, extra = {}) => { S[id] = { sources, note, ...extra }; };
const one = (s, g, o = {}) => ({ inputs: [s], graph: g, ...o });
const spec = {};

// ---------- weapons ----------
{
  const s = firearm('AK-47', 'C_29P.wav');
  spec.rifle_burst = one(s, `[0:a]${mono},atrim=1.0:2.6,asetpts=PTS-STARTPTS,${fade(1.6)}[o]`);
  add('rifle_burst', [s], 'AK-47 short burst, 1.0-2.6 s excerpt');
  const m = firearm('PPSh', 'P_34P.wav');
  spec.mg_burst = one(m, `[0:a]${mono},atrim=0.62:2.5,asetpts=PTS-STARTPTS,${fade(1.88)}[o]`);
  add('mg_burst', [m], 'PPSh submachine gun long burst, 0.62-2.5 s excerpt');
  const c = oga('cannon-fire', 'cannon_fire.ogg');
  spec.tank_cannon = one(c, `[0:a]${mono},atrim=0:2.6,${fade(2.6)}[o]`);
  add('tank_cannon', [c], 'cannon shot, first 2.6 s');
  const a = wiki('01_Salute_Cannon_Reveille.ogg');
  spec.artillery_fire = one(a, `[0:a]${mono},atrim=0.3:3.4,asetpts=PTS-STARTPTS,${pitch(0.85)},lowpass=f=7000,${fade(3.6)}[o]`);
  add('artillery_fire', [a], 'US Army salute cannon, first shot 0.3-3.4 s, pitched down 15% and low-passed for weight');
  const r = oga('rocket-launch', 'l.mp3');
  spec.missile_launch = one(r, `[0:a]${mono},${fade(5.9)}[o]`);
  add('missile_launch', [r], 'rocket launch, whole clip');
  spec.mlrs_salvo = { inputs: [r], graph: `[0:a]${mono},asplit=3[a][b][c];[a]${pitch(1)}[a1];[b]${pitch(0.94)},adelay=420[b1];[c]${pitch(1.07)},adelay=950[c1];[a1][b1][c1]amix=inputs=3:normalize=0,atrim=0:7,${fade(7)}[o]` };
  add('mlrs_salvo', [r], 'three overlapped, pitch-shifted copies of the rocket launch recording (420/950 ms offsets) to make a salvo');
  const e = oga('rocket-engine', 'rocket_engine.001.wav');
  spec.sam_launch = one(e, `[0:a]${mono},atrim=0.5:4,asetpts=PTS-STARTPTS,${pitch(1.15)},afade=t=in:d=0.25,afade=t=out:st=2.6:d=0.7[o]`);
  add('sam_launch', [e], 'rocket motor loop, 3.5 s excerpt with fade-in, pitched up 15%');
}
// ---------- explosions ----------
{
  const s = wiki('Explosion_10.ogg');
  spec.explosion_small = one(s, `[0:a]${mono},${fade(2.7)}[o]`);
  add('explosion_small', [s], 'whole clip');
  const lf = pack150('03_explosions_destruction', 'low_frequency_explosion_000_48kHz_16bit_2s_84586419_s04.wav', 'Kenney (Sci-fi Sounds)', 'https://kenney.nl/assets/sci-fi-sounds');
  const cr = pack150('03_explosions_destruction', 'explosion_crunch_004_48kHz_16bit_1.98s_b6838d5c_s04.wav', 'Kenney (Sci-fi Sounds)', 'https://kenney.nl/assets/sci-fi-sounds');
  const mu = oga('muffled-distant-explosion', 'nenadsimic__muffled_distant_explosion.ogg');
  spec.explosion_large = { inputs: [lf, cr, mu], graph: `[0:a]${mono}[a];[1:a]${mono}[b];[2:a]${mono},adelay=250[c];[a][b][c]amix=inputs=3:normalize=0,atrim=0:5.5,${fade(5.5)}[o]` };
  add('explosion_large', [lf, cr, mu], 'layered: low-frequency blast + crunch + delayed muffled distant explosion');
  spec.nuke = { inputs: [mu, lf, cr], graph: `[0:a]${mono},${pitch(0.6)}[a];[1:a]${mono},${pitch(0.5)},adelay=100[b];[2:a]${mono},${pitch(0.6)},adelay=60[c];[a][b][c]amix=inputs=3:normalize=0,lowpass=f=5000,atrim=0:9,afade=t=in:d=0.01,afade=t=out:st=6.5:d=2.5[o]` };
  add('nuke', [mu, lf, cr], 'same three explosion recordings slowed to 50-60% speed (deeper, longer) and low-passed');
}
// ---------- vehicles ----------
{
  const j = oga('fighter-engine-flyby', 'engine1.wav');
  spec.jet_flyby = one(j, `[0:a]${mono},${fade(1.96)}[o]`);
  add('jet_flyby', [j], 'fighter engine flyby, whole clip');
  const h = oga('helicopter-sounds', 'helicopter_0.mp3');
  spec.heli_loop = { inputs: [loopClip(h, 8, 24, 1.0, mono, 'heli')], graph: '[0:a]anull[o]' };
  add('heli_loop', [h], 'helicopter recording, 8-24 s with 1 s equal-power crossfade loop', { loop: true });
  const hn = wiki('Fog_signal_Bremerhaven.ogg');
  spec.ship_horn = one(hn, `[0:a]${mono},atrim=0:5.5,${fade(5.5)}[o]`);
  add('ship_horn', [hn], 'harbour fog horn, first 5.5 s');
  const en = oga('engine-sounds2', 'engine_sound.mp3');
  spec.engine_tank_loop = { inputs: [loopClip(en, 3, 17, 0.8, `${mono},${pitch(0.8)}`, 'engine')], graph: '[0:a]anull[o]' };
  add('engine_tank_loop', [en], 'engine recording 3-17 s, pitched down 20% for a heavy diesel, 0.8 s crossfade loop', { loop: true });
  const sr = wiki('Civil-defense-siren-waver.ogg');
  spec.air_raid_siren = { inputs: [loopClip(sr, 14, 34, 1.5, mono, 'siren')], graph: '[0:a]anull[o]' };
  add('air_raid_siren', [sr], 'civil defense siren (waver), 14-34 s with 1.5 s crossfade loop', { loop: true });
}
// ---------- radio ----------
{
  const p = wiki('Gts_bbc_pips.ogg');
  spec.radio_ack_1 = one(p, `[0:a]${mono},atrim=0.95:1.2,asetpts=PTS-STARTPTS,afade=t=in:d=0.002,afade=t=out:st=0.2:d=0.05[o]`);
  add('radio_ack_1', [p], 'single time-signal pip');
  spec.radio_ack_2 = one(p, `[0:a]${mono},atrim=0.95:2.2,asetpts=PTS-STARTPTS,afade=t=in:d=0.002,afade=t=out:st=1.2:d=0.05[o]`);
  add('radio_ack_2', [p], 'two time-signal pips');
  const sp = wiki('Sputnik_beep.ogg');
  spec.radio_ack_3 = one(sp, `[0:a]${mono},atrim=0:0.75,afade=t=in:d=0.005,afade=t=out:st=0.65:d=0.1[o]`);
  add('radio_ack_3', [sp], 'Sputnik-1 beep, first 0.75 s');
}
// ---------- events ----------
{
  const bc = { ...oga('residue-sfx', 'x'), p: path.join(C, 'x/res/residue-sfx/healthpack.ogg') };
  spec.build_complete = one(bc, `[0:a]${mono},${fade(0.96, 0.002)}[o]`);
  add('build_complete', [bc], 'whole clip (Residue SFX "healthpack")');
  const rc = pack150('04_magic_spells', 'Healing Spell Impact 12_s08.wav', 'lentikula (Healing Spell Impacts)', 'https://lentikula.itch.io/healing-spell-impacts');
  spec.research_complete = one(rc, `[0:a]${mono},${fade(1.98, 0.002)}[o]`);
  add('research_complete', [rc], 'whole clip');
  const pc = pack150('04_magic_spells', 'Healing Spell Impact 3_s08.wav', 'lentikula (Healing Spell Impacts)', 'https://lentikula.itch.io/healing-spell-impacts');
  spec.peace = one(pc, `[0:a]${mono},${fade(2.5, 0.002)}[o]`);
  add('peace', [pc], 'whole clip');
  const tp = wiki('Timpani_64-c-p5.wav');
  const fh = wiki('Original_foghorn_at_East_Brother_Island_Lighthouse.ogg');
  spec.war_declared = { inputs: [tp, fh], graph: `[0:a]${mono},atrim=0:4.5,asetpts=PTS-STARTPTS[a];[1:a]${mono},volume=0.7,adelay=150[b];[a][b]amix=inputs=2:normalize=0,atrim=0:4.8,${fade(4.8)}[o]` };
  add('war_declared', [tp, fh], 'timpani hit + diaphone foghorn');
  const w = oga('wind-whoosh-loop', 'wind_woosh_loop.ogg');
  spec.ambient_wind_loop = { inputs: [loopClip(w, 0, 5.95, 0.4, mono, 'wind')], graph: '[0:a]anull[o]' };
  add('ambient_wind_loop', [w], 'wind recording with 0.4 s crossfade loop', { loop: true });
}
// ---------- music ----------
{
  const mm = oga('heavenly-loop', 'Heavenly_Loop.ogg');
  spec.music_menu = { inputs: [mm], graph: '[0:a]anull[o]', music: true, loud: -20, loop: true };
  add('music_menu', [mm], '"Heavenly Loop", whole track, loudness-normalised to -20 LUFS', { loop: true });
  const mp = oga('peace-at-last-loop', 'peace_at_last.mp3');
  spec.music_peace_1 = { inputs: [mp], graph: '[0:a]anull[o]', music: true, loud: -20, loop: true };
  add('music_peace_1', [mp], '"Peace at Last (loop)", whole track, loudness-normalised', { loop: true });
  const mw = oga('war-theme', 'war_theme.ogg');
  spec.music_war_1 = { inputs: [mw], graph: '[0:a]atrim=0:150,afade=t=out:st=144:d=6[o]', music: true, loud: -18 };
  add('music_war_1', [mw], '"War Theme", first 150 s with 6 s fade-out, loudness-normalised');
}

for (const [id, sp] of Object.entries(spec)) render({ ...sp, out: id });

// ---------- synth (declared) ----------
const synths = {
  ui_click: [[1800, 0, 0.05, 90]],
  ui_hover: [[1200, 0, 0.04, 120]],
  ui_open: [[520, 0, 0.12, 25], [780, 0.05, 0.14, 25]],
  ui_close: [[780, 0, 0.12, 25], [520, 0.05, 0.14, 25]],
  ui_error: [[180, 0, 0.22, 10], [190, 0.12, 0.25, 10]],
  notify_info: [[880, 0, 0.35, 9], [1320, 0.12, 0.4, 8]],
  notify_alert: [[988, 0, 0.18, 6], [988, 0.22, 0.18, 6], [740, 0.44, 0.4, 5]],
};
for (const [id, t] of Object.entries(synths)) {
  synth(id, t);
  S[id] = { sources: [], synth: true, note: 'synthesised sine tones (ffmpeg aevalsrc), original work of this project' };
}

// ---------- manifest ----------
const uniq = (a) => [...new Set(a)];
const manifest = {};
for (const id of Object.keys(S).sort()) {
  const f = path.join(OUT, id + '.ogg');
  const s = S[id];
  const e = {
    file: `${id}.ogg`,
    license: s.synth ? 'CC0 (original synthesis)' : uniq(s.sources.map((x) => x.license)).join(' + '),
    author: s.synth ? 'Meridiano project' : uniq(s.sources.map((x) => x.author)).join(' ; '),
    source: s.synth ? 'generated by tools/media/build-audio.mjs' : uniq(s.sources.map((x) => x.source)).join(' ; '),
    durationS: +probe(f).toFixed(2),
    bytes: fs.statSync(f).size,
  };
  if (s.loop) e.loop = true;
  if (s.synth) e.synth = true;
  e.processing = s.note;
  manifest[id] = e;
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(Object.keys(manifest).length, 'sounds');

// ---------- LICENSES.md ----------
const rows = Object.entries(manifest).map(([id, e]) => `| ${id} | ${e.license} | ${e.author.replace(/\|/g, '/')} | ${e.source.split(' ; ').map((u) => `<${u}>`).join('<br>')} |`);
fs.writeFileSync(path.join(OUT, 'LICENSES.md'), `# Audio licenses and attributions

All sounds are real recordings from the sources below (CC0 / public domain / CC-BY), edited (cut, normalised, pitch/layer changes,
loop crossfades) with ffmpeg via \`tools/media/build-audio.mjs\`; exact edits per sound are in \`manifest.json\` ("processing").
Exceptions, declared \`"synth": true\`: \`ui_*\` and \`notify_*\` are synthesised sine tones (original work, CC0).

## Attribution required (CC-BY)
- \`jet_flyby\`: "Fighter engine flyby" by dklon (https://opengameart.org/content/fighter-engine-flyby), licensed CC-BY 3.0
  (https://creativecommons.org/licenses/by/3.0/). Edited: converted to mono ogg, faded.

## Per-sound table
| id | license | author | source |
|---|---|---|---|
${rows.join('\n')}

Source packs: OpenGameArt.org (uploaders credited above), Wikimedia Commons (public domain / CC0 files), Kenney.nl (CC0, via the
"150 Combat Sound Effects" compilation), lentikula (CC0), Kronbits (CC0).
`);
