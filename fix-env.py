#!/usr/bin/env python3
# fix-env.py — fixes multiline BETFAIR_CERT and BETFAIR_KEY in .env file

import re

with open('.env', 'r') as f:
    lines = f.readlines()

result = []
i = 0
while i < len(lines):
    line = lines[i].rstrip('\n')
    
    # Check if this is a BETFAIR_CERT or BETFAIR_KEY line
    if line.startswith('BETFAIR_CERT=') or line.startswith('BETFAIR_KEY='):
        key = line.split('=')[0]
        # Collect all lines until the next KEY= line
        val_lines = [line[len(key)+1:]]
        i += 1
        while i < len(lines):
            next_line = lines[i].rstrip('\n')
            # Stop if we hit another environment variable
            if re.match(r'^[A-Z_]+=', next_line):
                break
            val_lines.append(next_line)
            i += 1
        # Join with literal \n
        val = '\n'.join(val_lines).strip()
        # Clean up any existing \n sequences
        val = val.replace('\\n', '\n')
        result.append(key + '=' + val)
        print(f"Fixed {key}: {len(val)} chars")
    else:
        result.append(line)
        i += 1

with open('.env', 'w') as f:
    f.write('\n'.join(result) + '\n')

print("Done — .env updated")
print("Run: pm2 restart village-inn-proxy && pm2 logs village-inn-proxy --lines 10")
