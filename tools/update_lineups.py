#!/usr/bin/env python3
"""Update the lineup data of the Nade Book in place.

What it does
  1. reads the lineups already in seed-dust2.js / seed-maps.js
  2. looks at the sitemaps of csnades.gg and cs2util.com for lineup pages on the active maps that are NEW or were
     UPDATED since the lineup you have (and that are not older than --months)
  3. with --apply: scrapes those pages, downloads their screenshots into shots/, builds the lineup records the same way
     the app expects them, and writes them back into the seed files (existing records are never deleted)

Usage (from the project folder)
  python tools/update_lineups.py                 dry run: list what would be added / refreshed
  python tools/update_lineups.py --apply         do it (then bump nothing by hand: the seed version is raised for you)
  python tools/update_lineups.py --check 6       self-test: rebuild 6 known lineups per source and compare with the seed data
  options: --months 12  --maps mirage,dust2  --source csnades|cs2util

Needs Python 3 and Pillow (pip install pillow). Nothing else.
"""
import argparse, datetime, html, io, json, math, os, re, statistics, sys, time, urllib.request

try:
    from PIL import Image
except ImportError:
    Image = None

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SEED_D2, SEED_MORE = os.path.join(ROOT, 'seed-dust2.js'), os.path.join(ROOT, 'seed-maps.js')
SHOTS = os.path.join(ROOT, 'shots')
UA = {'User-Agent': 'Mozilla/5.0'}
ACTIVE = ['dust2', 'mirage', 'inferno', 'ancient', 'anubis', 'nuke', 'cache']

# radar calibration (pos_x, pos_y, scale) + bombsite / spawn positions as fractions of the radar image
CAL = {
    'dust2':   (-2476, 3239, 4.4,  (0.80, 0.16), (0.21, 0.12), (0.62, 0.21), (0.39, 0.91)),
    'mirage':  (-3230, 1713, 5.00, (0.54, 0.76), (0.23, 0.28), (0.28, 0.70), (0.87, 0.36)),
    'inferno': (-2087, 3870, 4.9,  (0.81, 0.69), (0.49, 0.22), (0.90, 0.35), (0.10, 0.67)),
    'ancient': (-2953, 2164, 5.0,  (0.31, 0.25), (0.80, 0.40), (0.51, 0.17), (0.485, 0.87)),
    'anubis':  (-2796, 3328, 5.22, None, None, (0.61, 0.22), (0.58, 0.93)),
    'nuke':    (-3453, 2887, 7.0,  (0.58, 0.48), (0.58, 0.58), (0.82, 0.45), (0.19, 0.54)),
    'cache':   (-2000, 3250, 5.5,  (0.325, 0.26), (0.345, 0.79), (0.09775, 0.473), (0.887, 0.585)),
}
NUKE_SPLIT_Z = -495        # below this height a nuke lineup is on the lower level
WORDS = set('smoke smokes flash flashbang molotov molly molo pop grenade he cover cut off take protection anti push fast instant solo self support fake default cross'.split())
MONTHS = {m: i + 1 for i, m in enumerate('January February March April May June July August September October November December'.split())}
CSN_TYPE = {'smokes': 'smoke', 'flashbangs': 'flash', 'molotovs': 'molly', 'hegrenades': 'he'}
CU_TYPE = {'smoke': 'smoke', 'flash': 'flash', 'molotov': 'molly', 'grenade': 'he'}
CSN_MAPNAME = {'Dust 2': 'dust2', 'Mirage': 'mirage', 'Inferno': 'inferno', 'Ancient': 'ancient', 'Anubis': 'anubis', 'Nuke': 'nuke', 'Cache': 'cache'}
TITLE_FIX = {'nomal': 'normal', 'Defalut': 'Default', 'Rretake': 'Retake'}


# ------------------------------------------------------------------ small helpers
def get(url, binary=False, tries=3):
    err = None
    for _ in range(tries):
        try:
            data = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40).read()
            return data if binary else data.decode('utf8', 'replace')
        except Exception as e:                      # noqa: BLE001 - network errors are retried, then reported
            err = e
            time.sleep(1)
    print('  ! could not fetch', url, '-', err)
    return None


