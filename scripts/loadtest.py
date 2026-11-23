# -*- coding: utf-8 -*-
"""150同時アクセス負荷テスト — scg-student-portal

実運用の形を再現する2段構成:
  [準備] python scripts/loadtest.py tokens
     l001〜l150 のログイントークンをゆっくり取得して tmp/tokens.json に貯める。
     ※サインインAPIには同一IPからの回数制限があるため意図的に低速（30分ほど）。
       実運用でも学生のログインは「各自のスマホで事前に1回」であり、ここは本番負荷ではない。
  [本番] python scripts/loadtest.py burst
     ログイン済み150名が「同一瞬間」に出題取得→一斉送信する最悪ケースを計測。
     これがHR一斉小テストの実態に対応する数字。

  ★2026-11-24 に足した2つ（ログインまわりの制限を確かめる。上の2つでは1回も通っていなかった道）
  [一斉ログイン] python scripts/loadtest.py signin [ばらける秒数]
     150名が、パスワードで一斉にログインする。＝12/15 の形（その場で初めてログイン）。
     ばらける秒数を省くと 30（30秒のあいだに、ばらばらに押す）。0 なら全員が同じ瞬間。
     取れたログインの控えを tmp/sessions.json に貯める（次の refresh が使う）。
  [一斉の自動更新] python scripts/loadtest.py refresh [ばらける秒数]
     tmp/sessions.json の150名が、ログインの自動更新を一斉に送る。
     ＝ふだんのテストの形（前に開いてから1時間以上たって、先生の合図で全員が開く）。
  どちらも、画面（src/assets/api.js）と同じ回数だけやり直す（ログイン4回・自動更新6回）。
  🔴 同じ場所（この PC）から送る＝学校の Wi-Fi と同じ形。制限の値は Supabase の画面の
     Authentication → Rate Limits（2026-11-24：自動更新 1500／ログイン 600・どちらも5分あたり）。

出力: 成功数/失敗数/応答時間(平均・p95・最悪)/再送回数
依存: 標準ライブラリのみ
"""
import sys, os, json, time, random, threading, io
import urllib.request
import urllib.error

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, "tests"))
from env_creds import get_student_pw, NO_ENV_MSG  # 資格情報は共通ヘルパーから読む（tests/env_creds.py）

BASE = "https://egdcbxzpgwenmfabpodd.supabase.co"
ANON = ("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnZGNieHpwZ3dlbm1mYWJwb2RkIiwi"
        "cm9sZSI6ImFub24iLCJpYXQiOjE3ODgzNTcwNDYsImV4cCI6MjEwMzkzMzA0Nn0.m908C67Nh4KsYnH_LWvP4wAjOtxI79hhE-BKS1MCxX0")
QUIZ_SET = "7e57c0de-0000-4000-8000-000000000001"
# 教材「テスト用」の常設の回（db/2026-09-12_seed_test_quiz_set.sql）。
# ★ふつうの名前の回を当てにしていたせいで、きあが「停止」を押しただけで落ちていた。
#   名前で検査用だと分かるものに変えてある。消さない・止めない。
N = 150
TOKENS_FILE = os.path.join(HERE, "tmp", "tokens.json")

def req(path, token=None, body=None, timeout=30):
    headers = {"apikey": ANON, "Content-Type": "application/json"}
    if token: headers["Authorization"] = "Bearer " + token
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, headers=headers)
    with urllib.request.urlopen(r, timeout=timeout) as res:
        return json.loads(res.read().decode())

def req_retry(path, token=None, body=None, tries=4):
    """本番クライアントと同じ再送ロジック。戻り値: (結果, 再送回数)"""
    last = None
    for i in range(tries):
        try:
            return req(path, token, body), i
        except urllib.error.HTTPError as e:
            if e.code not in (429,) and e.code < 500:
                raise
            last = e
        except Exception as e:
            last = e
        time.sleep(0.6 * (2 ** i) * (0.5 + random.random()))
    raise last

