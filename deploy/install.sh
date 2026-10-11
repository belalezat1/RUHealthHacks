#!/usr/bin/env bash
# Run on the EC2 host after Docker, git, curl and the private env file are ready.
set -Eeuo pipefail
if (( EUID != 0 )); then
  echo "Run with sudo: sudo bash deploy/install.sh" >&2
  exit 1
fi
for command in docker git curl flock systemctl; do
  command -v "$command" >/dev/null || { echo "Install $command first." >&2; exit 1; }
done
test -s /etc/sevaro/backend.env || { echo "Configure /etc/sevaro/backend.env first." >&2; exit 1; }
chown root:root /etc/sevaro/backend.env
chmod 600 /etc/sevaro/backend.env
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
install -d -m 750 /opt/sevaro
install -m 755 "$source_dir/sevaro-deploy.sh" /usr/local/bin/sevaro-deploy
install -m 644 "$source_dir/sevaro-deploy.service" /etc/systemd/system/sevaro-deploy.service
install -m 644 "$source_dir/sevaro-deploy.timer" /etc/systemd/system/sevaro-deploy.timer
systemctl daemon-reload
systemctl enable --now docker
systemctl start sevaro-deploy.service
systemctl enable --now sevaro-deploy.timer
echo "Deployment ready. belal will be checked every 60 seconds."