def norm(t):
    t = re.sub('[^a-z0-9 ]', ' ', t.lower().replace('-', ' ').replace('_', ' '))
    return re.sub(' +', ' ', t).strip()


def core(t):
    return ' '.join(w for w in norm(t).split() if w not in WORDS)


def strip_tail(s):
    return re.sub('( [0-9]+)+$', '', s.strip()).strip()


def slugify(s):
    return re.sub('[^a-z0-9]+', '-', s.lower()).strip('-')


def clean_title(t):
    for a, b in TITLE_FIX.items():
        t = t.replace(a, b)
    t = re.sub('[^ -~]', '', t).strip()
    if ' ' not in t:
        t = t.replace('-', ' ')
    t = re.sub(' +', ' ', t)
    return (t[:1].upper() + t[1:]) if t else 'Lineup'


def grid(setpos, cal):
    m = re.match(r'setpos +(-?[0-9.]+) +(-?[0-9.]+) +(-?[0-9.]+)', setpos)
    x, y, z = float(m.group(1)), float(m.group(2)), float(m.group(3))
    return {'x': round((x - cal[0]) / cal[2] * 1000 / 1024), 'y': round((cal[1] - y) / cal[2] * 1000 / 1024)}, z


def frac(p):
    return (round(p[0] * 1000), round(p[1] * 1000))


# ------------------------------------------------------------------ seed files (JS holding JSON arrays)
def read_array(path, var):
    text = open(path, encoding='utf8').read()
    start = text.index('const ' + var + ' = ') + len('const ' + var + ' = ')
    obj, used = json.JSONDecoder().raw_decode(text[start:])
    return text, obj, start, start + used


def write_array(path, var, records, indent=None):
    text, _, start, end = read_array(path, var)
    open(path, 'w', encoding='utf8').write(text[:start] + json.dumps(records, indent=indent) + text[end:])


def bump_version(path, const):
    text = open(path, encoding='utf8').read()
    m = re.search(r'(const ' + const + r' = ")([^"]*?)(\d+)(")', text)
    new = m.group(1) + m.group(2) + str(int(m.group(3)) + 1) + m.group(4)
    open(path, 'w', encoding='utf8').write(text[:m.start()] + new + text[m.end():])
    return m.group(2) + str(int(m.group(3)) + 1)


def load_all():
    _, d2, _, _ = read_array(SEED_D2, 'SEED_NADES')
    _, more, _, _ = read_array(SEED_MORE, 'SEED_MORE')
    return d2, more


# ------------------------------------------------------------------ landing spot: name lookup from what we already have, then the aim line
class Resolver:
    def __init__(self, records):
        tgt, frm = {}, {}
        for r in records:
            base = r['map'].replace('_lower', '')
            parts = re.split(r' from ', r['name'], flags=re.I)
            t = core(parts[0])
            if t and r.get('to') and 'landing-approx' not in r.get('tags', []):
                tgt.setdefault((base, t), []).append(r['to'])
            if len(parts) > 1 and r.get('from'):
                f = strip_tail(norm(parts[1]))
                if f:
                    frm.setdefault((base, f), []).append(r['from'])
        med = lambda pts: (round(statistics.median(p['x'] for p in pts)), round(statistics.median(p['y'] for p in pts)))
        self.tgt = {k: med(v) for k, v in tgt.items()}
        self.frm = {k: med(v) for k, v in frm.items()}

    def landing(self, base, target_part, site=''):
        """-> ((x, y), exact?)"""
        c = core(target_part)
        cal = CAL[base]
        anchors = {'ct spawn': frac(cal[5]), 't spawn': frac(cal[6])}
        if cal[3]:
            anchors['a site'] = frac(cal[3]); anchors['b site'] = frac(cal[4])
        for table in ({k[1]: v for k, v in self.tgt.items() if k[0] == base}, {k[1]: v for k, v in self.frm.items() if k[0] == base}, anchors):
            for k in sorted(table, key=len, reverse=True):
                if k and (' ' + k + ' ') in (' ' + c + ' '):
                    return table[k], True
        s = (site or '').lower()
        if cal[3]:
            if s.startswith('b') or c.startswith('b ') or ' b ' in (' ' + c + ' '):
                return anchors['b site'], False
            return anchors['a site'], False
        return (500, 500), False


