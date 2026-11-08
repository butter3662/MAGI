#!/usr/bin/env bash
# MAGI 개인 서버: 매월 1일 17:00(한국 시간) 전체 업데이트 후 재시작
# magi-monthly-update.timer가 실행한다. 기록: /var/log/magi-monthly-update.log
#  1) 라즈베리파이 OS 전체 업데이트 (커널·펌웨어 포함)
#  2) FreeLLMAPI(Docker) 업데이트
#  3) OS 업데이트가 성공했으면 재시작
LOG=/var/log/magi-monthly-update.log
export DEBIAN_FRONTEND=noninteractive

has_compose_file(){
  local d="$1"
  [ -f "$d/docker-compose.yml" ] || [ -f "$d/docker-compose.yaml" ] || [ -f "$d/compose.yml" ] || [ -f "$d/compose.yaml" ]
}

# FreeLLMAPI 폴더 찾기: 실행 중인 컨테이너가 기억하는 폴더 → 없으면 /home/*/freellmapi
find_freellmapi_dir(){
  local cid dir
  cid=$(docker ps -aq --filter "label=com.docker.compose.project=freellmapi" 2>/dev/null | head -1)
  if [ -n "$cid" ]; then
    dir=$(docker inspect "$cid" --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' 2>/dev/null)
    if [ -n "$dir" ] && has_compose_file "$dir"; then echo "$dir"; return 0; fi
  fi
  for dir in /home/*/freellmapi; do
    if [ -d "$dir" ] && has_compose_file "$dir"; then echo "$dir"; return 0; fi
  done
  return 1
}

update_freellmapi(){
  if ! command -v docker >/dev/null 2>&1; then echo "Docker가 없어 FreeLLMAPI 업데이트를 건너뜀"; return 0; fi
  local dir owner
  if ! dir=$(find_freellmapi_dir); then echo "FreeLLMAPI 폴더를 찾지 못해 건너뜀"; return 0; fi
  echo "== FreeLLMAPI 업데이트 ($dir) =="
  owner=$(stat -c %U "$dir")
  # 폴더 주인 계정으로 받아야 git이 "소유자가 다르다"며 거부하지 않는다
  sudo -u "$owner" git -C "$dir" pull --ff-only || echo "(git pull 실패 — 이전 설정 파일로 계속)"
  if (cd "$dir" && docker compose pull && docker compose up -d); then
    docker image prune -f >/dev/null 2>&1   # 예전 이미지를 지워 SD 카드 공간 확보
    echo "FreeLLMAPI 업데이트 완료"
  else
    echo "FreeLLMAPI 업데이트 실패 — 기존 버전 그대로 실행"
  fi
}

{
  echo "== $(date '+%Y-%m-%d %H:%M:%S %Z') 월간 업데이트 시작 =="
  # 설정 파일을 바꾸는 업데이트는 기존 설정을 그대로 둔다 (묻는 창 없이 진행)
  apt-get update -q &&
  apt-get -y -q -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold full-upgrade &&
  apt-get -y -q autoremove
  rc=$?
  echo "== OS 업데이트 끝 (결과 코드 $rc) =="
  update_freellmapi
} >> "$LOG" 2>&1

# OS 업데이트가 성공했을 때만 재시작한다. 실패하면 기록만 남기고 그대로 둔다.
if [ "${rc:-1}" -eq 0 ]; then
  echo "== 재시작 ==" >> "$LOG"
  systemctl reboot
fi
