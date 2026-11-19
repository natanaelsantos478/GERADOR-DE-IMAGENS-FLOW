# usage: python -I tools/military/fetch-wikidata.py   -> tools/.cache/military/wikidata-units.json
# Active military units of every country with a known headquarters / garrison and its coordinates: instances of
# military unit (Q176799) or a subclass, not dissolved (no P576), with country (P17 -> ISO3 P298), HQ location (P159)
# and the HQ's coordinates (P625). Source: Wikidata (CC0), read through the QLever SPARQL endpoint of the University of
# Freiburg (query.wikidata.org throttles batch queries). Labels in English.
import json, os, urllib.parse, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '.cache', 'military'); os.makedirs(OUT, exist_ok=True)
Q = """PREFIX wd: <http://www.wikidata.org/entity/> PREFIX wdt: <http://www.wikidata.org/prop/direct/> PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?u ?label ?iso ?type ?typelabel ?hq ?hqlabel ?coord ?parent WHERE {
  ?u wdt:P31/wdt:P279* wd:Q176799 . ?u wdt:P17 ?c . ?c wdt:P298 ?iso .
  MINUS { ?u wdt:P576 ?end }
  ?u wdt:P159 ?hq . ?hq wdt:P625 ?coord .
  OPTIONAL { ?u wdt:P31 ?type . OPTIONAL { ?type rdfs:label ?typelabel FILTER (LANG(?typelabel) = "en") } }
  OPTIONAL { ?u wdt:P361 ?parent }
  OPTIONAL { ?u rdfs:label ?label FILTER (LANG(?label) = "en") }
  OPTIONAL { ?hq rdfs:label ?hqlabel FILTER (LANG(?hqlabel) = "en") }
}"""
req = urllib.request.Request('https://qlever.cs.uni-freiburg.de/api/wikidata?' + urllib.parse.urlencode({'query': Q}),
                             headers={'User-Agent': 'MeridianoGameDataPipeline/1.0', 'Accept': 'application/sparql-results+json'})
rows = json.load(urllib.request.urlopen(req, timeout=300))['results']['bindings']
json.dump(rows, open(os.path.join(OUT, 'wikidata-units.json'), 'w', encoding='utf-8'))
print('rows', len(rows), 'units', len({r['u']['value'] for r in rows}))