def aimline(rec):
    """Move a guessed landing spot onto the lineup's own aim line (yaw from the setpos) toward the named target."""
    if not rec.get('from') or 'landing-approx' in rec.get('tags', []):
        return False
    m = re.match(r'setpos (\S+) (\S+) (\S+);setang (\S+) (\S+)', rec['setpos'])
    if not m:
        return False
    yaw = math.radians(float(m.group(5)))
    d = (math.cos(yaw), -math.sin(yaw))
    s0, c0 = (rec['from']['x'], rec['from']['y']), (rec['to']['x'], rec['to']['y'])
    v = (c0[0] - s0[0], c0[1] - s0[1]); dist = math.hypot(*v)
    if dist < 25:
        return False
    t = v[0] * d[0] + v[1] * d[1]
    ang = math.degrees(math.acos(max(-1, min(1, t / dist))))
    if ang > 30 or t < 20:
        return False
    rec['to'] = {'x': round(s0[0] + t * d[0]), 'y': round(s0[1] + t * d[1])}
    rec['tags'] = rec.get('tags', []) + ['landing-aimline']
    rec['notes'] += ' Landing spot estimated along the aim line toward the named target.'
    return True


def save_image(raw, dest, max_w=1600):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if Image is None:
        open(dest, 'wb').write(raw); return
    im = Image.open(io.BytesIO(raw)).convert('RGB')
    if im.width > max_w:
        im = im.resize((max_w, round(im.height * max_w / im.width)))
    im.save(dest, 'WEBP', quality=82)


# ------------------------------------------------------------------ csnades.gg
def csn_candidates(maps):
    sm = get('https://csnades.gg/sitemap.xml') or ''
    out = {}
    for u in re.findall('<url>(.*?)</url>', sm, re.S):
        loc = re.search('<loc>(.*?)</loc>', u).group(1)
        lm = re.search('<lastmod>(.*?)</lastmod>', u)
        p = loc.replace('https://csnades.gg', '').split('/')
        if lm and len(p) == 4 and p[1] in maps and p[2] in CSN_TYPE:
            out[loc] = (lm.group(1)[:10], '/'.join(p))
    return out


