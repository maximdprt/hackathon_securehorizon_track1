#!/bin/bash
# Build la ville 3D depuis le CODE À JOUR (tarball city-main.tgz régénéré depuis main), tiré de notre bucket S3
# via le rôle de l'EC2 (plus d'URL présignée qui expire). Sauvegarde avant, ne redémarre que si le build réussit.
export HOME=/root
TS=$(date +%Y%m%d-%H%M%S)
BUCKET=team2-agents-runs-393886879451
echo ">> backup -> /root/city-backup-$TS"
cp -a /root/city /root/city-backup-$TS || { echo BACKUP_FAILED; exit 1; }
cd /root/city || exit 1
echo ">> download s3://$BUCKET/city-main.tgz (role EC2)"
python3 - <<PY
import boto3
boto3.client("s3","us-west-2").download_file("team2-agents-runs-393886879451","city-main.tgz","/tmp/city-main.tgz")
PY
[ -f /tmp/city-main.tgz ] || { echo DOWNLOAD_FAILED; exit 1; }
echo ">> extract (overwrite source, keep node_modules/.env.local)"
tar xzf /tmp/city-main.tgz -C /root/city && rm /tmp/city-main.tgz || { echo EXTRACT_FAILED; exit 1; }
echo ">> npm install"
npm install --no-audit --no-fund > /tmp/cityinstall.log 2>&1 || { echo INSTALL_FAILED; tail -15 /tmp/cityinstall.log; exit 1; }
echo ">> build"
if npm run build > /tmp/citybuild.log 2>&1; then
  systemctl restart sentinel-city; sleep 7
  echo "BUILD_OK city=$(systemctl is-active sentinel-city)"
  curl -s -m 12 -o /dev/null -w "local :3006 HTTP %{http_code}\n" http://127.0.0.1:3006/
else echo BUILD_FAILED; tail -20 /tmp/citybuild.log; exit 1; fi
