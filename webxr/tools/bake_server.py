"""Static server for webxr/ that also lets tools/bake.html write its output.

    python webxr/tools/bake_server.py      # then open http://localhost:8124/tools/bake.html

POST /save?path=data/<file> writes the request body to webxr/data/<file>.
Only paths inside webxr/data/ are accepted. Bound to localhost only.
"""
import http.server
import os
import urllib.parse

WEB = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DATA = os.path.join(WEB, 'data')


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WEB, **kw)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_POST(self):
        url = urllib.parse.urlparse(self.path)
        rel = urllib.parse.parse_qs(url.query).get('path', [''])[0]
        dst = os.path.abspath(os.path.join(WEB, rel))
        if url.path != '/save' or not dst.startswith(DATA + os.sep):
            self.send_error(403)
            return
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with open(dst, 'wb') as fh:
            fh.write(body)
        self.send_response(204)
        self.end_headers()


if __name__ == '__main__':
    print('serving webxr/ on http://localhost:8124  (bake: /tools/bake.html)')
    http.server.ThreadingHTTPServer(('127.0.0.1', 8124), Handler).serve_forever()