def build_csn(url, path, lastmod, res, download=True):
    h = get(url)
    if not h:
        return None
    t = html.unescape(re.sub('<[^>]+>', '|', h))
    for _ in range(4):
        t = re.sub(r'\|\s*\|', '|', t)
    def f(pat):
        m = re.search(pat, t)
        return m.group(1).strip() if m else ''
    title = html.unescape((re.search('<title>([^<]*)</title>', h) or [None, ''])[1])
    tm = re.match('(Dust 2|Mirage|Inferno|Ancient|Anubis|Nuke|Cache) (.*?) from (.*?) (Smoke|Molotov|Flashbang|HE Grenade) -', title)
    sp = (re.findall('data-tooltip-content=.(setpos [^"]+).', h) or [''])[0]
    if not tm or not sp:
        print('  ! skipped (no title/setpos):', url); return None
    base = CSN_MAPNAME[tm.group(1)]
    target, frm = tm.group(2), tm.group(3)
    cal = CAL[base]
    g, z = grid(sp, cal)
    mk = 'nuke_lower' if (base == 'nuke' and z < NUKE_SPLIT_Z) else base
    cat = path.split('/')[2]
    tech, move, prec, air = f(r'Technique\|([^|]+)'), f(r'Movement\|([^|]+)'), f(r'Precision\|([^|]+)'), f(r'Air Time\|([0-9.]+)')
    team = f(r'Team\|([^|]+)')
    mm = re.match('([A-Za-z]+) ([0-9]+), ([0-9]+)', f(r'Updated\|([A-Za-z]+ [0-9]+, [0-9]+)'))
    updated = '%04d-%02d-%02d' % (int(mm.group(3)), MONTHS[mm.group(1)], int(mm.group(2))) if mm else lastmod
    low = tech.lower()
    technique = 'jump-throw' if 'jump' in low else ('left+right' if 'left+right' in low else 'right click' if 'right' in low else 'left click')
    if move.lower().startswith('run'):
        technique = 'run+' + technique
    side = 'CT' if team.startswith('Counter') else 'T'
    to, exact = res.landing(base, target)
    slug = slugify(path)
    images = []
    if download:
        nid = re.search('nades/([A-Za-z0-9_-]+)/hq[.]mp4', h.replace(chr(92) + '"', '"'))
        if not nid:
            print('  ! skipped (no asset id):', url); return None
        for name, label, suffix in (('thumbnail.webp', 'Aim', 'aim'), ('lineup.webp', 'Full view', 'full')):
            raw = get('https://assets.csnades.gg/nades/%s/%s' % (nid.group(1), name), binary=True)
            if raw:
                save_image(raw, os.path.join(SHOTS, mk, 'cn-%s-%s.webp' % (slug, suffix)))
                images.append({'src': 'shots/%s/cn-%s-%s.webp' % (mk, slug, suffix), 'label': label})
        if len(images) < 2:
            print('  ! skipped (images missing):', url); return None
    note = '%s throw. Movement: %s. Precision: %s. Air time %ss.' % (tech, move or '?', prec or '?', air or '?')
    note += '\nSource: csnades.gg (updated %s).%s Verify in game.' % (updated, '' if exact else ' Landing spot is a rough guess - check the screenshot.')
    rec = {'id': 'cn-%s-%s' % (mk, slug), 'map': mk, 'name': '%s from %s' % (target, frm), 'type': CSN_TYPE[cat], 'variant': 'standard',
           'side': side, 'purpose': 'execute' if side == 'T' else 'default', 'technique': technique, 'status': 'unknown',
           'from': g, 'to': {'x': to[0], 'y': to[1]}, 'setpos': sp, 'video': url, 'notes': note,
           'tags': ['csnades', 'curated'] + ([] if exact else ['landing-approx']), 'images': images, 'updated': updated, 'source': 'csnades.gg'}
    aimline(rec)
    return rec


# ------------------------------------------------------------------ cs2util.com
def cu_candidates(maps):
    sm = get('https://www.cs2util.com/sitemap.xml') or ''
    out = {}
    for u in re.findall('<url>(.*?)</url>', sm, re.S):
        loc = re.search('<loc>(.*?)</loc>', u).group(1)
        lm = re.search('<lastmod>(.*?)</lastmod>', u)
        path = re.sub('^https://www.cs2util.com(/(zh|ru|pt|es|de|fr|ja|ko|tr|pl|it)(?=/))?', '', loc)
        p = path.split('/')
        if lm and len(p) == 4 and p[1] in maps and p[2] in CU_TYPE and not re.fullmatch('[0-9a-f-]{36}', p[3]):   # skip anonymous user uploads
            out['https://www.cs2util.com' + path] = (lm.group(1)[:10], path)
    return out