# ---------- tokens: ゆっくり取得して貯める（レジューム可能） ----------
def get_tokens():
    pw = get_student_pw()
    if not pw:
        print(f"🔴 {NO_ENV_MSG}")
        return
    os.makedirs(os.path.dirname(TOKENS_FILE), exist_ok=True)
    tokens = {}
    if os.path.exists(TOKENS_FILE):
        tokens = json.load(open(TOKENS_FILE, encoding="utf-8"))
        print(f"既存トークン {len(tokens)} 件から再開")
    for i in range(1, N + 1):
        sid = f"l{i:03d}"
        if sid in tokens: continue
        for attempt in range(10):
            try:
                auth = req("/auth/v1/token?grant_type=password",
                           body={"email": f"{sid}@stu.scg-portal.jp", "password": pw})
                tokens[sid] = auth["access_token"]
                json.dump(tokens, open(TOKENS_FILE, "w", encoding="utf-8"))
                print(f"{sid} OK ({len(tokens)}/{N})", flush=True)
                break
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    print(f"{sid} 429 → 60秒待機", flush=True)
                    time.sleep(60)
                else:
                    raise
        time.sleep(10)  # 制限に触れない安全ペース
    print(f"完了: {len(tokens)} 件 → {TOKENS_FILE}")

# ---------- burst: ログイン済み150名の一斉受験 ----------
results = {"fetch": [], "submit": []}
lock = threading.Lock()

def student(sid, token, barrier):
    barrier.wait()  # 全員同時に開始（アプリを開く瞬間）
    t0 = time.time()
    try:
        qs, retries = req_retry(f"/rest/v1/questions?select=id,seq&quiz_set_id=eq.{QUIZ_SET}&order=seq", token)
        with lock: results["fetch"].append((time.time()-t0, retries, None))
    except Exception as e:
        with lock: results["fetch"].append((time.time()-t0, 99, str(e)[:80]))
        barrier.wait(); return
    answers = {q["id"]: random.choice("ab") for q in qs}
    barrier.wait()  # 「送信して」の号令 = 全員同一瞬間に提出
    t0 = time.time()
    try:
        _, retries = req_retry("/rest/v1/rpc/submit_attempt", token,
                               {"p_quiz_set_id": QUIZ_SET, "p_answers": answers, "p_duration_ms": 60000})
        with lock: results["submit"].append((time.time()-t0, retries, None))
    except Exception as e:
        with lock: results["submit"].append((time.time()-t0, 99, str(e)[:80]))

def report(name, rows, n_expected):
    ok = [r for r in rows if r[2] is None]
    ng = [r for r in rows if r[2] is not None]
    lat = sorted(r[0] for r in ok)
    retr = sum(r[1] for r in ok)
    line = f"[{name}] 成功 {len(ok)}/{n_expected}  失敗 {len(ng)}"
    if lat:
        avg = sum(lat)/len(lat)
        p95 = lat[max(0, int(len(lat)*0.95)-1)]
        line += f"  応答: 平均 {avg:.2f}s / p95 {p95:.2f}s / 最悪 {lat[-1]:.2f}s  再送合計 {retr}回"
    print(line)
    for r in ng[:5]:
        print(f"    NG例: {r[2]}")

def burst():
    tokens = json.load(open(TOKENS_FILE, encoding="utf-8"))
    n = len(tokens)
    print(f"=== 一斉受験テスト: ログイン済み {n} 名 ===")
    barrier = threading.Barrier(n)
    threads = [threading.Thread(target=student, args=(sid, tok, barrier)) for sid, tok in tokens.items()]
    t0 = time.time()
    for t in threads: t.start()
    for t in threads: t.join()
    print(f"全体所要: {time.time()-t0:.1f}s")
    report("出題取得(同時)", results["fetch"], n)
    report("一斉送信(同時)", results["submit"], len([r for r in results["fetch"] if r[2] is None]))

