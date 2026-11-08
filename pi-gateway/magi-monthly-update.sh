#!/usr/bin/env bash
# MAGI 개인 서버: 매월 1일 17:00(한국 시간) 전체 업데이트 후 재시작
# magi-monthly-update.timer가 실행한다. 기록: /var/log/magi-monthly-update.log
LOG=/var/log/magi-monthly-update.log
export DEBIAN_FRONTEND=noninteractive
{
  echo "== $(date '+%Y-%m-%d %H:%M:%S %Z') 월간 업데이트 시작 =="
  # 설정 파일을 바꾸는 업데이트는 기존 설정을 그대로 둔다 (묻는 창 없이 진행)
  apt-get update -q &&
  apt-get -y -q -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold full-upgrade &&
  apt-get -y -q autoremove
  rc=$?
  echo "== 끝 (결과 코드 $rc) =="
} >> "$LOG" 2>&1

# 업데이트가 성공했을 때만 재시작한다. 실패하면 기록만 남기고 그대로 둔다.
if [ "${rc:-1}" -eq 0 ]; then
  echo "== 재시작 ==" >> "$LOG"
  systemctl reboot
fi
