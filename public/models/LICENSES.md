# 3D model licences and attribution

All models are converted/composed by `tools/models` (see `build.mjs`, `defs.mjs`). Conversion, recolouring, mesh
simplification, texture downscaling (<=1024 px) and re-centring were applied (CC-BY "changes indicated").
Procedural ground slabs (airport, port, military_base, city_block, plant_hydro dam/reservoir) are original work, CC0.

## Required attribution (CC-BY)
- **Polyfork** - models marked "Polyfork" below, CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/),
  catalogue https://polyfork.dev (https://github.com/lucas-martinic/polyfork-catalog). Credit: "<name> by Polyfork (https://polyfork.dev), CC BY 4.0".
- **Geibu3D (Cheese Animal Productions)** - "Attack Chopper", CC BY 4.0, https://opengameart.org/content/attack-chopper (Apache camo-green texture from the same pack).

## CC0 / public domain (attribution given as courtesy)
- **Quaternius** - Ultimate Animated Character Pack, Ultimate Gun Pack: CC0 - https://opengameart.org/content/animated-characters-pack , /low-poly-guns-pack
- **mfonasd** (Antonov An-28) and **app4soft** (Glider Flying): CC0 - https://opengameart.org/content/antonov-an-28-3d-model , /glider-flying
- **yd** - "Cimpletoon" freeciv unit set, CC0 (credits file: some meshes originate from public-domain Blend Swap models by Joni Vvaris, Edimar Dos Reis Silva, Praydude, anonymous): https://opengameart.org/content/blender-models-for-freeciv-units
- **Sketlux** - Abrams tank, Mobile SAM (rocket-launcher truck), Container ship full: CC0 - https://opengameart.org/content/abrams-tank , /mobile-sam , /container-ship-full
- **vi1e8** - Cooling Tower, CC0 (dual CC-BY 3.0/CC0 listing; used under CC0): https://opengameart.org/content/cooling-tower
- **Kenney (kenney.nl)** - City Kit (Industrial), City Kit (Commercial), Blocky Characters: CC0 - https://opengameart.org/content/city-kit-industrial , /city-kit-commercial , /blocky-characters

