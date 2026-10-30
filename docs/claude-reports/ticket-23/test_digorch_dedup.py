# Contrôle hors ligne de DIGORCH (#23) : copie de /opt/dig-orch/lqorch.py dans /tmp/t23/lqorch_copy.py,
# état temporaire, envoi SMTP remplacé par un faux. Ne touche ni à /opt/dig-orch ni à l'état réel.
# Usage : mkdir -p /tmp/t23/state && cp /opt/dig-orch/lqorch.py /tmp/t23/lqorch_copy.py && python3 -I <ce fichier>
import os, sys, threading, time, json, multiprocessing as mp
os.environ.update(LQ_STATE_DIR="/tmp/t23/state", LQ_NOTIFY_SMTP_ENV="/tmp/t23/fake-smtp.env",
                  LQ_REPO="ReC82/Dig", LQ_GH_SYNC="0", LQ_SHARED_USAGE_DBS="")
sys.path.insert(0, "/tmp/t23")
import lqorch_copy as L
SENT = "/tmp/t23/sent.log"
def fake_send(subject, body, an="", a=""):
    time.sleep(0.3)
    with open(SENT, "a") as f: f.write(subject + "\n")
L.send_mail = fake_send
con = L.db()
ok = lambda c, m: print(("OK   " if c else "FAIL ") + m)
# 1) même clé insérée 3 fois -> 1 ligne, 1 envoi
for _ in range(3):
    L.queue_notification(con, "99:Livré:abc", 99, "Livré", "[Dig] #99 — Livré", "corps")
n = con.execute("select count(*) from notifications where key='99:Livré:abc'").fetchone()[0]
ok(n == 1, f"clé unique : {n} ligne(s)")
ok(open(SENT).read().count("#99") == 1, "même état mis en file 3 fois -> 1 envoi")
# 2) course : 4 processus vident la file simultanément
con.execute("insert into notifications(key,issue,kind,subject,body,created_at) values('98:x:1',98,'x','[Dig] #98 — course','b',?)", (L.iso(),)); con.commit()
def worker():
    c = L.db(); L.send_mail = fake_send; L.flush_notifications(c)
ps = [mp.Process(target=worker) for _ in range(4)]
[p.start() for p in ps]; [p.join() for p in ps]
ok(open(SENT).read().count("#98") == 1, "4 vidages concurrents -> 1 envoi")
# 3) échec SMTP -> pas marqué envoyé, réessai différé, puis envoi unique
def boom(*a, **k): raise ConnectionError("x")
L.send_mail = boom
con.execute("insert into notifications(key,issue,kind,subject,body,created_at) values('97:x:1',97,'x','[Dig] #97 — échec','b',?)", (L.iso(),)); con.commit()
L.flush_notifications(con)
r = con.execute("select attempts,next_try,sent_at,last_error from notifications where key='97:x:1'").fetchone()
ok(r["sent_at"] is None and r["attempts"] == 1 and r["next_try"] > L.iso() and r["last_error"] == "ConnectionError", f"échec -> réessai différé ({r['next_try']}), erreur sans détail")
L.send_mail = fake_send
L.flush_notifications(con)
ok(open(SENT).read().count("#97") == 0, "pas de renvoi avant le délai")
con.execute("update notifications set next_try='' where key='97:x:1'"); con.commit()
L.flush_notifications(con); L.flush_notifications(con)
ok(open(SENT).read().count("#97") == 1, "après le délai : 1 seul envoi")
# 4) reprise après arrêt brutal : session orpheline (pid inexistant)
con.execute("insert into tasks(issue,title,status,priority,updated_at) values(50,'t','RUNNING',20,?)", (L.iso(),))
con.execute("insert into tasks(issue,title,status,priority,updated_at) values(51,'u','READY',0,?)", (L.iso(),))
con.execute("insert into sessions(id,issue,started_at,pid) values('s-orph',50,?,4194000)", (L.iso(),)); con.commit()
L.recover_interrupted(con)
s = con.execute("select outcome,ended_at from sessions where id='s-orph'").fetchone()
ok(s["outcome"] == "INTERRUPTED" and s["ended_at"], "session orpheline notée INTERRUPTED")
t = L.next_task(con)
ok(t is not None and t["issue"] == 50, f"ticket interrompu repris en premier (prochain : #{t['issue'] if t else None}, devant un P0 READY)")
