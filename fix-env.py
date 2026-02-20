#!/usr/bin/env python3
# fix-env.py — fixes multiline BETFAIR_CERT and BETFAIR_KEY in .env file
# Run on server: python3 fix-env.py

import re

with open('.env', 'r') as f:
    content = f.read()

def fix_multiline_value(content, key):
    # Find the key and grab everything until the next KEY= or end of file
    pattern = re.compile(r'(' + key + r'=)(.*?)(?=\n[A-Z_]+=|\Z)', re.DOTALL)
    match = pattern.search(content)
    if match:
        val = match.group(2).strip()
        # Replace actual newlines with literal \n
        val_single = val.replace('\n', '\\n')
        content = pattern.sub(match.group(1) + val_single, content)
        print(f"Fixed {key} — now {len(val_single)} chars on one line")
    else:
        print(f"WARNING: {key} not found in .env")
    return content

content = fix_multiline_value(content, 'BETFAIR_CERT')
content = fix_multiline_value(content, 'BETFAIR_KEY')

with open('.env', 'w') as f:
    f.write(content)

print("Done — .env file updated")
print("Now run: pm2 restart village-inn-proxy")
