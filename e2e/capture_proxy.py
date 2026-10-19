#!/usr/bin/env python3
"""Local test proxy: forwards to the B paywall and records the x402 payment header and settlement response."""
import http.server, json, sys, urllib.request, urllib.error
UP, PORT, OUT = sys.argv[1], int(sys.argv[2]), sys.argv[3]
class H(http.server.BaseHTTPRequestHandler):
    def _go(self):
        n = int(self.headers.get("content-length") or 0)
        body = self.rfile.read(n) if n else None
        req = urllib.request.Request(UP + self.path, data=body, method=self.command)
        for k, v in self.headers.items():
            if k.lower() not in ("host", "content-length", "connection"):
                req.add_header(k, v)
        try:
            r = urllib.request.urlopen(req, timeout=120); code, hdrs, data = r.status, r.headers, r.read()
        except urllib.error.HTTPError as e:
            code, hdrs, data = e.code, e.headers, e.read()
        pay = self.headers.get("PAYMENT-SIGNATURE") or self.headers.get("X-PAYMENT")
        resp = hdrs.get("PAYMENT-RESPONSE") or hdrs.get("X-PAYMENT-RESPONSE")
        if pay and resp:
            with open(OUT, "a") as f:
                f.write(json.dumps({"payment": pay, "response": resp}) + "\n")
        self.send_response(code)
        for k, v in hdrs.items():
            if k.lower() not in ("transfer-encoding", "connection", "content-length"):
                self.send_header(k, v)
        self.send_header("content-length", str(len(data)))
        self.end_headers(); self.wfile.write(data)
    do_GET = do_POST = _go
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
