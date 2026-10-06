"""Bounded local readiness; never invokes a model or discovery."""
import argparse,json,socket,subprocess,time,urllib.request,urllib.error

def ready(port=8787, seconds=10, service='digitalme-relay.service'):
    start=time.monotonic(); deadline=start+seconds; attempts=0; reason='not_checked'
    while time.monotonic()<deadline:
        attempts+=1
        remaining=deadline-time.monotonic()
        try:
            state=subprocess.run(['systemctl','is-active',service],capture_output=True,text=True,timeout=min(.5,remaining)).stdout.strip()
            if state in ('failed','inactive'):
                reason='process_'+state;break
            with socket.create_connection(('127.0.0.1',port),timeout=min(.25,max(.001,deadline-time.monotonic()))):pass
            with urllib.request.urlopen('http://127.0.0.1:%d/health'%port,timeout=min(.5,max(.001,deadline-time.monotonic()))) as response:
                body=json.loads(response.read(4096))
                if response.status==200 and body.get('ok') is True:
                    print(json.dumps(dict(event='ready',elapsedMs=round((time.monotonic()-start)*1000),attempts=attempts)));return True
                reason='health_not_ok'
        except (OSError,ValueError,subprocess.TimeoutExpired) as error:
            reason=type(error).__name__
        time.sleep(min(.2,max(0,deadline-time.monotonic())))
    print(json.dumps(dict(event='readiness_failed',elapsedMs=round((time.monotonic()-start)*1000),attempts=attempts,reason=reason)))
    return False

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=8787);parser.add_argument('--seconds',type=float,default=10)
    args=parser.parse_args();raise SystemExit(0 if ready(args.port,args.seconds) else 1)
