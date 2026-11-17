# usage: python3 -I search.py "term1" "term2" ... -> lists thingiverse mirror items on archive.org (title, creator, license)
import re, sys, json, urllib.request, urllib.parse
for t in sys.argv[1:]:
    q = 'identifier:thingiverse-* AND title:(%s)' % t
    p = [('q', q), ('rows', '40'), ('output', 'json'), ('sort[]', 'downloads desc')] + [('fl[]', f) for f in ('identifier', 'title', 'creator', 'licenseurl', 'item_size')]
    r = urllib.request.Request('https://archive.org/advancedsearch.php?' + urllib.parse.urlencode(p), headers={'User-Agent': 'Meridiano-Game/1.0'})
    d = json.load(urllib.request.urlopen(r, timeout=40))['response']['docs']
    print('##', t)
    n=0
    for x in d:
        l=(x.get('licenseurl') or '')
        if not re.search(r'licenses/(by|by-sa)/|publicdomain|gpl',l) or n>=7 or re.search(r'key ?chain|lamp|pencil|puzzle|ice cube|dice|cookie|stand|holder|lithopane|paper|chess|mashup|sand ?castle',x.get('title',''),re.I): continue
        n+=1; print(' ', x['identifier'][12:], '|', x.get('title'), '|', x.get('creator'), '|', l.replace('https://creativecommons.org/licenses/', ''), '|', x.get('item_size'))
