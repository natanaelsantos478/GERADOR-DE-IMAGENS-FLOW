# Generates tools/models/variants.defs.json (one entry per downloaded real-world model). Run: python3 -I make-variant-defs.py
import json, os
H = os.path.dirname(os.path.abspath(__file__))
FGL = {'license': 'GPL-2.0-or-later', 'licenseNote': 'FlightGear FGAddon aircraft (GPL, see aircraft README/-set.xml for authors)', 'shareAlike': True, 'src': 'fg'}
def fg(id, cls, name, origin, length, d, ops, front='-x', author='FlightGear FGAddon contributors', **kw):
    e = dict(id=id, cls=cls, realName=name, origin=origin, lengthM=length, fg=d, front=front, ops=ops, author=author,
             source=f'https://mirrors.ibiblio.org/flightgear/ftp/Aircraft-trunk/{d}.zip', **FGL); e.update(kw); return e
def tv(id, cls, name, origin, length, tid, ops, front='-y', author='', lic='CC-BY-4.0', spec=None, **kw):
    e = dict(id=id, cls=cls, realName=name, origin=origin, lengthM=length, ia=tid, front=front, ops=ops, author=author, license=lic,
             source=f'https://www.thingiverse.com/thing:{tid} (archive.org mirror: https://archive.org/details/thingiverse-{tid})', src='stl', spec=spec or {})
    if lic.startswith('CC-BY-SA') or lic.startswith('GPL'): e['shareAlike'] = True
    e.update(kw); return e
