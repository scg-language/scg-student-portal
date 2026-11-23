"""日本地図（都道府県の形）を、画面で使える軽い形にして src/assets/japan-map-data.js に書き出す。

  py -X utf8 scripts/build_japan_map.py <ne_10m_admin_1_states_provinces.geojson>

もとのデータ＝Natural Earth（https://www.naturalearthdata.com/ ・パブリックドメイン）の
「Admin 1 – States, Provinces」10m。リポには入れない（40MB）。落とす先の例：
  https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson

やること：
  ・日本の47都道府県だけ取り出す
  ・小さな島と、遠い島（小笠原・伊豆諸島・奄美より南）を落とす。線を間引く
  ・沖縄は、実際の場所ではなく、左上の枠の中に寄せて描く
  ・SVG の path（d）にして、都道府県コード（01〜47）と名前を付ける
学生の情報は扱わない。標準出力には、件数と大きさだけを出す。
"""
import io
import json
import math
import os
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

W = 400.0                       # 地図の幅（SVG の単位）
LON0, LON1 = 128.6, 146.0       # 本土の範囲（経度）
LAT0, LAT1 = 30.2, 45.7         # 本土の範囲（緯度）
KX = math.cos(math.radians(37))  # 経度1度の幅を、緯度1度の高さに合わせる
SCALE = W / ((LON1 - LON0) * KX)
H = (LAT1 - LAT0) * SCALE
TOL = 0.55                      # 線を間引く強さ（SVG の単位）
MIN_AREA = 9.0                  # これより小さい島は描かない（SVG の単位の2乗）
INSET = dict(x=6.0, y=6.0, w=92.0, h=78.0)      # 沖縄を入れる枠（左上）
OKI = dict(lon0=127.55, lon1=128.4, lat0=26.0, lat1=26.95)   # 沖縄本島のあたりだけ描く

NAMES = ["北海道", "青森", "岩手", "宮城", "秋田", "山形", "福島", "茨城", "栃木", "群馬", "埼玉", "千葉", "東京", "神奈川", "新潟", "富山",
         "石川", "福井", "山梨", "長野", "岐阜", "静岡", "愛知", "三重", "滋賀", "京都", "大阪", "兵庫", "奈良", "和歌山", "鳥取", "島根",
         "岡山", "広島", "山口", "徳島", "香川", "愛媛", "高知", "福岡", "佐賀", "長崎", "熊本", "大分", "宮崎", "鹿児島", "沖縄"]


def project(lon, lat):
    return ((lon - LON0) * KX * SCALE, (LAT1 - lat) * SCALE)


def area(ring):
    return abs(sum(ring[i][0] * ring[i - 1][1] - ring[i - 1][0] * ring[i][1] for i in range(len(ring)))) / 2


def simplify(pts, tol):
    """Douglas–Peucker。再帰を使わない（点の多い海岸線で深くなりすぎるため）。"""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    if pts[0] == pts[-1]:
        # 輪は、はじめと終わりが同じ点。そのままだと基準の線の長さが0になり、全部の点が落ちる。
        # はじめの点からいちばん遠い点で2つに分けてから間引く
        far = max(range(len(pts)), key=lambda i: math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]))
        keep[far] = True
        stack = [(0, far), (far, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]
        bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy) or 1e-9
        best, idx = 0.0, -1
        for i in range(a + 1, b):
            d = abs(dy * (pts[i][0] - ax) - dx * (pts[i][1] - ay)) / norm
            if d > best:
                best, idx = d, i
        if best > tol and idx > 0:
            keep[idx] = True
            stack += [(a, idx), (idx, b)]
    return [p for p, k in zip(pts, keep) if k]


def rings_of(geom):
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    return [poly[0] for poly in polys]       # 外側の輪だけ（湖などの穴は描かない）


def path(rings):
    out = []
    for r in rings:
        out.append("M" + "L".join("%.1f,%.1f" % p for p in r) + "Z")
    return "".join(out)


def main():
    src = sys.argv[1]
    feats = [f for f in json.load(open(src, encoding="utf-8"))["features"] if f["properties"].get("iso_a2") == "JP"]
    by = {f["properties"]["iso_3166_2"][3:]: f for f in feats}
    assert len(by) == 47, len(by)
    prefs = []
    for n in range(1, 48):
        code = "%02d" % n
        rings = []
        for ring in rings_of(by[code]["geometry"]):
            lon = sum(p[0] for p in ring) / len(ring)
            lat = sum(p[1] for p in ring) / len(ring)
            if code == "47":
                if not (OKI["lon0"] <= lon <= OKI["lon1"] and OKI["lat0"] <= lat <= OKI["lat1"]):
                    continue
                kx = math.cos(math.radians(26.5))
                s = min(INSET["w"] * 0.8 / ((OKI["lon1"] - OKI["lon0"]) * kx), INSET["h"] * 0.8 / (OKI["lat1"] - OKI["lat0"]))
                ox = INSET["x"] + (INSET["w"] - (OKI["lon1"] - OKI["lon0"]) * kx * s) / 2
                oy = INSET["y"] + (INSET["h"] - (OKI["lat1"] - OKI["lat0"]) * s) / 2
                pts = [(ox + (p[0] - OKI["lon0"]) * kx * s, oy + (OKI["lat1"] - p[1]) * s) for p in ring]
                pts = simplify(pts, TOL)
                if len(pts) >= 4 and area(pts) >= 4:
                    rings.append(pts)
                continue
            if lat < LAT0 or lon > LON1 or lon < LON0:
                continue                                   # 奄美より南・遠い島
            if code == "13" and lat < 35.3:
                continue                                   # 伊豆諸島・小笠原
            pts = simplify([project(*p[:2]) for p in ring], TOL)
            if len(pts) >= 4 and area(pts) >= MIN_AREA:
                rings.append(pts)
        assert rings, code
        xs = [p[0] for r in rings for p in r]
        ys = [p[1] for r in rings for p in r]
        big = max(rings, key=area)
        prefs.append(dict(c=code, ja=NAMES[n - 1], d=path(rings),
                          cx=round(sum(p[0] for p in big) / len(big), 1), cy=round(sum(p[1] for p in big) / len(big), 1),
                          b=[round(min(xs), 1), round(min(ys), 1), round(max(xs), 1), round(max(ys), 1)]))
    data = dict(w=W, h=round(H, 1), inset=INSET, pref=prefs)
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "assets", "japan-map-data.js")
    body = ("/* 日本地図（都道府県の形）。scripts/build_japan_map.py が作る。手で直さない。\n"
            " * もと＝Natural Earth（パブリックドメイン）。沖縄は左上の枠（inset）に寄せてある。\n"
            " * pref[]: c=都道府県コード / ja=名前 / d=SVG の path / cx,cy=まん中 / b=[左,上,右,下] */\n"
            "var JAPAN_MAP = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n"
            "if (typeof module === \"object\" && module.exports) module.exports = JAPAN_MAP;\n")
    open(out, "w", encoding="utf-8", newline="\n").write(body)
    print("都道府県", len(prefs), "／大きさ", len(body.encode("utf-8")), "バイト／地図", int(W), "x", int(H))


if __name__ == "__main__":
    main()
