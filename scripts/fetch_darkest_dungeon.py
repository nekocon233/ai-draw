"""Snapshot authorized Darkest Dungeon hero assets over SSH; never edit the source."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import subprocess


def powershell(host, source):
    command = 'powershell.exe -NoProfile -NonInteractive -EncodedCommand ' + base64.b64encode(
        ("[Console]::OutputEncoding=[System.Text.Encoding]::UTF8\n"
         "$ProgressPreference='SilentlyContinue'\n" + source).encode('utf-16le')).decode()
    result = subprocess.run(['ssh', '-n', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
                             host, command], capture_output=True, timeout=300, check=True)
    return json.loads(result.stdout.decode('utf-8-sig'))


def fetch(host, root):
    root.mkdir(parents=True, exist_ok=True)
    inventory = powershell(host, r'''
$base='E:\SteamLibrary\steamapps\common\DarkestDungeon'
$mods='E:\SteamLibrary\steamapps\workshop\content\262060'
$rows=@([PSCustomObject]@{id='base';title='Darkest Dungeon';root=$base;heroes=@(Get-ChildItem -LiteralPath ($base+'\heroes') -Directory).Name})
$rows+=@(Get-ChildItem -LiteralPath $mods -Directory | ForEach-Object {
  $heroes=Join-Path $_.FullName 'heroes'
  if(Test-Path -LiteralPath $heroes) {
    [xml]$project=Get-Content -LiteralPath (Join-Path $_.FullName 'project.xml') -Encoding UTF8
    [PSCustomObject]@{id=$_.Name;title=$project.SelectSingleNode('//Title|//title').InnerText;root=$_.FullName;heroes=@(Get-ChildItem -LiteralPath $heroes -Directory).Name}
  }
})
$rows | ConvertTo-Json -Depth 4 -Compress
''')
    manifest_path = root / 'sources.json'
    if manifest_path.exists() and json.loads(manifest_path.read_text()) != inventory:
        raise ValueError('Source inventory changed; use a new snapshot directory')
    manifest_path.write_text(json.dumps(inventory, ensure_ascii=False, indent=2) + '\n')
    for item in inventory:
        destination = root / 'raw' / item['id']
        stamp = destination / '.complete.json'
        if stamp.exists():
            print(json.dumps({'source': item['id'], 'cached': True}), flush=True)
            continue
        destination.mkdir(parents=True, exist_ok=True)
        remote = item['root'].replace('\\', '/')
        paths = [host + ':' + remote + '/heroes']
        if item['id'] != 'base':
            paths.append(host + ':' + remote + '/project.xml')
        subprocess.run(['scp', '-qr', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
                        *paths, str(destination)], timeout=900, check=True)
        hashes = {str(path.relative_to(destination)): hashlib.sha256(path.read_bytes()).hexdigest()
                  for path in sorted(destination.rglob('*')) if path.is_file()}
        stamp.write_text(json.dumps({'source': item, 'sha256': hashes}, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps({'source': item['id'], 'title': item['title'], 'files': len(hashes)},
                         ensure_ascii=False), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', type=Path)
    parser.add_argument('--host', default='nekocon-4090')
    args = parser.parse_args()
    fetch(args.host, args.destination)
