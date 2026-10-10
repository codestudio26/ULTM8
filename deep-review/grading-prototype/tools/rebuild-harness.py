#!/usr/bin/env python3
"""Re-embed a prototype build into the QA harness.

The harness carries the app under test as one base64 string (PROTOTYPE_B64)
and loads it into an iframe via srcdoc. After you change the prototype,
run this to point the harness at the new build:

    python3 tools/rebuild-harness.py prototype/index.html qa/qa-harness.html qa/qa-harness.html

(arguments: prototype file, harness to read, harness to write - the last two can be the same file)
"""
import base64, re, sys

def main(prototype_path, harness_in, harness_out):
    proto = open(prototype_path, encoding="utf-8").read()
    harness = open(harness_in, encoding="utf-8").read()
    b64 = base64.b64encode(proto.encode("utf-8")).decode("ascii")
    pattern = r'(const PROTOTYPE_B64 = ")[A-Za-z0-9+/=]*(")'
    if not re.search(pattern, harness):
        sys.exit("PROTOTYPE_B64 not found in " + harness_in)
    out = re.sub(pattern, lambda m: m.group(1) + b64 + m.group(2), harness, count=1)
    open(harness_out, "w", encoding="utf-8").write(out)
    print("wrote %s (%d bytes, prototype %d bytes)" % (harness_out, len(out), len(proto)))

if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