## Per model
| modelId | source model(s) | author | licence |
|---|---|---|---|
| mbt | Abrams tank (recoloured olive) | Sketlux | CC0 |
| ifv | Cimpletoon mechinf (recoloured olive) | yd | CC0 |
| apc | Armoured Half-Track | Polyfork | CC BY 4.0 |
| truck | Military Cargo Truck | Polyfork | CC BY 4.0 |
| spg (composite) | Tracked Crawler chassis + Towed Field Howitzer gun (olive recolour) | Polyfork | CC BY 4.0 |
| mlrs | Mobile SAM (actually rocket launcher truck) | Sketlux | CC0 |
| sam (composite, substitute) | 8-Wheel Industrial Hauler (olive) + procedural launch canisters (own work, CC0) | Polyfork / own | CC BY 4.0 / CC0 |
| radar (composite) | 8-Wheel Industrial Hauler (olive) + Sensor Dish | Polyfork | CC BY 4.0 |
| attack_heli | Attack Chopper | Geibu3D | CC BY 4.0 |
| transport_heli | Cimpletoon helicopter02 | yd | CC0 |
| fighter | Cimpletoon stealthfighter (recoloured) | yd | CC0 |
| bomber | Cimpletoon stealth_bomber1 | yd | CC0 |
| transport_plane (substitute) | Antonov An-28 (recoloured grey) | mfonasd | CC0 |
| drone (substitute) | Glider Flying (recoloured grey, stand-in for a MALE UAV) | app4soft | CC0 |
| destroyer | Cimpletoon destroyer1 | yd | CC0 |
| frigate | Cimpletoon cruiser01 | yd | CC0 |
| carrier | Cimpletoon carrier01 | yd | CC0 |
| submarine | Cimpletoon submarine | yd | CC0 |
| cargo_ship | Container ship full (decimated) | Sketlux | CC0 |
| missile | Cimpletoon cruise_missile01 | yd | CC0 |
| wind_turbine | City Kit Industrial "windmill" | Kenney | CC0 |
| solar_farm | City Kit Industrial solar-panel-landscape-group x9 | Kenney | CC0 |
| factory | City Kit Industrial building-m/p/a/d | Kenney | CC0 |
| plant_thermal | Riveted Boiler Hall, Cowled Chimney Stack x2 (Polyfork); detail-tank-large, building-a (Kenney) | Polyfork / Kenney | CC BY 4.0 / CC0 |
| refinery | detail-tank-large x3 (Kenney); Horizontal Tank x2, Cowled Chimney Stack, Pipe Run (Polyfork) | Kenney / Polyfork | CC0 / CC BY 4.0 |
| plant_nuclear | Cooling Tower x2 (vi1e8); Reactor Block (Polyfork) | vi1e8 / Polyfork | CC0 / CC BY 4.0 |
| plant_hydro (substitute) | procedural arch dam/reservoir/river (own work, CC0); Kenney building-i, building-k | own / Kenney | CC0 |
| airport | Airfield Control Tower, Shuttle Hangar, Vehicle Depot Hangar, Landing Pad | Polyfork | CC BY 4.0 |
| port | Dock Cargo Crane x2, Dock Warehouse, Cargo Container x5 | Polyfork | CC BY 4.0 |
| military_base | Command Center, Nissen Hut x2, Concrete Pillbox, Sentry Box, Landing Pad, Anti-Aircraft Gun | Polyfork | CC BY 4.0 |
| city_block | City Kit Commercial skyscraper-a/c/e, building-a | Kenney | CC0 |
| capital_building | Civic Dome Pavilion | Polyfork | CC BY 4.0 |

<!-- VARIANTS:BEGIN -->
## Real-world vehicle variants (`tools/models/variants.defs.json`)

Each model below is a real vehicle/aircraft/ship/person modelled by third-party artists, converted by `tools/models` (fg2glb.py, stl2glb.py, any2glb.py, variants-finish.mjs): composition of the exterior meshes, re-orientation (nose to +Z), flat painting of untextured STL models, mesh decimation, texture downscale (<=1024 px, jpg/png), scale to real metres. Those are the changes made (CC-BY "changes indicated").