def build_cu(url, path, lastmod, res, download=True):
    h = get(url)
    if not h:
        return None
    raw = re.sub('<!-- -->', '', h)
    def f(pat, grp=1):
        m = re.search(pat, raw, re.S)
        return html.unescape(m.group(grp)).strip() if m else ''
    t = re.sub(r'\|+', '|', html.unescape(re.sub('<[^>]+>', '|', raw)))
    def g2(pat):
        m = re.search(pat, t)
        return m.group(1).strip() if m else ''
    title, updated = f(r'<h1[^>]*>(.*?)</h1>'), f(r'Updated at:\s*(?:<[^>]+>)*\s*([0-9]{4}-[0-9]{2}-[0-9]{2})') or lastmod
    sp, og, air = f(r'(setpos [^<]+)'), f(r'<meta property="og:image" content="([^"]+)"'), f(r'Air Time</label>.*?>([0-9.]+)<')
    fl = re.search(r'Report Invalid Nade\|(\d+)x\|(\w+)\|(\w+)\|(\w+)\|Lineup', t)
    side_c, site = (fl.group(3), fl.group(4)) if fl else ('', '')
    mouse, move, diff, steps = g2(r'Mouse Button\|([^|]+)'), g2(r'Movement\|([^|]+)'), g2(r'Difficulty\|([^|]+)'), g2(r'Lineup & Steps\|(.{0,500}?)(?:\|Related|\|Comments|\|Similar|$)')
    base = path.split('/')[1]
    if not sp or not title:
        print('  ! skipped (no title/setpos):', url); return None
    cal = CAL[base]
    gpos, z = grid(sp, cal)
    mk = 'nuke_lower' if (base == 'nuke' and z < NUKE_SPLIT_Z) else base
    cat = path.split('/')[2]
    slug = slugify(path.split('/')[-1])
    ntitle = norm(title)
    if ' from ' in ntitle:
        tgt = ntitle.split(' from ', 1)[0]
    elif ' to ' in ntitle:
        tgt = ntitle.split(' to ', 1)[1]
    else:
        tgt = ntitle
    to, exact = res.landing(base, tgt, site)
    step0 = steps.split('|')[0].strip()
    jump = 'jump' in step0.lower()
    base_t = 'jump-throw' if jump else {'left click': 'left click', 'right click': 'right click', 'left + right click': 'left+right'}.get((mouse or 'Left Click').lower(), (mouse or 'left click').lower())
    technique = ('run+' if move.startswith('Running') else 'crouch ' if move.startswith('Crouch') else '') + base_t
    side = {'t': 'T', 'ct': 'CT'}.get(side_c, 'Both')
    name = clean_title(title)
    images = []
    if download:
        if not og:
            print('  ! skipped (no cover image):', url); return None
        raw_img = get(og, binary=True)
        if not raw_img:
            return None
        dest = os.path.join(SHOTS, mk, slug + '.webp')
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        open(dest, 'wb').write(raw_img)
        images = [{'src': 'shots/%s/%s.webp' % (mk, slug), 'label': 'Aim'}]
    note = step0 + (' Air time %ss.' % air if air and air != '0' else '') + (' Difficulty: %s.' % diff if diff else '')
    note += '\nSource: cs2util.com (updated %s).%s Verify in game.' % (updated, '' if exact else ' Landing spot is a rough guess - check the screenshot.')
    rec = {'id': 'cu-%s-%s' % ('d2' if mk == 'dust2' else mk, slug), 'map': mk, 'name': name, 'type': CU_TYPE[cat],
           'variant': 'pop-flash' if 'pop' in name.lower() else 'instant' if ('fast' in name.lower() or 'instant' in name.lower()) else 'standard',
           'side': side, 'purpose': 'execute' if side == 'T' else 'default', 'technique': technique, 'status': 'unknown',
           'from': gpos, 'to': {'x': to[0], 'y': to[1]}, 'setpos': sp, 'video': url, 'notes': note,
           'tags': ['cs2util'] + ([site] if site else []) + ([] if exact else ['landing-approx']), 'images': images, 'updated': updated, 'source': 'cs2util.com'}
    aimline(rec)
    return rec


# ------------------------------------------------------------------ main
def months_ago(months):
    d = datetime.date.today()
    y, m = d.year, d.month - months
    while m < 1:
        m += 12; y -= 1
    return datetime.date(y, m, min(d.day, 28)).isoformat()


