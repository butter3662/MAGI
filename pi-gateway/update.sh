#!/usr/bin/env bash
# 문지기 업데이트 한 번에 하기 (git pull 다음에 실행)
#   cd ~/MAGI && git pull
#   sudo bash pi-gateway/update.sh
# - 새 gateway.mjs를 설치하고
# - 원격 끄기·재시작 장치(magi-poweroff / magi-reboot)를 설치·켜고
# - 문지기를 재시작한 뒤 잘 돌고 있는지 확인한다.
set -e
[ "$(id -u)" -eq 0 ] || { echo "sudo를 붙여 실행하세요: sudo bash $0"; exit 1; }
DIR="$(cd "$(dirname "$0")" && pwd)"

install -m 644 "$DIR/gateway.mjs" /opt/magi-gateway/gateway.mjs
for u in magi-poweroff.path magi-poweroff.service magi-reboot.path magi-reboot.service; do
  install -m 644 "$DIR/$u" "/etc/systemd/system/$u"
done
systemctl daemon-reload
systemctl enable --now magi-poweroff.path magi-reboot.path >/dev/null 2>&1
systemctl restart magi-gateway
sleep 2
if systemctl is-active --quiet magi-gateway; then
  echo "완료: 문지기가 새 버전으로 실행 중입니다. (원격 끄기·재시작 준비됨)"
else
  echo "문지기가 실행되지 않았습니다. 이 명령으로 원인을 확인하세요: journalctl -u magi-gateway -n 30"
  exit 1
fi
