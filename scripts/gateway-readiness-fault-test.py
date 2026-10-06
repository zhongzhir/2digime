"""Real loopback sockets in isolated fixtures. No production service or API."""
import json,os,pathlib,socket,subprocess,tempfile,threading,time,http.server
base=pathlib.Path(__file__).resolve().parents[1]/'review/core-link-02'
results=[]
for name,delay,status,state in [('delayed_listen',.6,200,'active'),('process_exit',0,200,'inactive'),('persistent_health_failure',0,503,'active'),('rollback_delayed_start',.8,200,'active')]:
    with tempfile.TemporaryDirectory() as tmp:
        root=pathlib.Path(tmp);ctl=root/'systemctl';ctl.write_text('#!/bin/sh\nprintf "%s\\n" '+state+'\n');ctl.chmod(0o755)
        with socket.socket() as reserve:reserve.bind(('127.0.0.1',0));port=reserve.getsockname()[1]
        server=[];stop=threading.Event()
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(status);self.end_headers();self.wfile.write(b'{"ok":true}')
            def log_message(self,*args):pass
        def serve():
            if stop.wait(delay):return
            httpd=http.server.ThreadingHTTPServer(('127.0.0.1',port),Handler);server.append(httpd);httpd.serve_forever(poll_interval=.05)
        thread=threading.Thread(target=serve);thread.start();start=time.monotonic()
        p=subprocess.run(['python3',str(base/'gateway-ready.py'),'--port',str(port),'--seconds','1.5'],env=dict(os.environ,PATH=str(root)+':'+os.environ['PATH']),capture_output=True,text=True,timeout=3)
        elapsed=round((time.monotonic()-start)*1000);stop.set()
        if server:server[0].shutdown();server[0].server_close()
        thread.join()
        expected=name in ('delayed_listen','rollback_delayed_start')
        assert (p.returncode==0)==expected,(name,p.stdout,p.stderr)
        assert elapsed<2100,(name,elapsed)
        if expected:assert elapsed>=delay*1000
        if name=='process_exit':assert elapsed<700
        if name=='persistent_health_failure':assert elapsed>=1450
        results.append(dict(case=name,passed=True,elapsedMs=elapsed,result=json.loads(p.stdout)))
print(json.dumps(dict(loopbackFixtureOnly=True,applicationRequests=0,providerAttempts=0,tests=results)))