def main():
    ap = argparse.ArgumentParser(description='Add new / updated lineups from csnades.gg and cs2util.com to the seed files.')
    ap.add_argument('--apply', action='store_true', help='scrape, download images and write the seed files (default: dry run)')
    ap.add_argument('--months', type=int, default=12, help='ignore lineups last updated longer ago than this (default 12)')
    ap.add_argument('--maps', default=','.join(ACTIVE), help='comma separated map names')
    ap.add_argument('--source', choices=['csnades', 'cs2util'], help='only this source')
    ap.add_argument('--check', type=int, metavar='N', help='self-test: rebuild N known lineups per source and compare with the seed data')
    a = ap.parse_args()
    if Image is None:
        print('Pillow is missing (pip install pillow): images will be copied without conversion.')
    maps = [m for m in a.maps.split(',') if m in CAL]
    d2, more = load_all()
    allrec = d2 + more
    res = Resolver(allrec)
    by_url = {r['video']: r for r in allrec if r.get('video')}
    cutoff = months_ago(a.months)

    if a.check:
        bad = 0
        for src, build, cands in (('csnades', build_csn, csn_candidates(maps)), ('cs2util', build_cu, cu_candidates(maps))):
            if a.source and a.source != src:
                continue
            known = [(u, c) for u, c in cands.items() if u in by_url][:a.check]
            print('== self-test %s: %d lineups' % (src, len(known)))
            for url, (lm, path) in known:
                new, old = build(url, path, lm, res, download=False), by_url[url]
                if not new:
                    print('  FAIL could not build', url); bad += 1; continue
                diff = [k for k in ('id', 'map', 'name', 'type', 'side', 'technique', 'setpos', 'from', 'updated') if new.get(k) != old.get(k)]
                if new['notes'].split('\n')[0] != old['notes'].split('\n')[0]:
                    diff.append('notes(first line)')
                print('  %s %s %s' % ('OK  ' if not diff else 'DIFF', old['name'][:44], diff or ''))
                bad += bool(diff)
        print('self-test finished:', 'all identical' if not bad else '%d with differences' % bad)
        return

    todo, maybe = [], []      # todo: (source, url, path, lastmod, is_refresh)
    for src, cands in (('csnades', csn_candidates(maps)), ('cs2util', cu_candidates(maps))):
        if a.source and a.source != src:
            continue
        for url, (lm, path) in sorted(cands.items()):
            if lm < cutoff:
                continue
            old = by_url.get(url)
            if old is None:
                todo.append((src, url, path, lm, False))
            elif lm > (old.get('updated') or ''):
                maybe.append((src, url, path, lm, old))
    # A newer date alone proves nothing (sites touch many pages at once). Only refresh a lineup when the lineup itself changed.
    touched = 0
    for src, url, path, lm, old in maybe:
        probe = (build_csn if src == 'csnades' else build_cu)(url, path, lm, res, download=False)
        if probe and (probe['setpos'] != old['setpos'] or probe['technique'] != old['technique']):
            todo.append((src, url, path, lm, True))
        else:
            touched += 1
        time.sleep(0.2)
    new_n = sum(1 for t in todo if not t[4]); ref_n = len(todo) - new_n
    print('Lineups updated since %s on %s: %d new, %d really changed (setpos / technique); %d only had their date touched and are ignored.' % (cutoff, ', '.join(maps), new_n, ref_n, touched))
    for t in todo[:40]:
        print('  %-7s %-9s %s' % (t[0], 'refresh' if t[4] else 'new', t[2]))
    if len(todo) > 40:
        print('  ... and %d more' % (len(todo) - 40))
    if not a.apply or not todo:
        print('(dry run - nothing written)' if not a.apply else 'Nothing to do.')
        return

    built = []
    for i, (src, url, path, lm, _) in enumerate(todo, 1):
        print('[%d/%d] %s' % (i, len(todo), path))
        rec = (build_csn if src == 'csnades' else build_cu)(url, path, lm, res, download=True)
        if rec:
            built.append(rec)
        time.sleep(0.25)
    ids_d2 = {r['id']: r for r in d2}; ids_more = {r['id']: r for r in more}
    for rec in built:
        (ids_d2 if rec['map'] == 'dust2' else ids_more)[rec['id']] = rec          # replace a refreshed one, append a new one
    write_array(SEED_D2, 'SEED_NADES', list(ids_d2.values()), indent=1)
    write_array(SEED_MORE, 'SEED_MORE', list(ids_more.values()))
    v1, v2 = bump_version(SEED_D2, 'SEED_VERSION'), bump_version(SEED_MORE, 'SEED_MORE_VERSION')
    print('Done: %d lineups written. Seed versions are now %s / %s - open the app (Ctrl+F5) and they load by themselves.' % (len(built), v1, v2))


if __name__ == '__main__':
    main()