WH = 'Wei He (Xdhsqj)'; JS = 'Joachim Schwarz (Blackbird)'; SS = 'Sean Sikora (Scas678)'; JD = 'Jack Dueri (JackTheT)'
TR = r'track|kette|wheel|skirt'
OLV = [0.27, 0.30, 0.18]; SAND = [0.55, 0.47, 0.30]; GRY = [0.42, 0.44, 0.45]; RUS = [0.26, 0.31, 0.19]; DG = [0.30, 0.32, 0.30]; NATO = [0.22, 0.25, 0.17]
EU = 'ALB BEL BGR HRV CZE DNK EST FIN FRA DEU GRC HUN ISL ITA LVA LTU LUX MNE NLD MKD NOR POL PRT ROU SVK SVN ESP SWE CHE AUT'.split()
D = []
# ---------- tanks (STL, CC-BY) ----------
D += [
 tv('mbt_m1abrams', 'mbt', 'M1A1 Abrams', 'USA', 9.83, 4324208, 'USA EGY SAU KWT AUS IRQ MAR POL TWN'.split(), author=WH, spec=dict(assemble='cad', exclude='Connect_Pivot', dark=TR, color=SAND)),
 tv('mbt_leopard2', 'mbt', 'Leopard 2A6', 'DEU', 10.97, 4324199, 'DEU NLD DNK NOR SWE FIN ESP GRC POL CHE AUT CAN CHL PRT TUR HUN CZE HRV IDN SGP QAT UKR MKD SVN SVK LTU'.split(), author=WH, spec=dict(assemble='cad', exclude='Connect_Pivot', dark=TR, color=NATO)),
 tv('mbt_leclerc', 'mbt', 'AMX-56 Leclerc', 'FRA', 9.87, 4324192, 'FRA ARE'.split(), author=WH, spec=dict(assemble='cad', exclude='Connect_Pivot|Top-2', dark=TR, color=SAND)),
 tv('mbt_challenger2', 'mbt', 'Challenger 2', 'GBR', 11.55, 4324185, 'GBR OMN'.split(), author=WH, spec=dict(assemble='cad', exclude='Connect_Pivot', dark=TR, color=SAND)),
 tv('mbt_t72', 'mbt', 'T-72', 'RUS', 9.53, 4324265, 'RUS BLR IND IRN SYR IRQ DZA AZE ARM KAZ UKR SRB BGR VNM LBY SDN AFG YEM CUB MMR TKM UZB VEN PRK ETH LKA'.split(), author=WH, spec=dict(assemble='cad', exclude='Connect_Pivot', dark=TR, color=RUS)),
 tv('mbt_t90', 'mbt', 'T-90', 'RUS', 9.63, 4334951, 'RUS IND DZA AZE TKM VNM UGA SYR'.split(), author=WH, spec=dict(assemble='cad', dark=TR, color=RUS)),
 tv('mbt_type99', 'mbt', 'ZTZ-99A (Type 99A)', 'CHN', 11.0, 4324227, ['CHN'], author=WH, spec=dict(assemble='cad', exclude='Connect_Pivot', dark=TR, color=[0.30, 0.34, 0.22])),
 dict(id='mbt_strv103', cls='mbt', realName='Stridsvagn 103 (S-tank)', origin='SWE', lengthM=9.0, src='oga', oga='stridsvagn-103', blend='x/stridsvagn103/stridsvagn103.blend',
      ops=['SWE'], author='canisferus', license='CC-BY-3.0', source='https://opengameart.org/content/stridsvagn-103'),
]
# ---------- IFV / APC / recon ----------
D += [
 tv('apc_btr80', 'apc', 'BTR-80', 'RUS', 7.65, 5662670, 'RUS KAZ UZB IDN EGY IRQ BLR ARM AZE ETH VNM'.split(), author='Glug Glug (TenkEnthusiast)', spec=dict(color=RUS)),
 tv('ifv_puma', 'ifv', 'Schützenpanzer Puma', 'DEU', 7.6, 4961768, ['DEU'], author=JS, spec=dict(color=NATO, dark='zzz')),
 tv('apc_boxer', 'apc', 'GTK Boxer', 'DEU', 7.88, 4957830, 'DEU NLD GBR LTU AUS QAT'.split(), author=JS, spec=dict(color=NATO)),
 tv('ifv_bradley', 'ifv', 'M2 Bradley', 'USA', 6.55, 5496813, 'USA SAU GRC LBN'.split(), author=JD, spec=dict(color=SAND)),
 tv('apc_fennek', 'apc', 'Fennek', 'DEU', 5.71, 4943700, 'DEU NLD'.split(), author=JS, spec=dict(color=NATO)),
]
# ---------- artillery / rocket / SAM ----------
D += [
 tv('spg_m109', 'spg', 'M109A3G', 'USA', 9.1, 5373940, 'USA SAU KOR TUR EGY ISR GRC ITA NOR JOR PRT BEL NLD CAN DNK'.split(), author=JS, spec=dict(include=r'^M109_A3G\.stl', color=NATO)),
 tv('spg_pzh2000', 'spg', 'Panzerhaubitze 2000', 'DEU', 11.7, 5022607, 'DEU ITA NLD GRC HRV LTU QAT HUN UKR'.split(), author=JS, spec=dict(include='complete', color=NATO)),
 tv('spg_2s1', 'spg', '2S1 Gvozdika', 'RUS', 7.26, 4974140, 'RUS UKR BLR IRQ SYR POL BGR EGY DZA IND LBY'.split(), author=JS, spec=dict(include='complete', color=RUS)),
 tv('spg_2s3', 'spg', '2S3 Akatsiya', 'RUS', 8.4, 4944605, 'RUS UKR BLR SYR IRQ DZA AZE FIN'.split(), author=JS, spec=dict(color=RUS)),
 tv('spg_rch155', 'spg', 'RCH 155', 'DEU', 9.5, 5351925, ['DEU', 'GBR', 'UKR'], author=JS, spec=dict(color=NATO)),
 tv('mlrs_m270', 'mlrs', 'M270 MLRS', 'USA', 6.96, 5023390, 'USA GBR DEU FRA ITA GRC FIN NLD KOR BHR EGY ISR JPN TUR POL'.split(), author=JS, spec=dict(include='complete', color=NATO)),
 tv('mlrs_tos1', 'mlrs', 'TOS-1 Buratino', 'RUS', 9.5, 5338294, 'RUS KAZ IRQ AZE SYR'.split(), author=JS, spec=dict(include='complete', color=RUS)),
 tv('mlrs_iskander', 'mlrs', '9K720 Iskander (SS-26)', 'RUS', 12.0, 5343360, 'RUS BLR ARM DZA'.split(), author=JS, spec=dict(include='complete', color=RUS, tris=14000)),
 tv('sam_pantsir', 'sam', 'Pantsir-S1', 'RUS', 9.0, 4956994, 'RUS SYR DZA ARE IRQ'.split(), author=JS, spec=dict(color=RUS)),
 tv('sam_tor', 'sam', '9K330 Tor (SA-15)', 'RUS', 7.5, 4968754, 'RUS IRN BLR GRC CHN DZA EGY CYP VEN ARM'.split(), author=JS, spec=dict(include='complete', color=RUS)),
 tv('sam_s300', 'sam', 'S-300 (Favorit)', 'RUS', 11.0, 5496828, 'RUS BLR IRN CHN BGR SVK GRC SYR UKR VNM KAZ AZE ARM DZA EGY IND'.split(), author=JD, spec=dict(color=RUS, tris=14000)),
 tv('sam_tunguska', 'sam', '2K22 Tunguska', 'RUS', 7.9, 2920050, 'RUS BLR UKR IND SYR MAR'.split(), author=SS, spec=dict(color=RUS)),
]
# ---------- fixed wing via STL (CC-BY) ----------
D += [
 tv('fighter_j20', 'fighter', 'Chengdu J-20', 'CHN', 20.3, 5496401, ['CHN'], author=JD, spec=dict(color=GRY)),
 tv('fighter_su35', 'fighter', 'Sukhoi Su-35', 'RUS', 21.9, 5232643, 'RUS CHN DZA EGY IDN IRN'.split(), author='Diego Garcia (FoxFan)', spec=dict(color=[0.55, 0.58, 0.62])),
 tv('fighter_f16', 'fighter', 'F-16 Fighting Falcon', 'USA', 15.0, 2385491, 'USA TUR GRC EGY ISR JOR PAK TWN KOR NLD BEL DNK NOR POL ROU PRT SGP IDN THA CHL BHR MAR IRQ UKR VEN OMN ARE'.split(), author='Justin Kanarick (airplane guy)', spec=dict(color=GRY)),
 tv('bomber_tu160', 'bomber', 'Tupolev Tu-160', 'RUS', 54.1, 5496344, ['RUS'], author=JD, spec=dict(color=[0.80, 0.82, 0.85])),
 tv('transport_a400m', 'transport_plane', 'Airbus A400M Atlas', 'DEU', 45.1, 4973174, 'DEU FRA ESP GBR BEL LUX TUR MYS KAZ IDN'.split(), author='Theta 687', spec=dict(color=[0.45, 0.48, 0.50])),
 tv('transport_c17', 'transport_plane', 'C-17 Globemaster III', 'USA', 53.0, 5167227, 'USA GBR CAN AUS QAT ARE KWT IND'.split(), author='Jay Crispy (Hailstorm)', spec=dict(include=r'^c17\.stl', color=[0.45, 0.48, 0.50])),
 tv('drone_tb2', 'drone', 'Bayraktar TB2', 'TUR', 6.5, 5519530, 'TUR UKR AZE QAT POL LTU ALB KWT MAR KGZ TKM NGA ETH'.split(), author='Moon Ztar', spec=dict(color=[0.78, 0.80, 0.82])),
 tv('destroyer_arleigh_burke', 'destroyer', 'Arleigh Burke-class (DDG-51)', 'USA', 155.3, 4207292, ['USA', 'JPN', 'KOR', 'ESP'], author='Justyn Au (Scuderia)', spec=dict(color=[0.45, 0.48, 0.52])),
 tv('carrier_nimitz', 'carrier', 'Nimitz-class carrier', 'USA', 332.8, 5494672, ['USA'], author=JD, spec=dict(color=[0.42, 0.45, 0.48])),
 tv('submarine_virginia', 'submarine', 'Virginia-class (SSN-774)', 'USA', 115.0, 2163754, ['USA', 'GBR', 'AUS'], author='Magix Stix (stix)', spec=dict(color=[0.12, 0.13, 0.15], tris=12000)),
]
# ---------- FlightGear aircraft (GPL) ----------
F = [
 ('fighter_f35', 'fighter', 'F-35B Lightning II', 'USA', 15.6, 'F-35B', 'USA GBR ITA NLD NOR DNK AUS JPN KOR ISR POL BEL FIN CHE CAN SGP DEU'),
 ('fighter_f22', 'fighter', 'F-22 Raptor', 'USA', 18.9, 'Lockheed-Martin-FA-22A-Raptor', 'USA'),
 ('fighter_f18', 'fighter', 'F/A-18 Hornet', 'USA', 17.1, 'f18', 'USA CAN AUS ESP FIN KWT MYS CHE'),
 ('fighter_f14', 'fighter', 'F-14B Tomcat', 'USA', 19.1, 'f-14b', 'IRN'),
 ('fighter_f4', 'fighter', 'F-4 Phantom II', 'USA', 19.2, 'McDonnell-F-4-Phantom', 'USA GRC TUR KOR JPN IRN EGY'),
 ('fighter_f117', 'fighter', 'F-117 Nighthawk', 'USA', 20.1, 'F-117', ''),
 ('fighter_a10', 'fighter', 'A-10 Thunderbolt II', 'USA', 16.26, 'A-10', 'USA'),
 ('fighter_harrier', 'fighter', 'Harrier GR.3', 'GBR', 14.27, 'harrier', 'GBR ESP ITA IND THA'),
 ('fighter_su37', 'fighter', 'Sukhoi Su-37 (Su-27 family)', 'RUS', 22.2, 'SU-37', 'RUS BLR KAZ UKR UZB VNM IND CHN IDN ETH AGO VEN ERI'),
 ('fighter_su33', 'fighter', 'Sukhoi Su-33', 'RUS', 21.19, 'Sukhoi-Su-33', 'RUS CHN'),
 ('fighter_su25', 'fighter', 'Sukhoi Su-25', 'RUS', 15.53, 'Su-25', 'RUS BLR UKR GEO BGR PRK IRQ IRN PER SDN AFG'),
 ('fighter_su57', 'fighter', 'Sukhoi T-50 (Su-57 prototype)', 'RUS', 19.8, 'T-50', 'RUS'),
 ('fighter_mig21', 'fighter', 'MiG-21bis', 'RUS', 15.76, 'MiG-21bis', 'ROU HRV IND PRK CUB SYR AGO LBY EGY AFG VNM CHN'),
 ('fighter_yak130', 'fighter', 'Yakovlev Yak-130', 'RUS', 11.49, 'Yak-130', 'RUS BLR DZA BGD VNM'),
 ('fighter_eurofighter', 'fighter', 'Eurofighter Typhoon', 'GBR', 15.96, 'eurofighter', 'GBR DEU ITA ESP AUT SAU OMN KWT QAT TUR'),
 ('fighter_gripen', 'fighter', 'Saab JAS 39 Gripen', 'SWE', 14.1, 'JAS39-Gripen', 'SWE CZE HUN THA BRA ZAF COL'),
 ('fighter_viggen', 'fighter', 'Saab JA 37 Viggen', 'SWE', 16.4, 'JA37', ''),
 ('fighter_mirage2000', 'fighter', 'Dassault Mirage 2000', 'FRA', 14.36, 'mirage2000', 'FRA ARE EGY GRC IND PER TWN QAT BRA'),
 ('fighter_miragef1', 'fighter', 'Dassault Mirage F1', 'FRA', 15.0, 'Mirage_F1', 'ESP MAR ECU LBY IRQ GRC ZAF'),
 ('fighter_jaguar', 'fighter', 'SEPECAT Jaguar', 'GBR', 16.83, 'Jaguar', 'IND OMN ECU NGA'),
 ('fighter_superetendard', 'fighter', 'Dassault Super Etendard', 'FRA', 14.31, 'Super-Etendard', 'ARG'),
 ('bomber_b52', 'bomber', 'B-52 Stratofortress', 'USA', 47.7, 'B-52F', 'USA'),
 ('bomber_b1b', 'bomber', 'B-1B Lancer', 'USA', 44.5, 'B-1B', ''),
 ('bomber_b2', 'bomber', 'B-2 Spirit', 'USA', 21.0, 'B-2', ''),
 ('bomber_tu95', 'bomber', 'Tupolev Tu-95 Bear', 'RUS', 49.5, 'TU-95', 'IND'),
 ('bomber_tu22', 'bomber', 'Tupolev Tu-22 Blinder', 'RUS', 41.6, 'Tu-22-Blinder', ''),
 ('transport_c130', 'transport_plane', 'C-130 Hercules', 'USA', 29.8, 'C130', 'USA GBR CAN AUS BRA ARG CHL COL MEX NOR DNK EGY SAU IRN ISR IND IDN JPN KOR PAK PRT TUR THA VEN NZL ITA NGA ZAF'),
 ('transport_il76', 'transport_plane', 'Ilyushin Il-76', 'RUS', 46.6, 'IL-76', 'RUS BLR UKR KAZ UZB IND CHN IRN IRQ DZA LBY SYR AZE ARM'),
 ('transport_c160', 'transport_plane', 'Transall C-160', 'DEU', 32.4, 'C-160-Transall', 'DEU FRA TUR ZAF'),
 ('transport_c212', 'transport_plane', 'CASA C-212 Aviocar', 'ESP', 16.2, 'Casa-212', 'ESP PRT CHL COL IDN MEX VEN'),
 ('transport_an12', 'transport_plane', 'Antonov An-12', 'UKR', 33.1, 'Antonov-An-12', 'UKR RUS CHN IND AGO SDN ETH'),
 ('transport_an22', 'transport_plane', 'Antonov An-22', 'UKR', 57.9, 'Antonov-An-22', ''),
 ('transport_an225', 'transport_plane', 'Antonov An-225 Mriya', 'UKR', 84.0, 'AN-225', ''),
 ('transport_kc135', 'transport_plane', 'Boeing KC-135 Stratotanker', 'USA', 41.5, 'KC135', 'USA FRA TUR SGP'),
 ('attack_heli_apache', 'attack_heli', 'AH-64 Apache', 'USA', 17.7, 'apache', 'USA GBR NLD EGY GRC IND ISR JPN KOR SAU ARE KWT SGP TWN IDN QAT POL AUS MAR'),
 ('attack_heli_mi24', 'attack_heli', 'Mil Mi-24 Hind', 'RUS', 17.5, 'Mil-Mi-24', 'RUS UKR BLR IND IRQ SYR DZA AFG AGO ETH SDN YEM PRK HUN BGR CZE POL SVK PER NIC LBY CUB VNM'),
 ('attack_heli_ka50', 'attack_heli', 'Kamov Ka-50 Black Shark', 'RUS', 16.0, 'Ka-50', 'RUS'),
 ('attack_heli_tiger', 'attack_heli', 'Eurocopter Tiger', 'FRA', 14.0, 'Tigre', 'FRA DEU ESP AUS'),
 ('attack_heli_oh58', 'attack_heli', 'Bell OH-58D Kiowa Warrior', 'USA', 12.8, 'OH-58D', 'USA TWN'),
 ('attack_heli_oh1', 'attack_heli', 'Kawasaki OH-1', 'JPN', 12.0, 'OH-1', 'JPN'),
 ('transport_heli_uh60', 'transport_heli', 'UH-60 Black Hawk', 'USA', 19.8, 'UH-60', 'USA AUS BRA COL JPN KOR MEX SAU TUR TWN ISR EGY JOR MAR GRC POL'),
 ('transport_heli_ch47', 'transport_heli', 'CH-47 Chinook', 'USA', 30.1, 'ch47', 'USA GBR CAN AUS DEU ITA NLD ESP KOR JPN IND EGY GRC SGP TUR'),
 ('transport_heli_v22', 'transport_heli', 'V-22 Osprey', 'USA', 17.5, 'V22-Osprey', 'USA JPN'),
 ('drone_mq9', 'drone', 'MQ-9 Reaper', 'USA', 11.0, 'MQ-9', 'USA GBR FRA ITA NLD ESP IND'),
]
for i, c, n, o, l, d_, ops in F:
    D.append(fg(i, c, n, o, l, d_, ops.split()))