# ---------- signin / refresh: ログインまわりの制限（2026-11-24） ----------
SESSIONS_FILE = os.path.join(HERE, "tmp", "sessions.json")

def auth_call(grant, body, tries):
    """/auth/v1/token を、画面と同じやり直し方で呼ぶ。戻り値: (結果 or None, やり直した回数, 断られた理由 or None)"""
    last = "?"
    for i in range(tries):
        try:
            return req("/auth/v1/token?grant_type=" + grant, body=body), i, None
        except urllib.error.HTTPError as e:
            last = "HTTP %d" % e.code
            if e.code != 429 and e.code < 500:
                return None, i, last          # はっきり断られた（やり直さない）
        except Exception as e:
            last = type(e).__name__
        time.sleep(0.6 * (2 ** i) * (0.5 + random.random()))
    return None, tries, last + "（やり直しても通らず）"

def auth_wave(name, jobs, spread, tries):
    """jobs = [(学生の印, grant, body)]。spread 秒のあいだに、ばらばらに送る（0 なら同じ瞬間）。"""
    rows, out = [], {}
    barrier = threading.Barrier(len(jobs))
    def one(sid, grant, body):
        barrier.wait()
        if spread > 0: time.sleep(random.random() * spread)
        t0 = time.time()
        res, retries, why = auth_call(grant, body, tries)
        with lock:
            rows.append((time.time() - t0, retries, why))
            if res: out[sid] = {"access_token": res["access_token"], "refresh_token": res.get("refresh_token")}
    threads = [threading.Thread(target=one, args=j) for j in jobs]
    t0 = time.time()
    for t in threads: t.start()
    for t in threads: t.join()
    print(f"全体所要: {time.time()-t0:.1f}s（ばらける秒数 {spread}）")
    report(name, rows, len(jobs))
    reasons = {}
    for r in rows:
        if r[2]: reasons[r[2]] = reasons.get(r[2], 0) + 1
    if reasons: print("    断られた理由ごとの件数:", reasons)
    return out

def spread_arg():
    try: return max(0.0, float(sys.argv[2]))
    except (IndexError, ValueError): return 30.0

def signin():
    pw = get_student_pw()
    if not pw:
        print(f"🔴 {NO_ENV_MSG}")
        return
    print(f"=== 一斉ログイン: {N} 名（パスワードで・同じ場所から） ===")
    jobs = [(f"l{i:03d}", "password", {"email": f"l{i:03d}@stu.scg-portal.jp", "password": pw}) for i in range(1, N + 1)]
    got = auth_wave("ログイン", jobs, spread_arg(), 4)
    os.makedirs(os.path.dirname(SESSIONS_FILE), exist_ok=True)
    json.dump(got, open(SESSIONS_FILE, "w", encoding="utf-8"))
    print(f"ログインの控え {len(got)} 件 → {SESSIONS_FILE}（tmp/ は git に入らない）")

def refresh():
    if not os.path.exists(SESSIONS_FILE):
        print("🔴 先に signin を回してください（ログインの控えがありません）")
        return
    sessions = json.load(open(SESSIONS_FILE, encoding="utf-8"))
    jobs = [(sid, "refresh_token", {"refresh_token": v["refresh_token"]}) for sid, v in sessions.items() if v.get("refresh_token")]
    print(f"=== 一斉の自動更新: {len(jobs)} 名（同じ場所から） ===")
    got = auth_wave("自動更新", jobs, spread_arg(), 6)
    sessions.update(got)          # 更新の控えは1回しか使えないので、新しいものに置きかえる
    json.dump(sessions, open(SESSIONS_FILE, "w", encoding="utf-8"))

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "burst"
    if mode == "tokens": get_tokens()
    elif mode == "burst": burst()
    elif mode == "signin": signin()
    elif mode == "refresh": refresh()
    else: print("usage: loadtest.py [tokens|burst|signin [秒]|refresh [秒]]")