**Share-alike / copyleft notice.** Entries marked SA (GPL-2.0-or-later FlightGear aircraft/ships, CC-BY-SA, GPL) carry `"shareAlike": true` in manifest.json. Derived models stay under the same licence; shipping them requires publishing the converted glb and its source references (this table + `tools/models`) under that licence, and keeping the notices. FlightGear aircraft are GPL (individual authors are named in each aircraft's `-set.xml`/README inside the upstream zip linked as source). Model names/designations are descriptive only.

| id | real name | origin | author | licence | SA | source |
|---|---|---|---|---|---|---|
| mbt_m1abrams | M1A1 Abrams | USA | Wei He (Xdhsqj) | CC-BY-4.0 |  | https://www.thingiverse.com/thing:4324208 |
| mbt_leopard2 | Leopard 2A6 | DEU | Wei He (Xdhsqj) | CC-BY-4.0 |  | https://www.thingiverse.com/thing:4324199 |
| mbt_leclerc | AMX-56 Leclerc | FRA | Wei He (Xdhsqj) | CC-BY-4.0 |  | https://www.thingiverse.com/thing:4324192 |
| mbt_challenger2 | Challenger 2 | GBR | Wei He (Xdhsqj) | CC-BY-4.0 |  | https://www.thingiverse.com/thing:4324185 |
| mbt_t72 | T-72 | RUS | Wei He (Xdhsqj) | CC-BY-4.0 |  | https://www.thingiverse.com/thing:4324265 |
| mbt_t90 | T-90 | RUS | Wei He (Xdhsqj) | CC-BY-4.0 |  | https://www.thingiverse.com/thing:4334951 |
| mbt_type99 | ZTZ-99A (Type 99A) | CHN | Wei He (Xdhsqj) | CC-BY-4.0 |  | https://www.thingiverse.com/thing:4324227 |
| mbt_strv103 | Stridsvagn 103 (S-tank) | SWE | canisferus | CC-BY-3.0 |  | https://opengameart.org/content/stridsvagn-103 |
| apc_btr80 | BTR-80 | RUS | Glug Glug (TenkEnthusiast) | CC-BY-4.0 |  | https://www.thingiverse.com/thing:5662670 |
| ifv_puma | Schützenpanzer Puma | DEU | Joachim Schwarz (Blackbird) | CC-BY-4.0 |  | https://www.thingiverse.com/thing:4961768 |
| apc_boxer | GTK Boxer | DEU | Joachim Schwarz (Blackbird) | CC-BY-4.0 |  | https://www.thingiverse.com/thing:4957830 |
| ifv_bradley | M2 Bradley | USA | Jack Dueri (JackTheT) | CC-BY-4.0 |  | https://www.thingiverse.com/thing:5496813 |
| apc_fennek | Fennek | DEU | Joachim Schwarz (Blackbird) | CC-BY-4.0 |  | https://www.thingiverse.com/thing:4943700 |
| spg_m109 | M109A3G | USA | Joachim Schwarz (Blackbird) | CC-BY-4.0 |  | https://www.thingiverse.com/thing:5373940 |
| spg_pzh2000 | Panzerhaubitze 2000 | DEU | Joachim Schwarz (Blackbird) | CC-BY-4.0 |  | https://www.thingiverse.com/thing:5022607 |
| spg_2s1 | 2S1 Gvozdika | RUS | Joachim Schwarz (Blackbird) | CC-BY-4.0 |  | https://www.thingiverse.com/thing:4974140 |
| spg_2s3 | 2S3 Akatsiya | RUS | Joachim Schwarz (Blackbird) | CC-BY-4.0 |  | https://www.thingiverse.com/thing:4944605 |
| spg_rch155 | RCH 155 | DEU | Joachim Schwarz (Blackbird) | CC-BY-4.0 |  | https://www.thingiverse.com/thing:5351925 |
| mlrs_m270 | M270 MLRS | USA | Joachim Schwarz (Blackbird) | CC-BY-4.0 |  | https://www.thingiverse.com/thing:5023390 |
| mlrs_tos1 | TOS-1 Buratino | RUS | Joachim Schwarz (Blackbird) | CC-BY-4.0 |  | https://www.thingiverse.com/thing:5338294 |
| mlrs_iskander | 9K720 Iskander (SS-26) | RUS | Joachim Schwarz (Blackbird) | CC-BY-4.0 |  | https://www.thingiverse.com/thing:5343360 |
| sam_pantsir | Pantsir-S1 | RUS | Joachim Schwarz (Blackbird) | CC-BY-4.0 |  | https://www.thingiverse.com/thing:4956994 |
| sam_tor | 9K330 Tor (SA-15) | RUS | Joachim Schwarz (Blackbird) | CC-BY-4.0 |  | https://www.thingiverse.com/thing:4968754 |
| sam_s300 | S-300 (Favorit) | RUS | Jack Dueri (JackTheT) | CC-BY-4.0 |  | https://www.thingiverse.com/thing:5496828 |
| sam_tunguska | 2K22 Tunguska | RUS | Sean Sikora (Scas678) | CC-BY-4.0 |  | https://www.thingiverse.com/thing:2920050 |
| fighter_j20 | Chengdu J-20 | CHN | Jack Dueri (JackTheT) | CC-BY-4.0 |  | https://www.thingiverse.com/thing:5496401 |
| fighter_su35 | Sukhoi Su-35 | RUS | Diego Garcia (FoxFan) | CC-BY-4.0 |  | https://www.thingiverse.com/thing:5232643 |
| fighter_f16 | F-16 Fighting Falcon | USA | Justin Kanarick (airplane guy) | CC-BY-4.0 |  | https://www.thingiverse.com/thing:2385491 |
| bomber_tu160 | Tupolev Tu-160 | RUS | Jack Dueri (JackTheT) | CC-BY-4.0 |  | https://www.thingiverse.com/thing:5496344 |
| transport_a400m | Airbus A400M Atlas | DEU | Theta 687 | CC-BY-4.0 |  | https://www.thingiverse.com/thing:4973174 |
| transport_c17 | C-17 Globemaster III | USA | Jay Crispy (Hailstorm) | CC-BY-4.0 |  | https://www.thingiverse.com/thing:5167227 |
| drone_tb2 | Bayraktar TB2 | TUR | Moon Ztar | CC-BY-4.0 |  | https://www.thingiverse.com/thing:5519530 |
| destroyer_arleigh_burke | Arleigh Burke-class (DDG-51) | USA | Justyn Au (Scuderia) | CC-BY-4.0 |  | https://www.thingiverse.com/thing:4207292 |
| carrier_nimitz | Nimitz-class carrier | USA | Jack Dueri (JackTheT) | CC-BY-4.0 |  | https://www.thingiverse.com/thing:5494672 |
| submarine_virginia | Virginia-class (SSN-774) | USA | Magix Stix (stix) | CC-BY-4.0 |  | https://www.thingiverse.com/thing:2163754 |
| fighter_f35 | F-35B Lightning II | USA | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/F-35B.zip |
| fighter_f22 | F-22 Raptor | USA | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/Lockheed-Martin-FA-22A-Raptor.zip |
| fighter_f18 | F/A-18 Hornet | USA | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/f18.zip |
| fighter_f14 | F-14B Tomcat | USA | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/f-14b.zip |
| fighter_f4 | F-4 Phantom II | USA | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/McDonnell-F-4-Phantom.zip |
| fighter_f117 | F-117 Nighthawk | USA | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/F-117.zip |
| fighter_a10 | A-10 Thunderbolt II | USA | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/A-10.zip |
| fighter_harrier | Harrier GR.3 | GBR | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/harrier.zip |
| fighter_su37 | Sukhoi Su-37 (Su-27 family) | RUS | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/SU-37.zip |
| fighter_su33 | Sukhoi Su-33 | RUS | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/Sukhoi-Su-33.zip |
| fighter_su25 | Sukhoi Su-25 | RUS | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/Su-25.zip |
| fighter_su57 | Sukhoi T-50 (Su-57 prototype) | RUS | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/T-50.zip |
| fighter_mig21 | MiG-21bis | RUS | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/MiG-21bis.zip |
| fighter_yak130 | Yakovlev Yak-130 | RUS | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/Yak-130.zip |
| fighter_eurofighter | Eurofighter Typhoon | GBR | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/eurofighter.zip |
| fighter_gripen | Saab JAS 39 Gripen | SWE | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/JAS39-Gripen.zip |
| fighter_viggen | Saab JA 37 Viggen | SWE | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/JA37.zip |
| fighter_mirage2000 | Dassault Mirage 2000 | FRA | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/mirage2000.zip |
| fighter_miragef1 | Dassault Mirage F1 | FRA | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/Mirage_F1.zip |
| fighter_jaguar | SEPECAT Jaguar | GBR | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/Jaguar.zip |
| fighter_superetendard | Dassault Super Etendard | FRA | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/Super-Etendard.zip |
| bomber_b52 | B-52 Stratofortress | USA | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/B-52F.zip |
| bomber_b1b | B-1B Lancer | USA | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/B-1B.zip |
| bomber_b2 | B-2 Spirit | USA | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/B-2.zip |
| bomber_tu95 | Tupolev Tu-95 Bear | RUS | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/TU-95.zip |
| bomber_tu22 | Tupolev Tu-22 Blinder | RUS | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/Tu-22-Blinder.zip |
| transport_c130 | C-130 Hercules | USA | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/C130.zip |
| transport_il76 | Ilyushin Il-76 | RUS | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/IL-76.zip |
| transport_c160 | Transall C-160 | DEU | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/C-160-Transall.zip |
| transport_c212 | CASA C-212 Aviocar | ESP | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/Casa-212.zip |
| transport_an12 | Antonov An-12 | UKR | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/Antonov-An-12.zip |
| transport_an22 | Antonov An-22 | UKR | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/Antonov-An-22.zip |
| transport_an225 | Antonov An-225 Mriya | UKR | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/AN-225.zip |
| transport_kc135 | Boeing KC-135 Stratotanker | USA | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/KC135.zip |
| attack_heli_apache | AH-64 Apache | USA | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/apache.zip |
| attack_heli_mi24 | Mil Mi-24 Hind | RUS | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/Mil-Mi-24.zip |
| attack_heli_ka50 | Kamov Ka-50 Black Shark | RUS | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/Ka-50.zip |
| attack_heli_tiger | Eurocopter Tiger | FRA | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/Tigre.zip |
| attack_heli_oh58 | Bell OH-58D Kiowa Warrior | USA | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/OH-58D.zip |
| attack_heli_oh1 | Kawasaki OH-1 | JPN | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/OH-1.zip |
| transport_heli_uh60 | UH-60 Black Hawk | USA | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/UH-60.zip |
| transport_heli_ch47 | CH-47 Chinook | USA | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/ch47.zip |
| transport_heli_v22 | V-22 Osprey | USA | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/V22-Osprey.zip |
| drone_mq9 | MQ-9 Reaper | USA | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/MQ-9.zip |
| destroyer_cg47 | Ticonderoga-class cruiser (CG-47) | USA | FlightGear project contributors | GPL-2.0-or-later | SA | https://sourceforge.net/p/flightgear/fgdata/ci/next/tree/Models/Maritime/Military/ |
| frigate_perry | Oliver Hazard Perry-class frigate | USA | FlightGear project contributors | GPL-2.0-or-later | SA | https://sourceforge.net/p/flightgear/fgdata/ci/next/tree/Models/Maritime/Military/ |
| amphib_lpd17 | San Antonio-class (LPD-17) | USA | FlightGear project contributors | GPL-2.0-or-later | SA | https://sourceforge.net/p/flightgear/fgdata/ci/next/tree/Models/Maritime/Military/ |
| civil_737_800 | Boeing 737-800 | USA | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/737-800.zip |
| civil_a320 | Airbus A320 | FRA | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/A320-family.zip |
| civil_tu154 | Tupolev Tu-154B | RUS | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/tu154b.zip |
| civil_747_400 | Boeing 747-400 | USA | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/747-400.zip |
| civil_787_8 | Boeing 787-8 | USA | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/787-8.zip |
| civil_a340_600 | Airbus A340-600 | FRA | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/A340-600.zip |
| civil_erj145 | Embraer ERJ-145 | BRA | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/Embraer-ERJ-145.zip |
| civil_atr72 | ATR 72-500 | FRA | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/ATR-72-500.zip |
| civil_crj200 | Bombardier CRJ-200 | CAN | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/CRJ-200.zip |
| civil_tu134 | Tupolev Tu-134 | RUS | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/Tu-134.zip |
| civil_citation | Cessna Citation Bravo | USA | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/Citation-Bravo.zip |
| civil_c172 | Cessna 172 | USA | FlightGear FGAddon contributors | GPL-2.0-or-later | SA | https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/c172r.zip |
<!-- VARIANTS:END -->

## Textures (CC0-1.0, Poly Haven, https://polyhaven.com)
Used as sources for the baked paint/wear/mud/rubber textures of the ground vehicles (mbt*, ifv*, apc*, spg*, mlrs*, sam*): green_metal_rust, rusty_painted_metal, metal_plate_02, rubber_tiles, brown_mud_dry. Camouflage patterns are procedural (Blender noise).

## Added models pending manifest/variants integration (CC-BY-4.0, Thingiverse via archive.org mirror)
Converted with tools/models/landmarks/convert.py (bpy); mbt_merkava and transport_heli_ka27 voxel-remeshed + decimated. Orientation (yawOffsetDeg) not yet set.

| file | real name | author | licence | source |
|---|---|---|---|---|
| mbt_merkava.glb | Merkava Mk1 | Steve Smigielski (Ssmigielski) | CC-BY-4.0 | https://www.thingiverse.com/thing:4597608 |
| fighter_rafale.glb | Dassault Rafale B | Jack Dueri (JackTheTinkerer) | CC-BY-4.0 | https://www.thingiverse.com/thing:5523718 |
| fighter_su34.glb | Sukhoi Su-34 Fullback | Jack Dueri (JackTheTinkerer) | CC-BY-4.0 | https://www.thingiverse.com/thing:5496533 |
| transport_heli_ka27.glb | Kamov Ka-27 Helix | Jack Dueri (JackTheTinkerer) | CC-BY-4.0 | https://www.thingiverse.com/thing:5496538 |
| carrier_liaoning.glb | CV-16 Liaoning | Feng Yu (54dashayu) | CC-BY-4.0 | https://www.thingiverse.com/thing:2219283 |

## Nature (`nature/*.glb`, CC0-1.0)
Stylized Nature MegaKit (standard/free) by Quaternius, https://opengameart.org/content/stylized-nature-megakit (https://quaternius.com). Normal maps dropped, bark re-encoded to 256 px JPEG, leaves 512 px, meshes quantized: commontree_1..5, pine_1..5, deadtree_1, deadtree_3, fern_1, bush_common.
Derived distance levels in `nature/lod/` (same licence): `<species>_1.glb` mid-detail (tools/models/tree-lod.mjs: bark simplified with meshoptimizer, leaf cards thinned and enlarged, 256 px textures) and `<species>_3.glb` billboard impostors (tools/models/tree-impostor.mjs: side render on two crossed quads, unlit). Regenerate with `cd tools/models && node tree-lod.mjs && node tree-impostor.mjs` (needs Chrome or Playwright Chromium).

## Close-range ("near") models (`near/*.glb`, `near/manifest.json`; used by the detailed battle view under ~150 m)
Built by `tools/models/fetch-near.sh` + `tools/models/near-build.mjs`. Changes made (CC-BY "changes indicated"): vertex colours recoloured to olive drab where needed, box-projected UVs and tiling CC0 Poly Haven detail/normal/roughness textures added (green_metal_rust, rubber_tiles), parts kept as named nodes so the game can turn the turret, elevate/recoil the gun and spin the wheels; track triangles marked (vertex alpha 0.5) for the tread-scroll shader; composites assembled in code from the parts of two models (marked "composite").

| modelId | source model(s) | author | licence |
|---|---|---|---|
| near_mbt | Medium Tank (https://polyfork.dev/asset/medium-tank-65da6b) | Polyfork | CC BY 4.0 |
| near_apc | Armoured Half-Track (https://polyfork.dev/asset/armoured-half-track-3deded) | Polyfork | CC BY 4.0 |
| near_ifv (composite) | Armoured Half-Track hull + Defense Turret (https://polyfork.dev/asset/defense-turret-12ba8d) | Polyfork | CC BY 4.0 |
| near_spg (composite) | Medium Tank hull / running gear + Towed Field Howitzer (https://polyfork.dev/asset/towed-field-howitzer-bb9a08) top carriage as rotating turret | Polyfork | CC BY 4.0 |
| near_truck | Military Cargo Truck (https://polyfork.dev/asset/military-cargo-truck-652f66) | Polyfork | CC BY 4.0 |
| near_sam (composite, substitute) | Eight-Wheel Industrial Hauler (olive) + Anti-Aircraft Gun (https://polyfork.dev/asset/anti-aircraft-gun-93cc80): an AA gun truck stands in for a missile launcher (no free SAM launcher with separate parts was found) | Polyfork | CC BY 4.0 |

Credit line (CC BY 4.0): "<name> by Polyfork (https://polyfork.dev), CC BY 4.0".
The grass of the detailed view is generated in code (no model); its pattern is `public/data/styles/grass.json`.

## Soldiers (nsoldier, nsoldier_des, nsoldier_urb, nsoldier_ru and soldier_nato, soldier_ru, soldier_desert, soldier_urban; soldier and soldier_cn reuse the US / Russian files)
Built in Blender from a kit (tools/models/soldados/): ONE skinned mesh and ONE atlas material per model, camouflage tints baked into the atlas; near level about 11,700 triangles / 1 MB, far level about 2,900 triangles / 0.3 MB; clips Idle_Loop, Walk_Loop, Jog_Fwd_Loop, Crouch_Idle_Loop, Death01, Pistol_Aim_Neutral. The earlier cartoon soldiers (Quaternius Toon Shooter Game Kit and Ultimate Animated Character Pack) and the OpenGameArt "Elite Soldier" were removed from the game.

| part | model | author | license |
|---|---|---|---|
| body + skeleton | Universal Base Characters [Standard], Superhero_Male (https://quaternius.com/packs/universalbasecharacters.html) | Quaternius | CC0 |
| animations | Universal Animation Library [Standard] (https://quaternius.com/packs/universalanimationlibrary.html) | Quaternius | CC0 |
| shirt, trousers, boots, gloves, vest, pads (re-fitted and re-tinted) | soldier_city (https://sketchfab.com/3d-models/636b5a7c7e0c400abda269ba382f3252) | buh-late | CC BY 4.0 |
| backpack | Low Poly Game Ready Military Tactical Backpack (https://sketchfab.com/3d-models/95a4fc7300584384b56ce3add58dbc9f) | 1799danly | CC BY 4.0 |
| plate carrier (US) | Tactical Plate Carrier Vest - Game Ready (https://sketchfab.com/3d-models/3b51e6329dbb4b0aa14e43f12eb6c42a) | txyrm70 | CC BY 4.0 |
| helmet (US) | Tactical Helmet with Headset (https://sketchfab.com/3d-models/82adf376164f4d99a4e0b2949930e2ad) | txyrm70 | CC BY 4.0 |
| helmet (Russian-bloc) | low-poly 6b47 (https://sketchfab.com/3d-models/7cb0a856205d4afc964484878fb73434) | katzeschwarz | CC BY 4.0 |
| helmet (desert) | Helmet model 2005, wz. 2005 (https://sketchfab.com/3d-models/3bef9733977142599dc2275cf889fcef) | armoredwave | CC BY 4.0 |
| helmet (urban) | Combat helmet K6-3 (https://sketchfab.com/3d-models/94701874d8b949718708b018c8d4f61d) | shamanoff | CC BY 4.0 |
| AK-74, M4A1, RPG-7, M249 | Low-Poly AK-74 / M4a1 / RPG-7 / M249 SAW (https://sketchfab.com/tastytony) | TastyTony | CC BY 4.0 |

Credit line (CC BY 4.0): "<name> by <author> (Sketchfab), CC BY 4.0".


### Animation library of the Godot battle (`godot/assets/soldiers/anims.glb`)
- 43 clips of the "Universal Animation Library" by Quaternius (CC0).
- Rifle_Aim, Rifle_Aim_Crouch, Prone_Aim, Prone_Crawl made for MERIDIANO in Blender from those clips
  (`tools/models/soldados/animacoes_extras.py`), CC0 like their source.