# ---------- ships / vehicles from FlightGear data (GPL) ----------
FGD = dict(license='GPL-2.0-or-later', shareAlike=True, src='fgdata', author='FlightGear project contributors', licenseNote='FlightGear base package (fgdata), GPL')
SH = 'Models/Maritime/Military/'
D += [
 dict(id='destroyer_cg47', cls='destroyer', realName='Ticonderoga-class cruiser (CG-47)', origin='USA', lengthM=172.8, ops=['USA'], fgd=SH + 'CG47.xml', front='-x', source='https://sourceforge.net/p/flightgear/fgdata/ci/next/tree/Models/Maritime/Military/', **FGD),
 dict(id='frigate_perry', cls='frigate', realName='Oliver Hazard Perry-class frigate', origin='USA', lengthM=135.6, ops='USA AUS BHR EGY POL ESP TUR TWN PAK'.split(), fgd=SH + 'OliverPerryFFG.xml', front='-x', source='https://sourceforge.net/p/flightgear/fgdata/ci/next/tree/Models/Maritime/Military/', **FGD),
 dict(id='amphib_lpd17', cls='destroyer', realName='San Antonio-class (LPD-17)', origin='USA', lengthM=208.8, ops=[], fgd=SH + 'LPD17.xml', front='-x', source='https://sourceforge.net/p/flightgear/fgdata/ci/next/tree/Models/Maritime/Military/', **FGD),
]
# ---------- OpenGameArt soldiers / misc ----------
D += [
 dict(id='soldier_camo', cls='soldier', realName='Modern camo infantryman (Elite Soldier)', origin='', lengthM=1.8, src='oga', oga='elite-soldier-model', blend='x_elite_20120307.zip/elite/elite.obj', ops=[], author='hc', license='CC-BY-3.0', source='https://opengameart.org/content/elite-soldier-model', front='-z'),
]
json.dump(D, open(os.path.join(H, 'variants.defs.json'), 'w'), indent=1)
print(len(D), 'defs')
