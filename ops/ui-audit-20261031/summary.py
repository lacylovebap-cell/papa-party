import json, sys, collections
def load(p):
    out = collections.OrderedDict()
    for e in json.load(open(p)):
        if 'issues' not in e:
            out.setdefault(e['name'], {})[e['w']] = {'error': e.get('error') or e.get('errors')}
            continue
        c = collections.Counter(i['kind'] for i in e['issues'])
        out.setdefault(e['name'], {})[e['w']] = {'n': e['count'], 'ovf': e['docOverflow'], 'bad': sum(v for k, v in c.items() if k != '緊湊例外'), 'kinds': dict(c), 'issues': e['issues']}
    return out
b, a = load(sys.argv[1]), load(sys.argv[2])
print('page | width | controls | before(不合規) | after(不合規) | after 緊湊例外 | 橫向溢出')
for name, ws in a.items():
    for w, r in ws.items():
        if 'error' in r: print(name, w, 'ERROR', r['error']); continue
        br = b.get(name, {}).get(w, {})
        print(f"{name} | {w} | {r['n']} | {br.get('bad','-')} | {r['bad']} | {r['kinds'].get('緊湊例外',0)} | {r['ovf']}")
print('\n== remaining non-compliant issues (after) ==')
seen = collections.Counter()
for name, ws in a.items():
    for w, r in ws.items():
        for i in r.get('issues', []):
            if i['kind'] != '緊湊例外': seen[(i['kind'], i['a'], i.get('b'), i.get('gap'))] += 1
for k, n in seen.most_common(60): print(n, k)
