#!/usr/bin/env bash
# MAGI 개인 서버: 보안 업데이트 자동 설치 켜기 (한 번만 실행)
#   sudo bash ~/MAGI/pi-gateway/setup-auto-update.sh
# - Debian 표준 도구(unattended-upgrades)로 "보안 업데이트만" 매일 자동 설치한다.
# - 자동 재시작은 하지 않는다. 커널처럼 재시작이 필요한 업데이트는 MAGI의 '재시작' 버튼으로 적용한다.
# - Docker 안의 FreeLLMAPI는 여기 포함되지 않는다 (README의 '업데이트' 참고).
set -e
if [ "$(id -u)" -ne 0 ]; then echo "sudo를 붙여 실행하세요: sudo bash $0"; exit 1; fi

echo "== 패키지 목록 갱신 =="
apt-get update -q
echo "== unattended-upgrades 설치 =="
DEBIAN_FRONTEND=noninteractive apt-get install -y -q unattended-upgrades

# 매일 목록 갱신 + 보안 업데이트 설치, 일주일마다 내려받은 파일 정리
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
CONF

systemctl enable --now unattended-upgrades >/dev/null 2>&1 || true

echo
echo "== 설정 확인 =="
apt-config dump | grep -E 'APT::Periodic::(Update-Package-Lists|Unattended-Upgrade) ' || true
echo
echo "완료: 보안 업데이트를 매일 자동으로 설치합니다."
echo "기록 보기: cat /var/log/unattended-upgrades/unattended-upgrades.log"
